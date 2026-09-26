import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { RequestMeta } from './security-audit.service';

export type SessionAuthMethod =
  | 'PASSWORD'
  | 'PASSWORD_2FA'
  | 'MAGIC_LINK'
  | 'MAGIC_LINK_2FA'
  | 'INVITATION'
  | 'SIGNUP'
  | 'REFRESH'
  | 'SSO';
export type SessionRevocationReason =
  | 'LOGOUT'
  | 'LOGOUT_ALL'
  | 'USER_REVOKED'
  | 'PASSWORD_CHANGED'
  | 'PASSWORD_RESET'
  | 'TWO_FACTOR_CHANGED'
  | 'ACCOUNT_DELETED';

type Queryable = Pick<PoolClient, 'query'> | null;

/** last_seen_at is refreshed at most this often per session (avoids a write per request). */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Server-side session registry (user_sessions). Every access token carries its session
 * id as `jti`; JwtStrategy accepts a token only while that session is active. This
 * gives session listing, per-session revocation and global revocation.
 */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(private readonly db: DatabaseService) {}

  private run(client: Queryable, text: string, params: unknown[]) {
    return client ? client.query(text, params) : this.db.query(text, params, { bypassRls: true });
  }

  async create(params: {
    id: string;
    userId: string;
    expiresAt: Date;
    authMethod: SessionAuthMethod;
    meta?: RequestMeta;
  }): Promise<void> {
    await this.run(
      null,
      `INSERT INTO user_sessions (id, user_id, expires_at, auth_method, ip, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        params.id,
        params.userId,
        params.expiresAt.toISOString(),
        params.authMethod,
        params.meta?.ip ? String(params.meta.ip).slice(0, 64) : null,
        params.meta?.userAgent ? String(params.meta.userAgent).slice(0, 512) : null,
      ]
    );
  }

  /** Refreshes last_seen_at when stale; never throws (best effort). */
  touch(sessionId: string, lastSeenAt: Date | string | null): void {
    const last = lastSeenAt ? new Date(lastSeenAt).getTime() : 0;
    if (Date.now() - last < TOUCH_INTERVAL_MS) return;
    this.run(null, 'UPDATE user_sessions SET last_seen_at = NOW() WHERE id = $1', [sessionId]).catch((err: Error) =>
      this.logger.debug(`Session touch failed: ${err.message}`)
    );
  }

  async list(userId: string, currentSessionId?: string | null) {
    const res = await this.run(
      null,
      `SELECT id, created_at, last_seen_at, expires_at, ip, user_agent, auth_method
       FROM user_sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_seen_at DESC
       LIMIT 100`,
      [userId]
    );
    return res.rows.map((r: any) => ({
      id: r.id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      ip: r.ip,
      userAgent: r.user_agent,
      authMethod: r.auth_method,
      current: !!currentSessionId && r.id === currentSessionId,
    }));
  }

  async revoke(userId: string, sessionId: string, reason: SessionRevocationReason): Promise<void> {
    const res = await this.run(
      null,
      `UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = $3
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, userId, reason]
    );
    if (res.rows.length === 0) {
      throw new NotFoundException('Active session not found');
    }
  }

  /** Revokes every active session of the user (optionally sparing one). */
  async revokeAll(
    userId: string,
    reason: SessionRevocationReason,
    client: Queryable = null,
    exceptSessionId: string | null = null
  ): Promise<number> {
    const res = await this.run(
      client,
      `UPDATE user_sessions SET revoked_at = NOW(), revoked_reason = $2
       WHERE user_id = $1 AND revoked_at IS NULL AND ($3::uuid IS NULL OR id <> $3::uuid)
       RETURNING id`,
      [userId, reason, exceptSessionId]
    );
    return res.rows.length;
  }

  /** Housekeeping: removes sessions that expired more than 30 days ago. */
  async purgeExpired(): Promise<void> {
    await this.run(null, `DELETE FROM user_sessions WHERE expires_at < NOW() - INTERVAL '30 days'`, []);
  }
}
