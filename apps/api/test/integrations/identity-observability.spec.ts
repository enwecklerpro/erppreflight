import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as crypto from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import {
  OidcError,
  buildAuthorizationUrl,
  createPkcePair,
  validateDiscovery,
  verifyIdToken,
} from '../../src/modules/sso/oidc';
import { buildPinoOptions, scrubSecrets } from '../../src/observability/logger';
import { runWithRequestContext } from '../../src/observability/request-context';
import { SentryErrorReporter, parseSentryDsn, createErrorReporter } from '../../src/observability/error-reporter';
import { isTracingConfigured } from '../../src/observability/tracing';
import { TenancyContext } from '@erppreflight/tenancy';
import { zodToOpenApi } from '../../src/common/openapi/zod-openapi';
import { CreateConnectorSchema } from '../../src/modules/connectors/connectors.service';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const doubles = require('../doubles/doubles.cjs');

describe('OIDC helpers', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'k1', alg: 'RS256', use: 'sig' };
  const now = Math.floor(Date.now() / 1000);
  const sign = (claims: any, header: any = { alg: 'RS256', kid: 'k1' }) => {
    const h = Buffer.from(JSON.stringify(header)).toString('base64url');
    const p = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${h}.${p}.${crypto.sign('sha256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url')}`;
  };
  const base = { iss: 'https://idp.example.com', aud: 'client-1', sub: 's1', exp: now + 60, iat: now, nonce: 'n1', email: 'a@x.com', email_verified: true };
  const expected = { issuer: 'https://idp.example.com/', audience: 'client-1', nonce: 'n1' };

  it('accepts a valid RS256 ID token', () => {
    expect(verifyIdToken(sign(base), { keys: [jwk] }, expected).sub).toBe('s1');
  });

  it.each([
    ['nonce', { nonce: 'other' }, /nonce/],
    ['audience', { aud: 'other' }, /audience/],
    ['issuer', { iss: 'https://evil.example.com' }, /issuer/],
    ['expiry', { exp: now - 3600 }, /expired/],
  ])('rejects a wrong %s', (_n, patch, re) => {
    expect(() => verifyIdToken(sign({ ...base, ...patch }), { keys: [jwk] }, expected)).toThrow(re as RegExp);
  });

  it('rejects alg=none and forged signatures', () => {
    const none = `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(base)).toString('base64url')}.`;
    expect(() => verifyIdToken(none, { keys: [jwk] }, expected)).toThrow(OidcError);
    const t = sign(base).split('.');
    t[1] = Buffer.from(JSON.stringify({ ...base, sub: 'admin' })).toString('base64url');
    expect(() => verifyIdToken(t.join('.'), { keys: [jwk] }, expected)).toThrow(/signature/);
  });

  it('validates discovery issuer and PKCE support; builds S256 authorization URLs', () => {
    const doc = { issuer: 'https://idp.example.com', authorization_endpoint: 'https://idp.example.com/auth', token_endpoint: 'https://idp.example.com/token', jwks_uri: 'https://idp.example.com/jwks', code_challenge_methods_supported: ['S256'] };
    expect(validateDiscovery(doc, 'https://idp.example.com/').issuer).toBe('https://idp.example.com');
    expect(() => validateDiscovery({ ...doc, issuer: 'https://other' }, 'https://idp.example.com')).toThrow(/does not match/);
    expect(() => validateDiscovery({ ...doc, code_challenge_methods_supported: ['plain'] }, 'https://idp.example.com')).toThrow(/PKCE/);
    const pkce = createPkcePair();
    expect(crypto.createHash('sha256').update(pkce.verifier).digest('base64url')).toBe(pkce.challenge);
    const url = new URL(buildAuthorizationUrl(validateDiscovery(doc, doc.issuer), { clientId: 'c', redirectUri: 'https://api/cb', scope: 'openid email', state: 's', nonce: 'n', codeChallenge: pkce.challenge }));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('response_type')).toBe('code');
  });
});

describe('Structured logging (Pino) with correlation and redaction', () => {
  function capture() {
    const lines: any[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(JSON.parse(chunk.toString()));
        cb();
      },
    });
    return { logger: pino(buildPinoOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' } as any), stream), lines };
  }

  it('adds requestId and tenantId from async context and redacts secret keys and patterns', async () => {
    const { logger, lines } = capture();
    runWithRequestContext({ requestId: 'req-12345678', traceId: 'a'.repeat(32) }, () =>
      TenancyContext.run({ tenantId: '11111111-1111-4111-8111-111111111111' }, () => {
        logger.info({ password: 'hunter2', headers: { authorization: 'Bearer abc.def.ghi' }, nested: { clientSecret: 'cs' } }, 'calling with Bearer eyJhbGciOi.eyJzdWIiOiIx.c2lnbmF0dXJl and erppf_live_0123456789abcdef');
      })
    );
    await new Promise((r) => setImmediate(r));
    const line = lines[0];
    expect(line.requestId).toBe('req-12345678');
    expect(line.tenantId).toBe('11111111-1111-4111-8111-111111111111');
    expect(line.service).toBe('erppreflight-api');
    expect(line.password).toBe('[REDACTED]');
    expect(line.headers.authorization).toBe('[REDACTED]');
    expect(line.nested.clientSecret).toBe('[REDACTED]');
    expect(line.msg).not.toMatch(/eyJhbGciOi|0123456789abcdef/);
  });

  it('scrubs credentials from free text', () => {
    expect(scrubSecrets('https://user:pw@host/x password=abc token: xyz whsec_abcdef123456')).toBe(
      'https://[REDACTED]@host/x password=[REDACTED] token: [REDACTED] whsec_[REDACTED]'
    );
  });
});

describe('Error reporting adapter (Sentry envelope protocol)', () => {
  let sentry: any;
  beforeAll(async () => {
    sentry = await doubles.startRecorder();
  });
  afterAll(async () => sentry.close());

  it('parses DSNs and stays disabled without SENTRY_DSN', () => {
    expect(parseSentryDsn('https://pub@o1.ingest.sentry.io/42').envelopeUrl).toBe('https://o1.ingest.sentry.io/api/42/envelope/');
    expect(createErrorReporter({} as any).enabled).toBe(false);
    expect(createErrorReporter({ SENTRY_DSN: 'not a dsn' } as any).enabled).toBe(false);
  });

  it('delivers a scrubbed event envelope with correlation tags', async () => {
    const port = new URL(sentry.url).port;
    const reporter = new SentryErrorReporter(`http://publickey@127.0.0.1:${port}/7`, { environment: 'test' });
    const err = new Error('db failed for postgres://app:SuperSecret@db/prod');
    const id = await runWithRequestContext({ requestId: 'req-abcdefgh' }, () => reporter.captureException(err, { statusCode: 500, tenantId: 't-1' }));
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    const req = sentry.state.requests.at(-1);
    expect(req.url).toBe('/api/7/envelope/');
    expect(req.headers['x-sentry-auth']).toContain('sentry_key=publickey');
    const [header, item, event] = req.body.trim().split('\n').map((l: string) => JSON.parse(l));
    expect(header.event_id).toBe(id);
    expect(item.type).toBe('event');
    expect(event.tags).toMatchObject({ requestId: 'req-abcdefgh', tenantId: 't-1', statusCode: '500' });
    expect(JSON.stringify(event)).not.toContain('SuperSecret');
  });
});

describe('Tracing & OpenAPI helpers', () => {
  it('tracing is a no-op unless an OTLP endpoint is configured', () => {
    expect(isTracingConfigured({} as any)).toBe(false);
    expect(isTracingConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318' } as any)).toBe(true);
    expect(isTracingConfigured({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://c', OTEL_SDK_DISABLED: 'true' } as any)).toBe(false);
  });

  it('publishes Zod request contracts as OpenAPI schemas', () => {
    const s = zodToOpenApi(CreateConnectorSchema);
    expect(s.type).toBe('object');
    expect(s.required).toEqual(['type', 'name']);
    expect(s.properties.type.enum).toContain('SAP_CLOUD_ALM');
    expect(s.properties.accessMode.default).toBe('READ_ONLY');
    expect(s.additionalProperties).toBe(false);
  });
});
