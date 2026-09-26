import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { z } from 'zod';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';
import { PlatformAuditService } from './platform-audit.service';
import {
  IMPERSONATION_COOKIE_NAME,
  IMPERSONATION_DEFAULT_MINUTES,
  IMPERSONATION_MAX_MINUTES,
  IMPERSONATION_TOKEN_TYPE,
  ImpersonationTokenPayload,
  PresentedImpersonationToken,
  impersonationCookieOptions,
} from './impersonation-token';
import type { ImpersonationDecision } from './impersonation.policy';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const StartImpersonationSchema = z
  .object({
    organizationId: z.string().uuid(),
    userId: z.string().uuid(),
    reason: z.string().trim().min(10, 'Reason must be at least 10 characters').max(1000),
    durationMinutes: z.number().int().min(1).max(IMPERSONATION_MAX_MINUTES).optional().default(IMPERSONATION_DEFAULT_MINUTES),
    /** READ_WRITE additionally requires an active support-access grant issued by the tenant. */
    mode: z.enum(['READ_ONLY', 'READ_WRITE']).optional().default('READ_ONLY'),
  })
  .strict();
export type StartImpersonationDto = z.infer<typeof StartImpersonationSchema>;

export type ImpersonationEndReason =
  | 'ENDED_BY_IMPERSONATOR'
  | 'ENDED_BY_ADMIN'
  | 'EXPIRED'
  | 'SUPERSEDED'
  | 'LOGOUT'
  | 'TARGET_INVALID';

/** Verified impersonation attached to the request (`req.impersonation`). */
export interface ImpersonationContext {
  id: string;
  organizationId: string;
  organizationName: string;
  targetUserId: string;
  targetEmail: string;
  targetFullName: string | null;
  memberRole: string;
  emailVerified: boolean;
  mfaEnabled: boolean;
  impersonatorId: string;
  impersonatorEmail: string;
  impersonatorOrganizationId: string | null;
  readOnly: boolean;
  reason: string;
  createdAt: string;
  expiresAt: string;
}

export type AuthenticationOutcome =
  | { kind: 'valid'; ctx: ImpersonationContext }
  | { kind: 'invalid'; code: 'IMPERSONATION_EXPIRED' | 'IMPERSONATION_ENDED'; message: string; sessionId: string | null; returnOrganizationId: string | null };

export interface ImpersonationView {
  id: string;
  organizationId: string;
  organizationName: string | null;
  impersonatorId: string | null;
  impersonatorEmail: string;
  targetUserId: string | null;
  targetEmail: string;
  reason: string;
  mode: 'READ_ONLY' | 'READ_WRITE';
  status: 'ACTIVE' | 'ENDED' | 'EXPIRED';
  createdAt: string;
  expiresAt: string;
  endedAt: string | null;
  endReason: string | null;
  requestCount: number;
  lastRequestAt: string | null;
}

export interface RequestMeta {
  clientIp?: string | null;
  userAgent?: string | null;
}

function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function toView(r: any, now = Date.now()): ImpersonationView {
  const expiresAt = iso(r.expires_at)!;
  return {
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name ?? null,
    impersonatorId: r.impersonator_id ?? null,
    impersonatorEmail: r.impersonator_email,
    targetUserId: r.target_user_id ?? null,
    targetEmail: r.target_email,
    reason: r.reason,
    mode: r.read_only ? 'READ_ONLY' : 'READ_WRITE',
    status: r.ended_at ? (r.end_reason === 'EXPIRED' ? 'EXPIRED' : 'ENDED') : new Date(expiresAt).getTime() <= now ? 'EXPIRED' : 'ACTIVE',
    createdAt: iso(r.created_at)!,
    expiresAt,
    endedAt: iso(r.ended_at),
    endReason: r.end_reason ?? null,
    requestCount: Number(r.request_count ?? 0),
    lastRequestAt: iso(r.last_request_at),
  };
}

/** Public shape of an active impersonation for the web banner (no reason text of other sessions). */
export function contextView(ctx: ImpersonationContext) {
  return {
    id: ctx.id,
    organizationId: ctx.organizationId,
    organizationName: ctx.organizationName,
    targetUserId: ctx.targetUserId,
    targetEmail: ctx.targetEmail,
    targetFullName: ctx.targetFullName,
    memberRole: ctx.memberRole,
    impersonatorEmail: ctx.impersonatorEmail,
    mode: ctx.readOnly ? ('READ_ONLY' as const) : ('READ_WRITE' as const),
    reason: ctx.reason,
    createdAt: ctx.createdAt,
    expiresAt: ctx.expiresAt,
  };
}

/**
 * Safe impersonation (spec 10.8, C §24): permission (SUPER_ADMIN), mandatory reason,
 * hard expiry (<= 30 min), distinct token/claims, read-only by default, no access to
 * secrets (impersonation.policy.ts), every request audited in the tenant's hash chain
 * and the platform ledger, end/expiry revokes the token (checked per request).
 */
@Injectable()
export class ImpersonationService {
  private readonly logger = new Logger(ImpersonationService.name);
  private readonly jwt: JwtService;

  constructor(
    private readonly db: DatabaseService,
    config: ConfigService,
    private readonly platformAudit: PlatformAuditService,
    @Optional() private readonly audit?: AuditService
  ) {
    // Own signer without default expiresIn: the token's exp is the session's expires_at.
    this.jwt = new JwtService({ secret: config.getOrThrow<string>('JWT_SECRET') });
  }

  cookieName(): string {
    return IMPERSONATION_COOKIE_NAME;
  }

  setCookie(res: any, token: string, expiresAt: string): void {
    if (res && typeof res.cookie === 'function') {
      res.cookie(IMPERSONATION_COOKIE_NAME, token, impersonationCookieOptions(process.env, new Date(expiresAt).getTime() - Date.now()));
    }
  }

  clearCookie(res: any): void {
    if (!res) return;
    const { maxAge: _m, ...opts } = impersonationCookieOptions(process.env);
    if (typeof res.clearCookie === 'function') {
      res.clearCookie(IMPERSONATION_COOKIE_NAME, opts);
    } else if (typeof res.setHeader === 'function') {
      // Raw Node response (middleware on a non-Express adapter): expire the cookie manually.
      res.setHeader('Set-Cookie', `${IMPERSONATION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=${opts.sameSite}${opts.secure ? '; Secure' : ''}`);
    }
  }

  // ------------------------------------------------------------------ start / end

  async start(
    operator: { id: string; email: string | null; organizationId: string | null },
    dto: StartImpersonationDto,
    meta: RequestMeta
  ): Promise<{ view: ImpersonationView; token: string; ctx: ImpersonationContext }> {
    if (operator.id === dto.userId) {
      throw new BadRequestException({ code: 'IMPERSONATION_TARGET_NOT_ALLOWED', message: 'You cannot impersonate yourself.' });
    }
    const targetRes = await this.db.query(
      `SELECT u.id, u.email, u.full_name, u.status, u.system_role, u.email_verified_at, u.totp_enabled_at,
              m.role AS member_role, o.name AS organization_name
         FROM organizations o
         LEFT JOIN organization_members m ON m.organization_id = o.id AND m.user_id = $2
         LEFT JOIN users u ON u.id = m.user_id
        WHERE o.id = $1`,
      [dto.organizationId, dto.userId],
      { bypassRls: true }
    );
    const target = targetRes.rows?.[0];
    if (!target) throw new NotFoundException(`Organization ${dto.organizationId} not found`);
    if (!target.id || !target.member_role) {
      throw new NotFoundException({ code: 'IMPERSONATION_TARGET_NOT_FOUND', message: 'The user is not a member of this organization.' });
    }
    if (target.status !== 'ACTIVE') {
      throw new ForbiddenException({ code: 'IMPERSONATION_TARGET_NOT_ALLOWED', message: 'Only active members can be impersonated.' });
    }
    if ((target.system_role ?? 'USER') !== 'USER') {
      throw new ForbiddenException({
        code: 'IMPERSONATION_TARGET_NOT_ALLOWED',
        message: 'Platform administrators cannot be impersonated.',
      });
    }

    let supportGrantId: string | null = null;
    if (dto.mode === 'READ_WRITE') {
      const grant = await this.db.query(
        `SELECT id FROM support_access_grants
          WHERE organization_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
          ORDER BY expires_at DESC LIMIT 1`,
        [dto.organizationId],
        { bypassRls: true }
      );
      supportGrantId = grant.rows?.[0]?.id ?? null;
      if (!supportGrantId) {
        throw new ForbiddenException({
          code: 'SUPPORT_GRANT_REQUIRED',
          message: 'Read-write impersonation requires an active support-access grant from the organization (Settings → Support).',
        });
      }
    }

    // One active impersonation per operator: a new one supersedes the previous.
    const open = await this.db.query(
      `SELECT id FROM impersonation_sessions WHERE impersonator_id = $1 AND ended_at IS NULL`,
      [operator.id],
      { bypassRls: true }
    );
    const supersededIds: string[] = [];
    for (const r of open.rows ?? []) {
      const ended = await this.end(r.id, 'SUPERSEDED', { id: operator.id, email: operator.email }, meta);
      if (ended) supersededIds.push(ended.id);
    }

    const inserted = await this.db.query(
      `INSERT INTO impersonation_sessions
         (organization_id, impersonator_id, impersonator_email, impersonator_organization_id, target_user_id, target_email,
          reason, read_only, support_grant_id, expires_at, client_ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW() + make_interval(mins => $10::int), $11::inet, $12)
       RETURNING *`,
      [
        dto.organizationId,
        operator.id,
        operator.email ?? 'unknown',
        operator.organizationId && UUID_RE.test(operator.organizationId) ? operator.organizationId : null,
        target.id,
        target.email,
        dto.reason,
        dto.mode !== 'READ_WRITE',
        supportGrantId,
        dto.durationMinutes,
        meta.clientIp ?? null,
        meta.userAgent ? String(meta.userAgent).slice(0, 500) : null,
      ],
      { bypassRls: true }
    );
    const row = { ...inserted.rows[0], organization_name: target.organization_name };
    const view = toView(row);

    const auditPayload = {
      impersonationId: view.id,
      impersonatedUserId: target.id,
      impersonatedEmail: target.email,
      impersonatorEmail: operator.email,
      reason: dto.reason,
      mode: dto.mode,
      durationMinutes: dto.durationMinutes,
      expiresAt: view.expiresAt,
      supportGrantId,
      supersededSessions: supersededIds,
    };
    try {
      // Fail-closed: no token without both ledger entries.
      await this.audit?.recordEvent({
        organizationId: dto.organizationId,
        action: 'impersonation.started',
        resourceType: 'IMPERSONATION_SESSION',
        resourceId: view.id,
        payload: auditPayload,
        actorType: 'HUMAN',
        actorId: operator.id,
        clientIp: meta.clientIp ?? null,
        userAgent: meta.userAgent ?? null,
      });
      await this.platformAudit.record({
        organizationId: dto.organizationId,
        actorId: operator.id,
        actorEmail: operator.email,
        impersonationId: view.id,
        action: 'impersonation.started',
        targetType: 'USER',
        targetId: target.id,
        payload: auditPayload,
        clientIp: meta.clientIp,
        userAgent: meta.userAgent,
      });
    } catch (err: any) {
      this.logger.error(`Impersonation ${view.id} audit failed; ending session: ${err?.message ?? err}`);
      await this.db
        .query(`UPDATE impersonation_sessions SET ended_at = NOW(), end_reason = 'TARGET_INVALID' WHERE id = $1`, [view.id], {
          bypassRls: true,
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException({
        code: 'AUDIT_UNAVAILABLE',
        message: 'The audit trail is unavailable; impersonation was not started.',
      });
    }

    const payload: ImpersonationTokenPayload = {
      typ: IMPERSONATION_TOKEN_TYPE,
      sub: target.id,
      email: target.email,
      organizationId: dto.organizationId,
      role: target.member_role,
      systemRole: 'USER',
      imp: view.id,
      act: operator.id,
      exp: Math.floor(new Date(view.expiresAt).getTime() / 1000),
    };
    const token = this.jwt.sign(payload);
    const ctx: ImpersonationContext = {
      id: view.id,
      organizationId: dto.organizationId,
      organizationName: target.organization_name,
      targetUserId: target.id,
      targetEmail: target.email,
      targetFullName: target.full_name ?? null,
      memberRole: target.member_role,
      emailVerified: !!target.email_verified_at,
      mfaEnabled: !!target.totp_enabled_at,
      impersonatorId: operator.id,
      impersonatorEmail: operator.email ?? 'unknown',
      impersonatorOrganizationId: row.impersonator_organization_id ?? null,
      readOnly: view.mode === 'READ_ONLY',
      reason: dto.reason,
      createdAt: view.createdAt,
      expiresAt: view.expiresAt,
    };
    return { view, token, ctx };
  }

  /**
   * Ends a session (idempotent). Returns the ended session, or null when it was
   * already ended. Records `impersonation.ended` in both ledgers (best effort: the
   * session is revoked even if the audit write fails — revocation must never be
   * blocked).
   */
  async end(
    sessionId: string,
    reason: ImpersonationEndReason,
    endedBy: { id: string | null; email: string | null },
    meta: RequestMeta = {}
  ): Promise<ImpersonationView | null> {
    if (!UUID_RE.test(sessionId)) return null;
    const res = await this.db.query(
      `UPDATE impersonation_sessions s SET ended_at = NOW(), end_reason = $2, ended_by = $3
         FROM organizations o
        WHERE s.id = $1 AND s.ended_at IS NULL AND o.id = s.organization_id
        RETURNING s.*, o.name AS organization_name`,
      [sessionId, reason, endedBy.id && UUID_RE.test(endedBy.id) ? endedBy.id : null],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    if (!row) return null;
    const view = toView(row);
    const payload = {
      impersonationId: view.id,
      endReason: reason,
      impersonatorEmail: view.impersonatorEmail,
      impersonatedUserId: view.targetUserId,
      endedByEmail: endedBy.email,
      requestCount: view.requestCount,
      startedAt: view.createdAt,
      expiresAt: view.expiresAt,
    };
    const action = reason === 'EXPIRED' ? 'impersonation.expired' : 'impersonation.ended';
    try {
      await this.audit?.recordEvent({
        organizationId: view.organizationId,
        action,
        resourceType: 'IMPERSONATION_SESSION',
        resourceId: view.id,
        payload,
        actorType: endedBy.id ? 'HUMAN' : 'SYSTEM',
        actorId: endedBy.id,
        clientIp: meta.clientIp ?? null,
        userAgent: meta.userAgent ?? null,
      });
      await this.platformAudit.record({
        organizationId: view.organizationId,
        actorId: endedBy.id,
        actorEmail: endedBy.email,
        impersonationId: view.id,
        action,
        targetType: 'IMPERSONATION_SESSION',
        targetId: view.id,
        payload,
        clientIp: meta.clientIp,
        userAgent: meta.userAgent,
      });
    } catch (err: any) {
      this.logger.error(`Audit of ${action} for ${view.id} failed: ${err?.message ?? err}`);
    }
    return view;
  }

  /** Ends every overdue session that is still marked open (called lazily). */
  async expireOverdue(): Promise<number> {
    const res = await this.db.query(
      `SELECT id FROM impersonation_sessions WHERE ended_at IS NULL AND expires_at <= NOW() LIMIT 100`,
      [],
      { bypassRls: true }
    );
    let n = 0;
    for (const r of res.rows ?? []) {
      if (await this.end(r.id, 'EXPIRED', { id: null, email: null })) n++;
    }
    return n;
  }

  async list(filters: { organizationId?: string; activeOnly?: boolean; limit?: number } = {}): Promise<ImpersonationView[]> {
    await this.expireOverdue().catch((err) => this.logger.warn(`Expiry sweep failed: ${err?.message ?? err}`));
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.organizationId) {
      params.push(filters.organizationId);
      where.push(`s.organization_id = $${params.length}::uuid`);
    }
    if (filters.activeOnly) where.push(`s.ended_at IS NULL AND s.expires_at > NOW()`);
    params.push(Math.min(Math.max(Number(filters.limit) || 50, 1), 200));
    const res = await this.db.query(
      `SELECT s.*, o.name AS organization_name
         FROM impersonation_sessions s JOIN organizations o ON o.id = s.organization_id
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY s.created_at DESC
        LIMIT $${params.length}`,
      params,
      { bypassRls: true }
    );
    return (res.rows ?? []).map((r: any) => toView(r));
  }

  // ------------------------------------------------------------------ per-request verification

  /**
   * Verifies a presented impersonation token against its session row: signature,
   * claims, not ended, not expired, operator still an active SUPER_ADMIN, target still
   * an active member without a platform role. Overdue sessions are marked EXPIRED.
   */
  async authenticate(presented: PresentedImpersonationToken, meta: RequestMeta = {}): Promise<AuthenticationOutcome> {
    let payload: any;
    try {
      payload = this.jwt.verify(presented.token, { ignoreExpiration: true });
    } catch {
      return { kind: 'invalid', code: 'IMPERSONATION_ENDED', message: 'The impersonation token is invalid.', sessionId: null, returnOrganizationId: null };
    }
    const sessionId = typeof payload?.imp === 'string' && UUID_RE.test(payload.imp) ? payload.imp : null;
    if (
      payload?.typ !== IMPERSONATION_TOKEN_TYPE ||
      !sessionId ||
      typeof payload.sub !== 'string' ||
      typeof payload.act !== 'string' ||
      typeof payload.organizationId !== 'string'
    ) {
      return { kind: 'invalid', code: 'IMPERSONATION_ENDED', message: 'The impersonation token is invalid.', sessionId: null, returnOrganizationId: null };
    }
    const res = await this.db.query(
      `SELECT s.*, o.name AS organization_name,
              u.status AS target_status, u.system_role AS target_system_role, u.full_name AS target_full_name,
              u.email_verified_at, u.totp_enabled_at,
              m.role AS member_role,
              op.status AS operator_status, op.system_role AS operator_system_role
         FROM impersonation_sessions s
         JOIN organizations o ON o.id = s.organization_id
         LEFT JOIN users u ON u.id = s.target_user_id
         LEFT JOIN organization_members m ON m.user_id = s.target_user_id AND m.organization_id = s.organization_id
         LEFT JOIN users op ON op.id = s.impersonator_id
        WHERE s.id = $1`,
      [sessionId],
      { bypassRls: true }
    );
    const row = res.rows?.[0];
    const returnOrganizationId = row?.impersonator_organization_id ?? null;
    if (!row || row.target_user_id !== payload.sub || row.impersonator_id !== payload.act || row.organization_id !== payload.organizationId) {
      return { kind: 'invalid', code: 'IMPERSONATION_ENDED', message: 'The impersonation session does not exist.', sessionId, returnOrganizationId };
    }
    if (row.ended_at) {
      return {
        kind: 'invalid',
        code: row.end_reason === 'EXPIRED' ? 'IMPERSONATION_EXPIRED' : 'IMPERSONATION_ENDED',
        message: row.end_reason === 'EXPIRED' ? 'The impersonation session has expired.' : 'The impersonation session has ended.',
        sessionId,
        returnOrganizationId,
      };
    }
    const now = Date.now();
    const expired =
      new Date(row.expires_at).getTime() <= now || (typeof payload.exp === 'number' && payload.exp * 1000 <= now);
    if (expired) {
      await this.end(sessionId, 'EXPIRED', { id: null, email: null }, meta);
      return { kind: 'invalid', code: 'IMPERSONATION_EXPIRED', message: 'The impersonation session has expired.', sessionId, returnOrganizationId };
    }
    const operatorValid = row.operator_status === 'ACTIVE' && row.operator_system_role === 'SUPER_ADMIN';
    const targetValid = row.target_status === 'ACTIVE' && !!row.member_role && (row.target_system_role ?? 'USER') === 'USER';
    if (!operatorValid || !targetValid) {
      await this.end(sessionId, 'TARGET_INVALID', { id: null, email: null }, meta);
      return { kind: 'invalid', code: 'IMPERSONATION_ENDED', message: 'The impersonation session is no longer valid.', sessionId, returnOrganizationId };
    }
    return {
      kind: 'valid',
      ctx: {
        id: row.id,
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        targetUserId: row.target_user_id,
        targetEmail: row.target_email,
        targetFullName: row.target_full_name ?? null,
        memberRole: row.member_role,
        emailVerified: !!row.email_verified_at,
        mfaEnabled: !!row.totp_enabled_at,
        impersonatorId: row.impersonator_id,
        impersonatorEmail: row.impersonator_email,
        impersonatorOrganizationId: row.impersonator_organization_id ?? null,
        readOnly: !!row.read_only,
        reason: row.reason,
        createdAt: iso(row.created_at)!,
        expiresAt: iso(row.expires_at)!,
      },
    };
  }

  /**
   * Audits one request made with an impersonation session in the tenant's hash chain
   * and the platform ledger, and bumps the session's request counter. FAIL-CLOSED:
   * a request that cannot be audited is refused with 503.
   */
  async recordRequest(
    ctx: ImpersonationContext,
    request: { method: string; path: string },
    decision: ImpersonationDecision,
    meta: RequestMeta
  ): Promise<void> {
    const payload = {
      impersonationId: ctx.id,
      impersonatorEmail: ctx.impersonatorEmail,
      impersonatedUserId: ctx.targetUserId,
      impersonatedEmail: ctx.targetEmail,
      method: request.method.toUpperCase(),
      path: request.path.slice(0, 300),
      mode: ctx.readOnly ? 'READ_ONLY' : 'READ_WRITE',
      outcome: decision.allowed ? 'ALLOWED' : 'DENIED',
      ...(decision.allowed ? {} : { denialCode: decision.code }),
    };
    const action = decision.allowed ? 'impersonation.request' : 'impersonation.request.denied';
    try {
      await this.audit?.recordEvent({
        organizationId: ctx.organizationId,
        action,
        resourceType: 'IMPERSONATION_SESSION',
        resourceId: ctx.id,
        payload,
        actorType: 'HUMAN',
        actorId: ctx.impersonatorId,
        clientIp: meta.clientIp ?? null,
        userAgent: meta.userAgent ?? null,
      });
      await this.platformAudit.record({
        organizationId: ctx.organizationId,
        actorId: ctx.impersonatorId,
        actorEmail: ctx.impersonatorEmail,
        impersonationId: ctx.id,
        action,
        targetType: 'IMPERSONATION_SESSION',
        targetId: ctx.id,
        payload,
        clientIp: meta.clientIp,
        userAgent: meta.userAgent,
      });
      await this.db.query(
        `UPDATE impersonation_sessions SET request_count = request_count + 1, last_request_at = NOW() WHERE id = $1`,
        [ctx.id],
        { bypassRls: true }
      );
    } catch (err: any) {
      this.logger.error(`Impersonation request audit failed (${ctx.id}): ${err?.message ?? err}`);
      throw new ServiceUnavailableException({
        code: 'AUDIT_UNAVAILABLE',
        message: 'The audit trail is unavailable; the request was not executed.',
      });
    }
  }

  async requireSession(sessionId: string): Promise<ImpersonationView> {
    const res = await this.db.query(
      `SELECT s.*, o.name AS organization_name FROM impersonation_sessions s JOIN organizations o ON o.id = s.organization_id
        WHERE s.id = $1`,
      [sessionId],
      { bypassRls: true }
    );
    if (!res.rows?.[0]) throw new NotFoundException('Impersonation session not found');
    return toView(res.rows[0]);
  }

  /** 409 when ending a session that is no longer active. */
  static notActive(): ConflictException {
    return new ConflictException({ code: 'IMPERSONATION_NOT_ACTIVE', message: 'The impersonation session is not active.' });
  }
}
