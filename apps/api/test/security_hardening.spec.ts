import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  BadRequestException,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { TenancyContext } from '@erppreflight/tenancy';
import { TenancyMiddleware } from '../src/modules/tenancy/tenancy.middleware';
import { JwtAuthGuard } from '../src/modules/auth/guards/jwt-auth.guard';
import {
  AuthRateLimitGuard,
  LOGIN_RATE_LIMIT,
  AUTH_RATE_LIMIT_KEY,
} from '../src/modules/auth/guards/auth-rate-limit.guard';
import { DENY_API_KEY_AUTH, apiKeyScopesAllow } from '../src/modules/api-keys/api-key-scopes';
import { validateEnv, NON_PRODUCTION_DEFAULTS } from '../src/config/env.validation';
import { DatabaseService, resolveRuntimeRole } from '../src/modules/database/database.service';
import { MetricsAccessGuard } from '../src/modules/telemetry/metrics-access.guard';
import { BillingService } from '../src/modules/billing/billing.service';
import { CurrentTenant } from '../src/common/decorators/current-tenant.decorator';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';

const JWT_SECRET = 'unit-test-jwt-secret-0123456789abcdef-0123456789';
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_1 = '11111111-1111-4111-8111-111111111111';

function configWith(values: Record<string, any>) {
  return {
    get: vi.fn((key: string) => values[key]),
    getOrThrow: vi.fn((key: string) => {
      if (values[key] === undefined) throw new Error(`missing ${key}`);
      return values[key];
    }),
  } as any;
}

function signToken(payload: Record<string, any>, secret = JWT_SECRET) {
  return new JwtService({ secret }).sign(payload);
}

/** Runs the middleware and captures the tenant context visible to `next()`. */
async function runMiddleware(mw: TenancyMiddleware, req: any) {
  let seen: any = 'next-not-called';
  await mw.use(req, {} as any, () => {
    seen = TenancyContext.get() ?? null;
  });
  return seen;
}

describe('C2/H1: TenancyMiddleware only establishes membership-verified tenants', () => {
  let db: any;
  let mw: TenancyMiddleware;

  beforeEach(() => {
    db = { query: vi.fn() };
    mw = new TenancyMiddleware(db, configWith({ JWT_SECRET }));
  });

  it('rejects an X-Tenant-Id the user is not a member of (403)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ status: 'ACTIVE', system_role: 'USER', member_role: null }],
    });
    const token = signToken({ sub: USER_1, organizationId: TENANT_A, role: 'VIEWER' });
    await expect(
      runMiddleware(mw, { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_B } })
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.query.mock.calls[0][1]).toEqual([TENANT_B, USER_1]);
    expect(db.query.mock.calls[0][2]).toEqual({ bypassRls: true });
  });

  it('establishes context and tenantRole for a verified member', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ status: 'ACTIVE', system_role: 'USER', member_role: 'LEAD_ARCHITECT' }],
    });
    const token = signToken({ sub: USER_1, organizationId: TENANT_A, role: 'VIEWER' });
    const req: any = { headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_B } };
    const ctx = await runMiddleware(mw, req);
    expect(ctx.tenantId).toBe(TENANT_B);
    expect(req.tenantId).toBe(TENANT_B);
    expect(req.tenantRole).toBe('LEAD_ARCHITECT');
  });

  it("falls back to the token's organization when no header is sent (cookie / anchor downloads)", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ status: 'ACTIVE', system_role: 'USER', member_role: 'ORGANIZATION_OWNER' }],
    });
    const token = signToken({ sub: USER_1, organizationId: TENANT_A, role: 'ORGANIZATION_OWNER' });
    const req: any = { headers: { cookie: `erppreflight_session=${encodeURIComponent(token)}` } };
    const ctx = await runMiddleware(mw, req);
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  it('re-verifies membership of the token organization (revoked membership -> 403)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ status: 'ACTIVE', system_role: 'USER', member_role: null }],
    });
    const token = signToken({ sub: USER_1, organizationId: TENANT_A, role: 'ORGANIZATION_OWNER' });
    await expect(
      runMiddleware(mw, { headers: { authorization: `Bearer ${token}` } })
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects suspended users even with a valid token (401)', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ status: 'SUSPENDED', system_role: 'USER', member_role: 'ORGANIZATION_OWNER' }],
    });
    const token = signToken({ sub: USER_1, organizationId: TENANT_A });
    await expect(
      runMiddleware(mw, { headers: { authorization: `Bearer ${token}` } })
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows SUPER_ADMIN to act in any tenant', async () => {
    db.query.mockResolvedValueOnce({
      rows: [{ status: 'ACTIVE', system_role: 'SUPER_ADMIN', member_role: null }],
    });
    const token = signToken({ sub: USER_1, organizationId: TENANT_A, systemRole: 'SUPER_ADMIN' });
    const ctx = await runMiddleware(mw, {
      headers: { authorization: `Bearer ${token}`, 'x-tenant-id': TENANT_B },
    });
    expect(ctx.tenantId).toBe(TENANT_B);
  });

  it('never establishes context from an unauthenticated / forged header', async () => {
    expect(await runMiddleware(mw, { headers: { 'x-tenant-id': TENANT_B } })).toBeNull();
    const forged = signToken({ sub: USER_1, organizationId: TENANT_B }, 'attacker-secret-attacker-secret-xx');
    expect(
      await runMiddleware(mw, { headers: { authorization: `Bearer ${forged}`, 'x-tenant-id': TENANT_B } })
    ).toBeNull();
    expect(db.query).not.toHaveBeenCalled();
  });

  it('rejects malformed tenant ids (400)', async () => {
    await expect(
      runMiddleware(mw, { headers: { 'x-tenant-id': "x' OR 1=1" } })
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('binds API keys to their own organization; mismatching header -> 403', async () => {
    db.query.mockResolvedValue({ rows: [{ organization_id: TENANT_A, created_by: USER_1 }] });
    await expect(
      runMiddleware(mw, { headers: { 'x-api-key': 'erppf_live_x', 'x-tenant-id': TENANT_B } })
    ).rejects.toBeInstanceOf(ForbiddenException);
    const ctx = await runMiddleware(mw, { headers: { 'x-api-key': 'erppf_live_x' } });
    expect(ctx.tenantId).toBe(TENANT_A);
    expect(db.query.mock.calls[0][0]).toMatch(/expires_at IS NULL OR expires_at > NOW\(\)/);
  });
});

describe('C2: @CurrentTenant never trusts the raw header', () => {
  function currentTenantFactory() {
    class Probe {
      handler(@CurrentTenant() _t: string) {}
    }
    const meta = Reflect.getMetadata(ROUTE_ARGS_METADATA, Probe, 'handler');
    const key = Object.keys(meta)[0];
    return meta[key].factory as (data: unknown, ctx: ExecutionContext) => string;
  }
  const httpCtx = (req: any) => ({ switchToHttp: () => ({ getRequest: () => req }) }) as any;

  it('throws 403 when only an unverified X-Tenant-Id header is present', () => {
    const factory = currentTenantFactory();
    expect(() => factory(undefined, httpCtx({ headers: { 'x-tenant-id': TENANT_B } }))).toThrow(
      ForbiddenException
    );
  });

  it('returns the verified tenant', () => {
    const factory = currentTenantFactory();
    expect(factory(undefined, httpCtx({ tenantId: TENANT_A, headers: { 'x-tenant-id': TENANT_B } }))).toBe(
      TENANT_A
    );
  });
});

describe('H5: API key restrictions in JwtAuthGuard', () => {
  const ctxFor = (req: any, handler = () => undefined, cls: any = class {}) =>
    ({
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => handler,
      getClass: () => cls,
    }) as any;

  it('rejects API keys on routes marked @DenyApiKeyAuth (api-keys, webhooks)', async () => {
    const apiKeys: any = { validateKey: vi.fn() };
    const reflector = new Reflector();
    const guard = new JwtAuthGuard(apiKeys, reflector);
    class Ctrl {}
    Reflect.defineMetadata(DENY_API_KEY_AUTH, true, Ctrl);
    await expect(
      guard.canActivate(ctxFor({ method: 'POST', headers: { 'x-api-key': 'k' } }, () => undefined, Ctrl))
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(apiKeys.validateKey).not.toHaveBeenCalled();
  });

  it('enforces read vs write scopes', async () => {
    const apiKeys: any = {
      validateKey: vi.fn().mockResolvedValue({
        organization_id: TENANT_A,
        created_by: USER_1,
        scopes: JSON.stringify(['projects:read', 'reports:read']),
      }),
    };
    const guard = new JwtAuthGuard(apiKeys, new Reflector());
    await expect(
      guard.canActivate(ctxFor({ method: 'POST', headers: { 'x-api-key': 'k' } }))
    ).rejects.toBeInstanceOf(ForbiddenException);
    const req: any = { method: 'GET', headers: { 'x-api-key': 'k' } };
    await expect(guard.canActivate(ctxFor(req))).resolves.toBe(true);
    expect(req.user.role).toBe('API_CLIENT');
    expect(req.tenantId).toBe(TENANT_A);
  });

  it('scope helper: write/run scopes allow mutations, unknown scopes are ignored', () => {
    expect(apiKeyScopesAllow('POST', ['analysis:run'])).toBe(true);
    expect(apiKeyScopesAllow('DELETE', ['projects:write'])).toBe(true);
    expect(apiKeyScopesAllow('PATCH', ['projects:read'])).toBe(false);
    expect(apiKeyScopesAllow('POST', ['*', 'admin:all'])).toBe(false);
    expect(apiKeyScopesAllow('GET', [])).toBe(false);
  });
});

describe('M3: auth rate limiting', () => {
  const envBackup = process.env.AUTH_RATE_LIMIT_SCALE;
  afterEach(() => {
    if (envBackup === undefined) delete process.env.AUTH_RATE_LIMIT_SCALE;
    else process.env.AUTH_RATE_LIMIT_SCALE = envBackup;
  });

  it('returns 429 after the per IP+email budget and sets Retry-After', () => {
    process.env.AUTH_RATE_LIMIT_SCALE = '1';
    const reflector = new Reflector();
    const guard = new AuthRateLimitGuard(reflector);
    const handler = () => undefined;
    Reflect.defineMetadata(AUTH_RATE_LIMIT_KEY, LOGIN_RATE_LIMIT, handler);
    const headers: Record<string, string> = {};
    const ctx = (email: string) =>
      ({
        getHandler: () => handler,
        getClass: () => class {},
        switchToHttp: () => ({
          getRequest: () => ({ ip: '203.0.113.9', body: { email } }),
          getResponse: () => ({ setHeader: (k: string, v: string) => (headers[k] = v) }),
        }),
      }) as any;

    for (let i = 0; i < LOGIN_RATE_LIMIT.maxPerIpAndEmail; i++) {
      expect(guard.canActivate(ctx('Victim@Example.com'))).toBe(true);
    }
    let error: any;
    try {
      guard.canActivate(ctx('victim@example.com'));
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(HttpException);
    expect(error.getStatus()).toBe(429);
    expect(Number(headers['Retry-After'])).toBeGreaterThan(0);
    // A different account from the same IP is still allowed (per-IP budget is larger)
    expect(guard.canActivate(ctx('other@example.com'))).toBe(true);
  });
});

describe('H3/M6: environment validation', () => {
  const prodBase = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://app:strong@db:5432/erppreflight',
    JWT_SECRET: 'a'.repeat(40) + 'b'.repeat(24),
    S3_ACCESS_KEY: 'prod-access-key',
    S3_SECRET_KEY: 'prod-secret-key-value',
    MASTER_ENCRYPTION_KEY: 'c'.repeat(64),
    MAIL_TRANSPORT: 'smtp',
    SMTP_HOST: 'smtp.example.com',
    MAIL_FROM: 'ERP Preflight <no-reply@example.com>',
    APP_PUBLIC_URL: 'https://app.example.com',
  };
  let errSpy: any;
  beforeEach(() => {
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => errSpy.mockRestore());

  it.each(['JWT_SECRET', 'MASTER_ENCRYPTION_KEY', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'DATABASE_URL'])(
    'fails at startup in production when %s is missing',
    (key) => {
      const cfg: any = { ...prodBase };
      delete cfg[key];
      expect(() => validateEnv(cfg)).toThrow(/validation failed/);
    }
  );

  it('rejects well-known default secrets in production', () => {
    expect(() =>
      validateEnv({ ...prodBase, JWT_SECRET: 'secret-key-must-be-at-least-32-chars-long-abcdef123456' })
    ).toThrow();
    expect(() => validateEnv({ ...prodBase, S3_ACCESS_KEY: 'minioadmin' })).toThrow();
    expect(() =>
      validateEnv({ ...prodBase, MASTER_ENCRYPTION_KEY: NON_PRODUCTION_DEFAULTS.MASTER_ENCRYPTION_KEY })
    ).toThrow();
  });

  it('defaults CLAMAV_MOCK_MODE to false in production and true in development', () => {
    expect(validateEnv({ ...prodBase }).CLAMAV_MOCK_MODE).toBe(false);
    expect(validateEnv({ NODE_ENV: 'development' }).CLAMAV_MOCK_MODE).toBe(true);
    expect(validateEnv({ NODE_ENV: 'development', CLAMAV_MOCK_MODE: 'false' }).CLAMAV_MOCK_MODE).toBe(false);
  });

  it('fills development-only defaults outside production', () => {
    const env = validateEnv({ NODE_ENV: 'development' });
    expect(env.JWT_SECRET).toBe(NON_PRODUCTION_DEFAULTS.JWT_SECRET);
    expect(env.S3_ACCESS_KEY).toBe('minioadmin');
  });
});

describe('C1: DatabaseService runtime role (RLS enforcement)', () => {
  it('resolves the runtime role (default on in production, explicit opt-out, identifier validation)', () => {
    expect(resolveRuntimeRole(undefined, 'production')).toBe('erppreflight_app');
    expect(resolveRuntimeRole(undefined, 'development')).toBeNull();
    expect(resolveRuntimeRole('none', 'production')).toBeNull();
    expect(resolveRuntimeRole('erppreflight_app', 'development')).toBe('erppreflight_app');
    expect(() => resolveRuntimeRole('x"; DROP TABLE users; --', 'production')).toThrow();
  });

  it('issues SET LOCAL ROLE inside every tenant transaction, before the tenant GUC', async () => {
    const calls: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        calls.push(sql);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const svc = new DatabaseService(configWith({}));
    (svc as any).pool = { connect: vi.fn().mockResolvedValue(client) };
    (svc as any).runtimeRole = 'erppreflight_app';

    await svc.query('SELECT 1', [], { tenantId: TENANT_A });
    expect(calls).toEqual([
      'BEGIN',
      'SET LOCAL ROLE "erppreflight_app"',
      "SELECT set_config('app.current_tenant_id', $1, true)",
      'SELECT 1',
      'COMMIT',
    ]);

    calls.length = 0;
    await svc.query('SELECT 2', [], { bypassRls: true });
    expect(calls).toEqual(['SELECT 2']);
  });

  it('fails startup when the runtime role is missing or privileged', async () => {
    const svc = new DatabaseService(
      configWith({ DATABASE_URL: 'postgres://u:p@localhost:1/db', DB_RUNTIME_ROLE: 'erppreflight_app' })
    );
    const originalInit = svc.onModuleInit.bind(svc);
    // Replace pool creation with a stub after construction
    const PgPool = (await import('pg')).Pool;
    const spy = vi.spyOn(PgPool.prototype, 'query').mockResolvedValueOnce({
      rows: [{ rolsuper: false, rolbypassrls: true, is_member: true }],
    } as any);
    await expect(originalInit()).rejects.toThrow(/NOBYPASSRLS/);
    spy.mockResolvedValueOnce({ rows: [] } as any);
    await expect(svc.onModuleInit()).rejects.toThrow(/does not exist/);
    spy.mockRestore();
  });
});

describe('M5: /metrics access', () => {
  const ctx = (headers: Record<string, string>) =>
    ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as any;

  it('accepts the configured METRICS_TOKEN', async () => {
    const guard = new MetricsAccessGuard(
      configWith({ METRICS_TOKEN: 'scrape-token-0123456789', JWT_SECRET }),
      { query: vi.fn() } as any
    );
    await expect(guard.canActivate(ctx({ authorization: 'Bearer scrape-token-0123456789' }))).resolves.toBe(true);
    await expect(guard.canActivate(ctx({ authorization: 'Bearer wrong' }))).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });

  it('is hidden (404) in production without METRICS_TOKEN for anonymous callers', async () => {
    const guard = new MetricsAccessGuard(configWith({ NODE_ENV: 'production', JWT_SECRET }), { query: vi.fn() } as any);
    await expect(guard.canActivate(ctx({}))).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows an active SUPER_ADMIN session and rejects regular users', async () => {
    const db = { query: vi.fn() };
    const guard = new MetricsAccessGuard(configWith({ JWT_SECRET }), db as any);
    const token = signToken({ sub: USER_1, organizationId: TENANT_A });
    db.query.mockResolvedValueOnce({ rows: [{ system_role: 'SUPER_ADMIN', status: 'ACTIVE' }] });
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${token}` }))).resolves.toBe(true);
    db.query.mockResolvedValueOnce({ rows: [{ system_role: 'USER', status: 'ACTIVE' }] });
    await expect(guard.canActivate(ctx({ authorization: `Bearer ${token}` }))).rejects.toBeInstanceOf(
      UnauthorizedException
    );
  });
});

describe('M7: billing checkout validation & webhook', () => {
  it('only accepts returnUrl on allowlisted origins', () => {
    const svc = new BillingService({} as any, configWith({ CORS_ORIGIN: 'https://erppreflight.com' }));
    expect(svc.resolveReturnUrl('https://erppreflight.com/settings/billing', 'success')).toBe(
      'https://erppreflight.com/settings/billing?status=success'
    );
    expect(() => svc.resolveReturnUrl('https://evil.example/phish')).toThrow(BadRequestException);
    expect(() => svc.resolveReturnUrl('javascript:alert(1)')).toThrow(BadRequestException);
    expect(() => svc.resolveReturnUrl('//evil.example')).toThrow(BadRequestException);
  });

  it('rejects non-purchasable tiers and refuses placeholder checkout in production', async () => {
    const svc = new BillingService({} as any, configWith({ NODE_ENV: 'production' }));
    await expect(svc.createCheckoutSession(TENANT_A, 'FREE')).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.createCheckoutSession(TENANT_A, 'PROFESSIONAL')).rejects.toBeInstanceOf(
      ServiceUnavailableException
    );
  });

  it('verifies the Stripe signature over the raw Buffer body', async () => {
    const crypto = await import('node:crypto');
    const db: any = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      withTenantTransaction: vi.fn(async (_t: string, cb: any) => cb(db)),
    };
    const svc = new BillingService(db, configWith({ STRIPE_WEBHOOK_SECRET: 'whsec_test' }));
    const body = Buffer.from(
      JSON.stringify({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: TENANT_A, metadata: { target_tier: 'STARTER' } } },
      })
    );
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', 'whsec_test').update(`${t}.${body.toString('utf-8')}`).digest('hex');
    await expect(svc.handleWebhook(`t=${t},v1=deadbeef,v1=${sig}`, body)).resolves.toEqual({ received: true });
    await expect(svc.handleWebhook(`t=${t},v1=${'0'.repeat(64)}`, body)).rejects.toBeInstanceOf(
      BadRequestException
    );
  });
});
