import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import * as crypto from 'node:crypto';
import { v4 as uuidv4, validate as isUuid } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { IntegrationAuditService } from '../connectors/integration-audit.service';
import { JIT_ROLES } from './sso.service';

/**
 * SCIM 2.0 (RFC 7643 / RFC 7644) provisioning for organization members.
 *
 * - Authentication: per-organization bearer token (stored as SHA-256 only).
 * - Users are global accounts; SCIM operates on the organization MEMBERSHIP:
 *   create/activate adds the membership, `active: false` or DELETE removes it
 *   (access is revoked immediately — tenancy checks membership on every
 *   request). A global account is never deleted by one tenant.
 * - Groups carry an optional mapped role; members of a mapped group get that role.
 * - Never grants ORGANIZATION_OWNER through provisioning.
 */

export const SCIM_USER = 'urn:ietf:params:scim:schemas:core:2.0:User';
export const SCIM_GROUP = 'urn:ietf:params:scim:schemas:core:2.0:Group';
export const SCIM_LIST = 'urn:ietf:params:scim:api:messages:2.0:ListResponse';
export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_PATCH = 'urn:ietf:params:scim:api:messages:2.0:PatchOp';

export class ScimError extends HttpException {
  constructor(status: number, detail: string, scimType?: string) {
    super({ schemas: [SCIM_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) }, status);
  }
}

const sha256 = (v: string) => crypto.createHash('sha256').update(v).digest('hex');
const MAPPABLE_ROLES = new Set<string>([...JIT_ROLES, 'SECURITY_ADMIN']);

export interface ScimPrincipal {
  organizationId: string;
  tokenId: string;
}

@Injectable()
export class ScimService {
  private readonly logger = new Logger(ScimService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: IntegrationAuditService
  ) {}

  // ---------------------------------------------------------------------------
  // Tokens (managed by org admins through the SSO controller)
  // ---------------------------------------------------------------------------
  async createToken(organizationId: string, actorId: string | null, name: string) {
    const token = `erppf_scim_${crypto.randomBytes(32).toString('base64url')}`;
    const id = uuidv4();
    await this.db.query(
      `INSERT INTO scim_tokens (id, organization_id, name, token_hash, prefix, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, organizationId, name.slice(0, 200), sha256(token), token.slice(0, 16), actorId],
      { tenantId: organizationId }
    );
    await this.audit.record({ organizationId, action: 'scim.token_created', resourceType: 'ORGANIZATION', resourceId: organizationId, actorId, payload: { tokenId: id, name } });
    return { id, name, token, prefix: token.slice(0, 16) };
  }

  async listTokens(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, name, prefix, status, last_used_at, created_at FROM scim_tokens WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId],
      { tenantId: organizationId }
    );
    return res.rows;
  }

  async revokeToken(organizationId: string, actorId: string | null, id: string) {
    const res = await this.db.query(
      `UPDATE scim_tokens SET status = 'REVOKED' WHERE organization_id = $1 AND id = $2 RETURNING id`,
      [organizationId, id],
      { tenantId: organizationId }
    );
    if (!res.rows[0]) throw new ScimError(404, 'Token not found');
    await this.audit.record({ organizationId, action: 'scim.token_revoked', resourceType: 'ORGANIZATION', resourceId: organizationId, actorId, payload: { tokenId: id } });
    return { success: true };
  }

  async authenticate(authorization: string | undefined): Promise<ScimPrincipal> {
    const m = String(authorization || '').match(/^Bearer\s+(erppf_scim_[A-Za-z0-9_-]+)$/);
    if (!m) throw new ScimError(401, 'SCIM bearer token required');
    const res = await this.db.query(`SELECT id, organization_id FROM scim_tokens WHERE token_hash = $1 AND status = 'ACTIVE'`, [sha256(m[1])], {
      bypassRls: true,
    });
    const row = res.rows[0];
    if (!row) throw new ScimError(401, 'Invalid SCIM token');
    this.db
      .query(`UPDATE scim_tokens SET last_used_at = NOW() WHERE organization_id = $1 AND id = $2`, [row.organization_id, row.id], { tenantId: row.organization_id })
      .catch(() => undefined);
    return { organizationId: row.organization_id, tokenId: row.id };
  }

  // ---------------------------------------------------------------------------
  // Users
  // ---------------------------------------------------------------------------
  private baseUrl() {
    return `${(process.env.API_PUBLIC_URL || '').replace(/\/+$/, '')}/api/v1/scim/v2`;
  }

  private toScimUser(r: any) {
    const [givenName, ...rest] = String(r.full_name || '').split(' ');
    return {
      schemas: [SCIM_USER],
      id: r.id,
      externalId: r.external_id ?? undefined,
      userName: r.user_name || r.email,
      name: { formatted: r.full_name || '', givenName: givenName || '', familyName: rest.join(' ') },
      displayName: r.full_name || r.email,
      emails: [{ value: r.email, primary: true, type: 'work' }],
      active: Boolean(r.member_role) && r.status === 'ACTIVE' && r.link_active !== false,
      roles: r.member_role ? [{ value: r.member_role }] : [],
      meta: {
        resourceType: 'User',
        created: r.created_at,
        lastModified: r.updated_at ?? r.created_at,
        version: `W/"${r.version ?? 1}"`,
        location: `${this.baseUrl()}/Users/${r.id}`,
      },
    };
  }

  private userSelect(where: string) {
    return `SELECT u.id, u.email, u.full_name, u.status, m.role AS member_role, l.external_id, l.user_name, l.active AS link_active,
                   l.version, COALESCE(l.created_at, m.created_at) AS created_at, COALESCE(l.updated_at, m.updated_at) AS updated_at
              FROM users u
              LEFT JOIN organization_members m ON m.user_id = u.id AND m.organization_id = $1
              LEFT JOIN scim_user_links l ON l.user_id = u.id AND l.organization_id = $1
             WHERE (m.id IS NOT NULL OR l.id IS NOT NULL) AND ${where}`;
  }

  async listUsers(p: ScimPrincipal, query: { filter?: string; startIndex?: string; count?: string }) {
    const startIndex = Math.max(1, Number(query.startIndex) || 1);
    const count = Math.min(200, Math.max(0, Number(query.count ?? 100) || 0));
    const params: any[] = [p.organizationId];
    let where = 'TRUE';
    if (query.filter) {
      const f = query.filter.match(/^\s*(userName|externalId|emails(?:\.value)?)\s+eq\s+"([^"]{1,320})"\s*$/i);
      if (!f) throw new ScimError(400, 'Only "userName eq", "externalId eq" and "emails eq" filters are supported', 'invalidFilter');
      params.push(f[2].toLowerCase());
      where = /^externalId$/i.test(f[1]) ? `LOWER(l.external_id) = $2` : `LOWER(u.email) = $2`;
    }
    const all = await this.db.query(this.userSelect(where) + ' ORDER BY u.email', params, { tenantId: p.organizationId });
    const rows = all.rows;
    return {
      schemas: [SCIM_LIST],
      totalResults: rows.length,
      startIndex,
      itemsPerPage: Math.min(count, Math.max(0, rows.length - (startIndex - 1))),
      Resources: rows.slice(startIndex - 1, startIndex - 1 + count).map((r: any) => this.toScimUser(r)),
    };
  }

  private async loadUser(p: ScimPrincipal, id: string) {
    if (!isUuid(id)) throw new ScimError(404, 'User not found');
    const res = await this.db.query(this.userSelect('u.id = $2'), [p.organizationId, id], { tenantId: p.organizationId });
    if (!res.rows[0]) throw new ScimError(404, 'User not found');
    return res.rows[0];
  }

  async getUser(p: ScimPrincipal, id: string) {
    return this.toScimUser(await this.loadUser(p, id));
  }

  private extractUser(body: any) {
    if (!body || typeof body !== 'object') throw new ScimError(400, 'Invalid SCIM payload', 'invalidSyntax');
    const email = String(body.emails?.find?.((e: any) => e?.primary)?.value || body.emails?.[0]?.value || body.userName || '')
      .trim()
      .toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ScimError(400, 'userName / emails must contain a valid e-mail address', 'invalidValue');
    const fullName = String(body.name?.formatted || [body.name?.givenName, body.name?.familyName].filter(Boolean).join(' ') || body.displayName || '').slice(0, 255);
    return {
      email,
      userName: String(body.userName || email).slice(0, 255),
      externalId: body.externalId ? String(body.externalId).slice(0, 255) : null,
      fullName,
      active: body.active !== false,
    };
  }

  private async defaultRole(organizationId: string): Promise<string> {
    const res = await this.db.query(`SELECT default_role FROM sso_identity_providers WHERE organization_id = $1`, [organizationId], { tenantId: organizationId });
    return res.rows[0]?.default_role || 'VIEWER';
  }

  async createUser(p: ScimPrincipal, body: any) {
    const u = this.extractUser(body);
    const existing = await this.db.query(`SELECT id FROM users WHERE email = $1`, [u.email], { bypassRls: true });
    let userId: string = existing.rows[0]?.id;
    if (userId) {
      const linked = await this.db.query(`SELECT 1 FROM scim_user_links WHERE organization_id = $1 AND user_id = $2`, [p.organizationId, userId], {
        tenantId: p.organizationId,
      });
      if (linked.rows[0]) throw new ScimError(409, 'User already exists in this organization', 'uniqueness');
    } else {
      userId = uuidv4();
      await this.db.query(
        `INSERT INTO users (id, email, password_hash, full_name, system_role, status) VALUES ($1,$2,'!sso-only',$3,'USER','ACTIVE')`,
        [userId, u.email, u.fullName],
        { bypassRls: true }
      );
    }
    const role = await this.defaultRole(p.organizationId);
    await this.db.withTenantTransaction(p.organizationId, async (client) => {
      await client.query(
        `INSERT INTO scim_user_links (id, organization_id, user_id, external_id, user_name, active, source)
         VALUES ($1,$2,$3,$4,$5,$6,'SCIM')`,
        [uuidv4(), p.organizationId, userId, u.externalId, u.userName, u.active]
      );
      if (u.active) {
        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [uuidv4(), p.organizationId, userId, role]
        );
      }
    });
    await this.audit.record({
      organizationId: p.organizationId,
      action: 'scim.user_provisioned',
      resourceType: 'USER',
      resourceId: userId,
      actorType: 'SYSTEM',
      payload: { email: u.email, externalId: u.externalId, active: u.active, role, tokenId: p.tokenId },
    });
    return this.getUser(p, userId);
  }

  /** Applies activation state: membership added (active) or removed (deprovisioned). */
  private async setActive(p: ScimPrincipal, userId: string, active: boolean) {
    const role = await this.defaultRole(p.organizationId);
    await this.db.withTenantTransaction(p.organizationId, async (client) => {
      await client.query(
        `INSERT INTO scim_user_links (id, organization_id, user_id, user_name, active, source)
         SELECT $1, $2, $3, u.email, $4, 'SCIM' FROM users u WHERE u.id = $3
         ON CONFLICT (organization_id, user_id) DO UPDATE SET active = EXCLUDED.active, version = scim_user_links.version + 1, updated_at = NOW()`,
        [uuidv4(), p.organizationId, userId, active]
      );
      if (active) {
        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [uuidv4(), p.organizationId, userId, role]
        );
      } else {
        const owner = await client.query(
          `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
          [p.organizationId, userId]
        );
        if (owner.rows[0]?.role === 'ORGANIZATION_OWNER') {
          const others = await client.query(
            `SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id = $1 AND role = 'ORGANIZATION_OWNER' AND user_id <> $2`,
            [p.organizationId, userId]
          );
          if (!others.rows[0]?.n) throw new ScimError(409, 'Cannot deprovision the last organization owner', 'mutability');
        }
        await client.query(`DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2`, [p.organizationId, userId]);
      }
    });
    await this.audit.record({
      organizationId: p.organizationId,
      action: active ? 'scim.user_activated' : 'scim.user_deprovisioned',
      resourceType: 'USER',
      resourceId: userId,
      actorType: 'SYSTEM',
      payload: { tokenId: p.tokenId },
    });
  }

  async replaceUser(p: ScimPrincipal, id: string, body: any) {
    const current = await this.loadUser(p, id);
    const u = this.extractUser(body);
    if (u.email !== String(current.email).toLowerCase()) {
      throw new ScimError(400, 'Changing the e-mail / userName of an account is not supported', 'mutability');
    }
    await this.db.query(
      `UPDATE scim_user_links SET external_id = COALESCE($3, external_id), user_name = $4, version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND user_id = $2`,
      [p.organizationId, id, u.externalId, u.userName],
      { tenantId: p.organizationId }
    );
    await this.setActive(p, id, u.active);
    return this.getUser(p, id);
  }

  async patchUser(p: ScimPrincipal, id: string, body: any) {
    await this.loadUser(p, id);
    if (!Array.isArray(body?.Operations)) throw new ScimError(400, 'PatchOp requires Operations', 'invalidSyntax');
    let active: boolean | undefined;
    for (const op of body.Operations) {
      const kind = String(op?.op || '').toLowerCase();
      if (kind !== 'replace' && kind !== 'add') throw new ScimError(400, `Unsupported patch op ${op?.op}`, 'invalidSyntax');
      if (op.path && String(op.path).toLowerCase() === 'active') active = op.value === true || op.value === 'true' || op.value === 'True';
      else if (!op.path && op.value && typeof op.value === 'object' && 'active' in op.value) {
        active = op.value.active === true || op.value.active === 'true' || op.value.active === 'True';
      }
    }
    if (active !== undefined) await this.setActive(p, id, active);
    return this.getUser(p, id);
  }

  async deleteUser(p: ScimPrincipal, id: string) {
    await this.loadUser(p, id);
    await this.setActive(p, id, false);
    await this.db.query(`DELETE FROM scim_user_links WHERE organization_id = $1 AND user_id = $2`, [p.organizationId, id], { tenantId: p.organizationId });
  }

  // ---------------------------------------------------------------------------
  // Groups
  // ---------------------------------------------------------------------------
  private toScimGroup(r: any) {
    const members: string[] = Array.isArray(r.member_user_ids) ? r.member_user_ids : [];
    return {
      schemas: [SCIM_GROUP],
      id: r.id,
      externalId: r.external_id ?? undefined,
      displayName: r.display_name,
      members: members.map((m) => ({ value: m, $ref: `${this.baseUrl()}/Users/${m}` })),
      meta: { resourceType: 'Group', created: r.created_at, lastModified: r.updated_at, version: `W/"${r.version}"`, location: `${this.baseUrl()}/Groups/${r.id}` },
    };
  }

  async listGroups(p: ScimPrincipal, query: { filter?: string }) {
    const params: any[] = [p.organizationId];
    let where = '';
    if (query.filter) {
      const f = query.filter.match(/^\s*displayName\s+eq\s+"([^"]{1,255})"\s*$/i);
      if (!f) throw new ScimError(400, 'Only "displayName eq" filters are supported', 'invalidFilter');
      params.push(f[1]);
      where = ' AND display_name = $2';
    }
    const res = await this.db.query(`SELECT * FROM scim_groups WHERE organization_id = $1${where} ORDER BY display_name`, params, { tenantId: p.organizationId });
    return { schemas: [SCIM_LIST], totalResults: res.rows.length, startIndex: 1, itemsPerPage: res.rows.length, Resources: res.rows.map((r: any) => this.toScimGroup(r)) };
  }

  private async loadGroup(p: ScimPrincipal, id: string) {
    if (!isUuid(id)) throw new ScimError(404, 'Group not found');
    const res = await this.db.query(`SELECT * FROM scim_groups WHERE organization_id = $1 AND id = $2`, [p.organizationId, id], { tenantId: p.organizationId });
    if (!res.rows[0]) throw new ScimError(404, 'Group not found');
    return res.rows[0];
  }

  async getGroup(p: ScimPrincipal, id: string) {
    return this.toScimGroup(await this.loadGroup(p, id));
  }

  private async validMembers(p: ScimPrincipal, ids: string[]): Promise<string[]> {
    const clean = Array.from(new Set(ids.filter((i) => isUuid(i))));
    if (!clean.length) return [];
    const res = await this.db.query(
      `SELECT user_id FROM scim_user_links WHERE organization_id = $1 AND user_id = ANY($2::uuid[])
       UNION SELECT user_id FROM organization_members WHERE organization_id = $1 AND user_id = ANY($2::uuid[])`,
      [p.organizationId, clean],
      { tenantId: p.organizationId }
    );
    return res.rows.map((r: any) => r.user_id);
  }

  private async applyGroupRole(p: ScimPrincipal, group: any) {
    const role = group.mapped_role;
    if (!role || !MAPPABLE_ROLES.has(role)) return;
    const members: string[] = group.member_user_ids || [];
    if (!members.length) return;
    await this.db.query(
      `UPDATE organization_members SET role = $3, updated_at = NOW()
        WHERE organization_id = $1 AND user_id = ANY($2::uuid[]) AND role <> 'ORGANIZATION_OWNER'`,
      [p.organizationId, members, role],
      { tenantId: p.organizationId }
    );
  }

  async createGroup(p: ScimPrincipal, body: any) {
    const name = String(body?.displayName || '').trim();
    if (!name) throw new ScimError(400, 'displayName is required', 'invalidValue');
    const members = await this.validMembers(p, (body?.members || []).map((m: any) => String(m?.value || '')));
    try {
      const res = await this.db.query(
        `INSERT INTO scim_groups (id, organization_id, display_name, external_id, member_user_ids) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [uuidv4(), p.organizationId, name.slice(0, 255), body?.externalId ? String(body.externalId).slice(0, 255) : null, JSON.stringify(members)],
        { tenantId: p.organizationId }
      );
      await this.audit.record({ organizationId: p.organizationId, action: 'scim.group_created', resourceType: 'ORGANIZATION', resourceId: p.organizationId, actorType: 'SYSTEM', payload: { group: name, members: members.length } });
      return this.toScimGroup(res.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new ScimError(409, 'Group already exists', 'uniqueness');
      throw err;
    }
  }

  async patchGroup(p: ScimPrincipal, id: string, body: any) {
    const group = await this.loadGroup(p, id);
    if (!Array.isArray(body?.Operations)) throw new ScimError(400, 'PatchOp requires Operations', 'invalidSyntax');
    let members = new Set<string>(group.member_user_ids || []);
    let displayName = group.display_name;
    for (const op of body.Operations) {
      const kind = String(op?.op || '').toLowerCase();
      const path = String(op?.path || '');
      if (path.toLowerCase() === 'members' || (!path && op?.value?.members)) {
        const values = (Array.isArray(op.value) ? op.value : op.value?.members || []).map((m: any) => String(m?.value || ''));
        const valid = await this.validMembers(p, values);
        if (kind === 'add') valid.forEach((v) => members.add(v));
        else if (kind === 'replace') members = new Set(valid);
        else if (kind === 'remove') values.forEach((v: string) => members.delete(v));
      } else if (/^members\[value eq "([0-9a-f-]{36})"\]$/i.test(path) && kind === 'remove') {
        members.delete(path.match(/"([0-9a-f-]{36})"/i)![1]);
      } else if (path.toLowerCase() === 'displayname' || (!path && op?.value?.displayName)) {
        displayName = String(op.value?.displayName ?? op.value).slice(0, 255);
      } else {
        throw new ScimError(400, `Unsupported group patch path '${path}'`, 'invalidPath');
      }
    }
    const res = await this.db.query(
      `UPDATE scim_groups SET member_user_ids = $3, display_name = $4, version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [p.organizationId, id, JSON.stringify([...members]), displayName],
      { tenantId: p.organizationId }
    );
    await this.applyGroupRole(p, res.rows[0]);
    return this.toScimGroup(res.rows[0]);
  }

  async replaceGroup(p: ScimPrincipal, id: string, body: any) {
    await this.loadGroup(p, id);
    const members = await this.validMembers(p, (body?.members || []).map((m: any) => String(m?.value || '')));
    const res = await this.db.query(
      `UPDATE scim_groups SET member_user_ids = $3, display_name = COALESCE($4, display_name), version = version + 1, updated_at = NOW()
        WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [p.organizationId, id, JSON.stringify(members), body?.displayName ? String(body.displayName).slice(0, 255) : null],
      { tenantId: p.organizationId }
    );
    await this.applyGroupRole(p, res.rows[0]);
    return this.toScimGroup(res.rows[0]);
  }

  async deleteGroup(p: ScimPrincipal, id: string) {
    await this.loadGroup(p, id);
    await this.db.query(`DELETE FROM scim_groups WHERE organization_id = $1 AND id = $2`, [p.organizationId, id], { tenantId: p.organizationId });
  }

  /** Admin: map a SCIM group to an organization role (applied to current and future members). */
  async mapGroupRole(organizationId: string, actorId: string | null, id: string, role: string | null) {
    if (role !== null && !MAPPABLE_ROLES.has(role)) throw new ScimError(400, `Role ${role} cannot be assigned through SCIM groups`);
    const res = await this.db.query(
      `UPDATE scim_groups SET mapped_role = $3, updated_at = NOW() WHERE organization_id = $1 AND id = $2 RETURNING *`,
      [organizationId, id, role],
      { tenantId: organizationId }
    );
    if (!res.rows[0]) throw new ScimError(404, 'Group not found');
    await this.applyGroupRole({ organizationId, tokenId: 'admin' }, res.rows[0]);
    await this.audit.record({ organizationId, action: 'scim.group_role_mapped', resourceType: 'ORGANIZATION', resourceId: organizationId, actorId, payload: { groupId: id, role } });
    return { id, displayName: res.rows[0].display_name, mappedRole: role };
  }

  async listGroupsAdmin(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, display_name, mapped_role, jsonb_array_length(member_user_ids) AS members, updated_at FROM scim_groups WHERE organization_id = $1 ORDER BY display_name`,
      [organizationId],
      { tenantId: organizationId }
    );
    return res.rows;
  }

  serviceProviderConfig() {
    return {
      schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
      documentationUri: 'https://erppreflight.com/docs/scim',
      patch: { supported: true },
      bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
      filter: { supported: true, maxResults: 200 },
      changePassword: { supported: false },
      sort: { supported: false },
      etag: { supported: false },
      authenticationSchemes: [{ type: 'oauthbearertoken', name: 'OAuth Bearer Token', description: 'Per-organization SCIM token', primary: true }],
    };
  }

  resourceTypes() {
    return {
      schemas: [SCIM_LIST],
      totalResults: 2,
      Resources: [
        { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'User', name: 'User', endpoint: '/Users', schema: SCIM_USER },
        { schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'], id: 'Group', name: 'Group', endpoint: '/Groups', schema: SCIM_GROUP },
      ],
    };
  }
}

export { HttpStatus };
