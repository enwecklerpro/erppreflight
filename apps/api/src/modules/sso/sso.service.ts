import type { RequestMeta } from '../auth/security-audit.service';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { promises as dnsPromises } from 'node:dns';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { DatabaseService } from '../database/database.service';
import { AuthService } from '../auth/auth.service';
import { CredentialVault } from '../connectors/credential-vault';
import { IntegrationAuditService } from '../connectors/integration-audit.service';
import { parseBody } from '../connectors/zod-body';
import { appBaseUrl } from '../connectors/work-items.service';
import { OutboundPolicy, safeOutboundFetch } from '../../common/security/outbound-request';
import {
  OidcDiscovery,
  OidcError,
  buildAuthorizationUrl,
  createPkcePair,
  normalizeIssuer,
  validateDiscovery,
  verifyIdToken,
} from './oidc';

/**
 * Enterprise identity: OIDC SSO (authorization code + PKCE) with per-organization
 * IdP configuration, verified email domains (DNS TXT) and JIT provisioning
 * (C §8.4, Part 10 §10.2). Successful SSO logins receive exactly the same
 * session JWT as password logins (AuthService.issueSessionForMembership).
 *
 * Security properties:
 *  - IdP client secret encrypted at rest (AES-256-GCM, tenant-bound AAD);
 *  - state = encrypted, expiring blob (org, PKCE verifier, nonce, return path),
 *    additionally bound to the browser by an HttpOnly cookie hash;
 *  - ID token signature (JWKS), iss, aud/azp, exp/iat and nonce are verified;
 *  - the asserted e-mail must be verified by the IdP AND belong to a domain the
 *    organization has proven ownership of via DNS — an IdP cannot log users into
 *    accounts of domains the organization does not control;
 *  - JIT never grants ORGANIZATION_OWNER / SECURITY_ADMIN.
 */

export const JIT_ROLES = ['VIEWER', 'AUDITOR', 'MIGRATION_CONSULTANT', 'LEAD_ARCHITECT'] as const;

export const UpsertIdpSchema = z
  .object({
    issuer: z.string().trim().url().max(1000),
    clientId: z.string().trim().min(1).max(500),
    clientSecret: z.string().min(1).max(2000).optional(),
    scopes: z
      .string()
      .trim()
      .max(500)
      .default('openid email profile')
      .refine((s) => s.split(/\s+/).includes('openid'), 'scopes must include openid'),
    jitProvisioning: z.boolean().default(true),
    defaultRole: z.enum(JIT_ROLES).default('VIEWER'),
    enforceSso: z.boolean().default(false),
    status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
  })
  .strict();

export const AddDomainSchema = z
  .object({
    domain: z
      .string()
      .trim()
      .toLowerCase()
      .max(253)
      .regex(/^(?=.{1,253}$)(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'Must be a DNS domain name (e.g. example.com)'),
  })
  .strict();

const SECRET_PURPOSE = 'sso-client-secret';
const STATE_PURPOSE = 'sso-state';
const STATE_ORG = 'sso-state';
const STATE_TTL_MS = 10 * 60_000;
export const SSO_STATE_COOKIE = 'erppreflight_sso_state';

export interface SsoState {
  o: string; // organization id
  v: string; // PKCE verifier
  n: string; // nonce
  r: string; // return path
  e: number; // expiry (ms)
  h?: string; // login hint
}

export function ssoOutboundPolicy(env: NodeJS.ProcessEnv = process.env): OutboundPolicy {
  return {
    allowPrivateNetworks: env.SSO_ALLOW_PRIVATE_NETWORKS === 'true',
    allowLoopbackInTests: env.SSO_ALLOW_LOOPBACK_IN_TESTS === 'true',
  };
}

export type TxtResolver = (name: string) => Promise<string[][]>;

function defaultTxtResolver(): TxtResolver {
  const servers = (process.env.SSO_DNS_SERVERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!servers.length) return (name) => dnsPromises.resolveTxt(name);
  const resolver = new dnsPromises.Resolver({ timeout: 3000, tries: 2 });
  resolver.setServers(servers);
  return (name) => resolver.resolveTxt(name);
}

@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);
  private txtResolver: TxtResolver = defaultTxtResolver();
  private readonly jwksCache = new Map<string, { at: number; jwks: any }>();

  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly vault: CredentialVault,
    private readonly audit: IntegrationAuditService
  ) {}

  /** Test hook for DNS verification. */
  setTxtResolverForTests(r: TxtResolver) {
    this.txtResolver = r;
  }

  // ---------------------------------------------------------------------------
  // IdP configuration (admin)
  // ---------------------------------------------------------------------------
  private mapIdp(r: any) {
    if (!r) return null;
    return {
      id: r.id,
      protocol: r.protocol,
      issuer: r.issuer,
      clientId: r.client_id,
      hasClientSecret: Boolean(r.client_secret_ciphertext),
      scopes: r.scopes,
      jitProvisioning: r.jit_provisioning,
      defaultRole: r.default_role,
      enforceSso: r.enforce_sso,
      status: r.status,
      discovery: r.discovery
        ? {
            issuer: r.discovery.issuer,
            authorizationEndpoint: r.discovery.authorization_endpoint,
            tokenEndpoint: r.discovery.token_endpoint,
            jwksUri: r.discovery.jwks_uri,
          }
        : null,
      updatedAt: r.updated_at,
    };
  }

  async getConfig(organizationId: string) {
    const res = await this.db.query(`SELECT * FROM sso_identity_providers WHERE organization_id = $1`, [organizationId], {
      tenantId: organizationId,
    });
    return { provider: this.mapIdp(res.rows[0]), redirectUri: this.redirectUri() };
  }

  async discover(issuer: string): Promise<OidcDiscovery> {
    const url = `${normalizeIssuer(issuer)}/.well-known/openid-configuration`;
    const res = await safeOutboundFetch(url, { headers: { Accept: 'application/json' }, timeoutMs: 8000, maxResponseBytes: 512 * 1024, policy: ssoOutboundPolicy() });
    if (res.status !== 200) throw new OidcError(`Discovery endpoint answered HTTP ${res.status}`);
    let doc: any;
    try {
      doc = res.json();
    } catch {
      throw new OidcError('Discovery document is not JSON');
    }
    return validateDiscovery(doc, issuer);
  }

  async upsertConfig(organizationId: string, actorId: string | null, body: unknown) {
    const dto = parseBody(UpsertIdpSchema, body);
    let discovery: OidcDiscovery;
    try {
      discovery = await this.discover(dto.issuer);
    } catch (err: any) {
      throw new BadRequestException(`OIDC discovery failed: ${err instanceof OidcError ? err.message : 'issuer unreachable or blocked by outbound policy'}`);
    }
    const existing = await this.db.query(`SELECT id, client_secret_ciphertext, client_secret_key_id FROM sso_identity_providers WHERE organization_id = $1`, [organizationId], {
      tenantId: organizationId,
    });
    let ciphertext = existing.rows[0]?.client_secret_ciphertext ?? null;
    let keyId = existing.rows[0]?.client_secret_key_id ?? null;
    if (dto.clientSecret) {
      const enc = this.vault.encryptString(organizationId, SECRET_PURPOSE, dto.clientSecret);
      ciphertext = enc.ciphertext;
      keyId = enc.keyId;
    }
    const res = await this.db.query(
      `INSERT INTO sso_identity_providers (id, organization_id, issuer, client_id, client_secret_ciphertext, client_secret_key_id,
         scopes, jit_provisioning, default_role, enforce_sso, status, discovery, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (organization_id) DO UPDATE SET issuer = EXCLUDED.issuer, client_id = EXCLUDED.client_id,
         client_secret_ciphertext = EXCLUDED.client_secret_ciphertext, client_secret_key_id = EXCLUDED.client_secret_key_id,
         scopes = EXCLUDED.scopes, jit_provisioning = EXCLUDED.jit_provisioning, default_role = EXCLUDED.default_role,
         enforce_sso = EXCLUDED.enforce_sso, status = EXCLUDED.status, discovery = EXCLUDED.discovery, updated_at = NOW()
       RETURNING *`,
      [
        existing.rows[0]?.id ?? uuidv4(),
        organizationId,
        normalizeIssuer(dto.issuer),
        dto.clientId,
        ciphertext,
        keyId,
        dto.scopes,
        dto.jitProvisioning,
        dto.defaultRole,
        dto.enforceSso,
        dto.status,
        JSON.stringify(discovery),
        actorId,
      ],
      { tenantId: organizationId }
    );
    await this.audit.record({
      organizationId,
      action: existing.rows[0] ? 'sso.provider_updated' : 'sso.provider_configured',
      resourceType: 'ORGANIZATION',
      resourceId: organizationId,
      actorId,
      payload: { issuer: dto.issuer, clientId: dto.clientId, jit: dto.jitProvisioning, defaultRole: dto.defaultRole, secretRotated: Boolean(dto.clientSecret), status: dto.status },
    });
    return { provider: this.mapIdp(res.rows[0]), redirectUri: this.redirectUri() };
  }

  // ---------------------------------------------------------------------------
  // Domain verification (DNS TXT)
  // ---------------------------------------------------------------------------
  challengeRecordName(domain: string) {
    return `_erppreflight-challenge.${domain}`;
  }

  private mapDomain(r: any) {
    return {
      id: r.id,
      domain: r.domain,
      status: r.status,
      verifiedAt: r.verified_at,
      lastCheckedAt: r.last_checked_at,
      dnsRecord: { type: 'TXT', name: this.challengeRecordName(r.domain), value: `erppreflight-domain-verification=${r.verification_token}` },
    };
  }

  async listDomains(organizationId: string) {
    const res = await this.db.query(`SELECT * FROM sso_domains WHERE organization_id = $1 ORDER BY domain`, [organizationId], { tenantId: organizationId });
    return res.rows.map((r: any) => this.mapDomain(r));
  }

  async addDomain(organizationId: string, actorId: string | null, body: unknown) {
    const { domain } = parseBody(AddDomainSchema, body);
    const taken = await this.db.query(`SELECT organization_id FROM sso_domains WHERE domain = $1 AND status = 'VERIFIED'`, [domain], { bypassRls: true });
    if (taken.rows[0] && taken.rows[0].organization_id !== organizationId) {
      throw new ConflictException('This domain is already verified by another organization');
    }
    try {
      const res = await this.db.query(
        `INSERT INTO sso_domains (id, organization_id, domain, verification_token) VALUES ($1,$2,$3,$4) RETURNING *`,
        [uuidv4(), organizationId, domain, crypto.randomBytes(18).toString('base64url')],
        { tenantId: organizationId }
      );
      await this.audit.record({ organizationId, action: 'sso.domain_added', resourceType: 'ORGANIZATION', resourceId: organizationId, actorId, payload: { domain } });
      return this.mapDomain(res.rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException('Domain already added');
      throw err;
    }
  }

  async verifyDomain(organizationId: string, actorId: string | null, id: string) {
    const res = await this.db.query(`SELECT * FROM sso_domains WHERE organization_id = $1 AND id = $2`, [organizationId, id], { tenantId: organizationId });
    const d = res.rows[0];
    if (!d) throw new NotFoundException('Domain not found');
    const expected = `erppreflight-domain-verification=${d.verification_token}`;
    let records: string[][] = [];
    let lookupError: string | null = null;
    try {
      records = await this.txtResolver(this.challengeRecordName(d.domain));
    } catch (err: any) {
      lookupError = err?.code || 'DNS lookup failed';
    }
    const found = records.some((chunks) => chunks.join('') === expected);
    let status = found ? 'VERIFIED' : 'FAILED';
    try {
      const upd = await this.db.query(
        `UPDATE sso_domains SET status = $3::varchar, last_checked_at = NOW(), verified_at = CASE WHEN $3::varchar = 'VERIFIED' THEN NOW() ELSE verified_at END
          WHERE organization_id = $1 AND id = $2 RETURNING *`,
        [organizationId, id, status],
        { tenantId: organizationId }
      );
      await this.audit.record({
        organizationId,
        action: found ? 'sso.domain_verified' : 'sso.domain_verification_failed',
        resourceType: 'ORGANIZATION',
        resourceId: organizationId,
        actorId,
        payload: { domain: d.domain, lookupError },
      });
      return { ...this.mapDomain(upd.rows[0]), verified: found, lookupError };
    } catch (err: any) {
      if (err?.code === '23505') {
        status = 'FAILED';
        throw new ConflictException('This domain is already verified by another organization');
      }
      throw err;
    }
  }

  async removeDomain(organizationId: string, actorId: string | null, id: string) {
    const res = await this.db.query(`DELETE FROM sso_domains WHERE organization_id = $1 AND id = $2 RETURNING domain`, [organizationId, id], { tenantId: organizationId });
    if (!res.rows[0]) throw new NotFoundException('Domain not found');
    await this.audit.record({ organizationId, action: 'sso.domain_removed', resourceType: 'ORGANIZATION', resourceId: organizationId, actorId, payload: { domain: res.rows[0].domain } });
    return { success: true };
  }

  // ---------------------------------------------------------------------------
  // Login flow
  // ---------------------------------------------------------------------------
  redirectUri(requestOrigin?: string): string {
    const base = process.env.SSO_REDIRECT_BASE_URL || process.env.API_PUBLIC_URL || requestOrigin || `http://localhost:${process.env.PORT || 3001}`;
    return `${base.replace(/\/+$/, '')}/api/v1/sso/callback`;
  }

  /** Resolves the organization for an e-mail via its VERIFIED domain with an ACTIVE IdP. */
  async discoverForEmail(email: string) {
    const domain = String(email || '').toLowerCase().split('@')[1];
    if (!domain) return { ssoAvailable: false };
    const res = await this.db.query(
      `SELECT d.organization_id, o.name, p.enforce_sso FROM sso_domains d
         JOIN sso_identity_providers p ON p.organization_id = d.organization_id AND p.status = 'ACTIVE'
         JOIN organizations o ON o.id = d.organization_id AND o.status = 'ACTIVE'
        WHERE d.domain = $1 AND d.status = 'VERIFIED'`,
      [domain],
      { bypassRls: true }
    );
    const r = res.rows[0];
    if (!r) return { ssoAvailable: false };
    return { ssoAvailable: true, organizationName: r.name, enforceSso: r.enforce_sso, loginUrl: `/api/v1/sso/login?email=${encodeURIComponent(email)}` };
  }

  sealState(state: SsoState): string {
    return Buffer.from(this.vault.encryptJson(STATE_ORG, STATE_PURPOSE, state).ciphertext, 'utf8').toString('base64url');
  }

  openState(raw: string): SsoState {
    let st: SsoState;
    try {
      st = this.vault.decryptJson<SsoState>(STATE_ORG, STATE_PURPOSE, Buffer.from(String(raw || ''), 'base64url').toString('utf8'));
    } catch {
      throw new UnauthorizedException('Invalid SSO state');
    }
    if (!st?.o || !st.v || !st.n || typeof st.e !== 'number' || st.e < Date.now()) {
      throw new UnauthorizedException('SSO state expired');
    }
    return st;
  }

  static stateCookieValue(state: string): string {
    return crypto.createHash('sha256').update(state).digest('base64url');
  }

  private async loadProvider(organizationId: string) {
    const res = await this.db.query(`SELECT * FROM sso_identity_providers WHERE organization_id = $1 AND status = 'ACTIVE'`, [organizationId], {
      tenantId: organizationId,
    });
    const p = res.rows[0];
    if (!p) throw new NotFoundException('SSO is not configured for this organization');
    return p;
  }

  async startLogin(params: { email?: string; organizationId?: string; returnTo?: string }, requestOrigin?: string) {
    let organizationId = params.organizationId;
    if (!organizationId && params.email) {
      const found = await this.discoverForEmail(params.email);
      if (!found.ssoAvailable) throw new NotFoundException('No SSO configuration for this e-mail domain');
      const domain = params.email.toLowerCase().split('@')[1];
      const r = await this.db.query(`SELECT organization_id FROM sso_domains WHERE domain = $1 AND status = 'VERIFIED'`, [domain], { bypassRls: true });
      organizationId = r.rows[0]?.organization_id;
    }
    if (!organizationId) throw new BadRequestException('email or organizationId is required');
    const provider = await this.loadProvider(organizationId);
    const pkce = createPkcePair();
    const nonce = crypto.randomBytes(18).toString('base64url');
    const returnTo = params.returnTo && /^\/[A-Za-z0-9/_\-?=&.]*$/.test(params.returnTo) && !params.returnTo.startsWith('//') ? params.returnTo : '/';
    const state = this.sealState({ o: organizationId, v: pkce.verifier, n: nonce, r: returnTo, e: Date.now() + STATE_TTL_MS, h: params.email });
    const url = buildAuthorizationUrl(provider.discovery, {
      clientId: provider.client_id,
      redirectUri: this.redirectUri(requestOrigin),
      scope: provider.scopes,
      state,
      nonce,
      codeChallenge: pkce.challenge,
      loginHint: params.email,
    });
    return { authorizationUrl: url, state };
  }

  private async fetchJwks(uri: string) {
    const hit = this.jwksCache.get(uri);
    if (hit && Date.now() - hit.at < 10 * 60_000) return hit.jwks;
    const res = await safeOutboundFetch(uri, { headers: { Accept: 'application/json' }, timeoutMs: 8000, maxResponseBytes: 256 * 1024, policy: ssoOutboundPolicy() });
    if (res.status !== 200) throw new OidcError(`JWKS endpoint answered HTTP ${res.status}`);
    const jwks = res.json();
    this.jwksCache.set(uri, { at: Date.now(), jwks });
    return jwks;
  }

  async completeLogin(
    query: { code?: string; state?: string; error?: string },
    cookieStateHash: string | undefined,
    requestOrigin?: string,
    meta: RequestMeta = {}
  ) {
    if (query.error) throw new UnauthorizedException(`Identity provider returned error: ${String(query.error).slice(0, 80)}`);
    if (!query.code || !query.state) throw new BadRequestException('Missing code or state');
    const st = this.openState(query.state);
    if (!cookieStateHash || cookieStateHash !== SsoService.stateCookieValue(query.state)) {
      throw new UnauthorizedException('SSO state is not bound to this browser session');
    }
    const organizationId = st.o;
    const provider = await this.loadProvider(organizationId);
    const discovery: OidcDiscovery = provider.discovery;

    // 1. Code → tokens (PKCE)
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: this.redirectUri(requestOrigin),
      code_verifier: st.v,
      client_id: provider.client_id,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    if (provider.client_secret_ciphertext) {
      const secret = this.vault.decryptString(organizationId, SECRET_PURPOSE, provider.client_secret_ciphertext);
      headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(provider.client_id)}:${encodeURIComponent(secret)}`).toString('base64')}`;
    }
    const tokenRes = await safeOutboundFetch(discovery.token_endpoint, {
      method: 'POST',
      headers,
      body: form.toString(),
      timeoutMs: 10_000,
      maxResponseBytes: 256 * 1024,
      policy: ssoOutboundPolicy(),
    });
    if (tokenRes.status !== 200) {
      await this.failed(organizationId, 'TOKEN_EXCHANGE_FAILED', { httpStatus: tokenRes.status });
      throw new UnauthorizedException('Token exchange with the identity provider failed');
    }
    let tokenBody: any;
    try {
      tokenBody = tokenRes.json();
    } catch {
      throw new UnauthorizedException('Identity provider returned a non-JSON token response');
    }
    if (!tokenBody?.id_token) throw new UnauthorizedException('Identity provider did not return an id_token');

    // 2. Validate the ID token
    let claims;
    try {
      const jwks = await this.fetchJwks(discovery.jwks_uri);
      claims = verifyIdToken(tokenBody.id_token, jwks, { issuer: provider.issuer, audience: provider.client_id, nonce: st.n });
    } catch (err: any) {
      await this.failed(organizationId, 'ID_TOKEN_INVALID', { reason: err?.message });
      throw new UnauthorizedException('ID token validation failed');
    }
    const email = String(claims.email || '').trim().toLowerCase();
    const emailVerified = claims.email_verified === true || claims.email_verified === 'true';
    if (!email || !emailVerified) {
      await this.failed(organizationId, 'EMAIL_NOT_VERIFIED', { sub: claims.sub });
      throw new UnauthorizedException('The identity provider did not assert a verified e-mail address');
    }
    const domain = email.split('@')[1];
    const dom = await this.db.query(`SELECT id FROM sso_domains WHERE organization_id = $1 AND domain = $2 AND status = 'VERIFIED'`, [organizationId, domain], {
      tenantId: organizationId,
    });
    if (!dom.rows[0]) {
      await this.failed(organizationId, 'DOMAIN_NOT_VERIFIED', { domain });
      throw new UnauthorizedException(`E-mail domain ${domain} is not verified for this organization`);
    }

    // 3. Resolve / JIT-provision the user and membership
    const userId = await this.resolveUser(organizationId, provider, email, claims);
    const session = await this.auth.issueSessionForMembership(userId, organizationId, meta);
    await this.audit.record({
      organizationId,
      action: 'sso.login_succeeded',
      resourceType: 'USER',
      resourceId: userId,
      actorId: userId,
      payload: { issuer: provider.issuer, sub: claims.sub, email },
    });
    return { session, returnTo: st.r || '/' };
  }

  private async failed(organizationId: string, reason: string, details: Record<string, unknown>) {
    this.logger.warn(`SSO login failed for org ${organizationId}: ${reason}`);
    await this.audit.record({ organizationId, action: 'sso.login_failed', resourceType: 'ORGANIZATION', resourceId: organizationId, payload: { reason, ...details } });
  }

  private async resolveUser(organizationId: string, provider: any, email: string, claims: any): Promise<string> {
    const existing = await this.db.query(`SELECT id, status FROM users WHERE email = $1`, [email], { bypassRls: true });
    let userId: string | undefined = existing.rows[0]?.id;
    if (existing.rows[0] && existing.rows[0].status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    const fullName = String(claims.name || [claims.given_name, claims.family_name].filter(Boolean).join(' ') || '').slice(0, 255);
    if (!userId) {
      if (!provider.jit_provisioning) {
        await this.failed(organizationId, 'USER_NOT_PROVISIONED', { email });
        throw new UnauthorizedException('Your account has not been provisioned for this organization');
      }
      userId = uuidv4();
      // SSO-only account: the password hash is not an Argon2 hash, so password login is impossible.
      await this.db.query(
        `INSERT INTO users (id, email, password_hash, full_name, system_role, status, email_verified_at)
         VALUES ($1,$2,$3,$4,'USER','ACTIVE',NOW())`,
        [userId, email, '!sso-only', fullName],
        { bypassRls: true }
      );
    } else {
      // The IdP asserted email_verified for an address on a DNS-verified domain of this
      // organization: that proves mailbox ownership as strongly as the e-mail link does.
      await this.db.query(`UPDATE users SET email_verified_at = NOW() WHERE id = $1 AND email_verified_at IS NULL`, [userId], {
        bypassRls: true,
      });
    }
    const member = await this.db.query(`SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`, [organizationId, userId], {
      tenantId: organizationId,
    });
    if (!member.rows[0]) {
      if (!provider.jit_provisioning) {
        await this.failed(organizationId, 'USER_NOT_PROVISIONED', { email });
        throw new UnauthorizedException('Your account has not been provisioned for this organization');
      }
      await this.db.withTenantTransaction(organizationId, async (client) => {
        await client.query(
          `INSERT INTO organization_members (id, organization_id, user_id, role) VALUES ($1,$2,$3,$4) ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [uuidv4(), organizationId, userId, provider.default_role]
        );
        await client.query(
          `INSERT INTO scim_user_links (id, organization_id, user_id, external_id, user_name, source)
           VALUES ($1,$2,$3,$4,$5,'OIDC_JIT') ON CONFLICT (organization_id, user_id) DO NOTHING`,
          [uuidv4(), organizationId, userId, String(claims.sub).slice(0, 255), email]
        );
      });
      await this.audit.record({
        organizationId,
        action: 'sso.jit_user_provisioned',
        resourceType: 'USER',
        resourceId: userId,
        payload: { email, role: provider.default_role, issuer: provider.issuer },
      });
    }
    return userId!;
  }

  webCompletionUrl(token: string, organizationId: string, returnTo: string): string {
    const frag = new URLSearchParams({ token, org: organizationId, next: returnTo });
    return `${appBaseUrl()}/sso/done#${frag.toString()}`;
  }

  webErrorUrl(code: string): string {
    return `${appBaseUrl()}/login?sso_error=${encodeURIComponent(code)}`;
  }
}
