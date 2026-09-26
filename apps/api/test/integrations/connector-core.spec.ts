import { describe, it, expect } from 'vitest';
import * as crypto from 'node:crypto';
import { CredentialCipher, deriveVaultKey } from '../../src/modules/connectors/credential-vault';
import { afterFailure, afterSuccess, beforeCall, CircuitSnapshot } from '../../src/modules/connectors/circuit-breaker';
import {
  TokenBucketLimiter,
  computeBackoffMs,
  createConnectorHttp,
  describeConnectorError,
  ConnectorHttpError,
  ConnectorRateLimitedError,
} from '../../src/modules/connectors/connector-http';
import {
  CONNECTOR_DEFINITIONS,
  CONNECTOR_TYPES,
  describeConnectorType,
  getConnectorDefinition,
} from '../../src/modules/connectors/connector-registry';
import { parseSafeXml, UnsafeXmlError } from '../../src/modules/connectors/safe-xml';
import {
  canonicalJson,
  deviceRequestSigningString,
  ed25519FromSeed,
  signEnvelope,
  verifyEd25519,
} from '../../src/modules/connectors/agent-signing';
import { hubSignature, retryDelayMs, timestampedSignature, verifyTimestampedSignature } from '../../src/modules/webhooks/webhook-signing';
import { UnsafeOutboundUrlError } from '../../src/common/security/outbound-request';

const ORG_A = '11111111-1111-4111-8111-111111111111';
const ORG_B = '22222222-2222-4222-8222-222222222222';

describe('Credential vault (AES-256-GCM, key ids, tenant binding)', () => {
  const master = crypto.randomBytes(32).toString('hex');

  it('round-trips and never contains the plaintext', () => {
    const c = new CredentialCipher(master);
    const { ciphertext, keyId } = c.encrypt(ORG_A, 'connector-credentials', '{"apiToken":"s3cr3t-value"}');
    expect(ciphertext.startsWith(`v1.${keyId}.`)).toBe(true);
    expect(ciphertext).not.toContain('s3cr3t');
    expect(c.decrypt(ORG_A, 'connector-credentials', ciphertext)).toBe('{"apiToken":"s3cr3t-value"}');
  });

  it('refuses a ciphertext copied into another tenant or purpose', () => {
    const c = new CredentialCipher(master);
    const { ciphertext } = c.encrypt(ORG_A, 'connector-credentials', 'x');
    expect(() => c.decrypt(ORG_B, 'connector-credentials', ciphertext)).toThrow(/authentication/);
    expect(() => c.decrypt(ORG_A, 'sso-client-secret', ciphertext)).toThrow(/authentication/);
  });

  it('detects tampering', () => {
    const c = new CredentialCipher(master);
    const parts = c.encrypt(ORG_A, 'p', 'hello').ciphertext.split('.');
    parts[4] = Buffer.from('tampered').toString('base64url');
    expect(() => c.decrypt(ORG_A, 'p', parts.join('.'))).toThrow();
  });

  it('supports key rotation through MASTER_ENCRYPTION_KEY_PREVIOUS', () => {
    const oldKey = crypto.randomBytes(32).toString('hex');
    const old = new CredentialCipher(oldKey);
    const ct = old.encrypt(ORG_A, 'p', 'legacy').ciphertext;
    const rotated = new CredentialCipher(master, [oldKey]);
    expect(rotated.decrypt(ORG_A, 'p', ct)).toBe('legacy');
    expect(rotated.needsRotation(ct)).toBe(true);
    expect(rotated.needsRotation(rotated.encrypt(ORG_A, 'p', 'x').ciphertext)).toBe(false);
    expect(() => new CredentialCipher(master).decrypt(ORG_A, 'p', ct)).toThrow(/unknown key id/);
  });

  it('derives purpose-separated keys (not the raw master key)', () => {
    const k = deriveVaultKey(master);
    expect(k.key.equals(Buffer.from(master, 'hex'))).toBe(false);
    expect(k.id).toHaveLength(16);
  });
});

describe('Circuit breaker', () => {
  const settings = { failureThreshold: 3, cooldownMs: 1000 };
  const closed: CircuitSnapshot = { circuitState: 'CLOSED', consecutiveFailures: 0, circuitOpenedAt: null };

  it('opens after the threshold, refuses calls during cooldown, allows one trial afterwards', () => {
    const t0 = new Date('2026-01-01T00:00:00Z');
    let s = afterFailure(closed, settings, t0, false);
    s = afterFailure(s, settings, t0, false);
    expect(s.circuitState).toBe('CLOSED');
    s = afterFailure(s, settings, t0, false);
    expect(s.circuitState).toBe('OPEN');
    const during = beforeCall(s, settings, new Date(t0.getTime() + 500));
    expect(during.allowed).toBe(false);
    const after = beforeCall(s, settings, new Date(t0.getTime() + 1500));
    expect(after).toEqual({ allowed: true, state: 'HALF_OPEN' });
    // failed trial re-opens immediately
    expect(afterFailure({ ...s, circuitState: 'HALF_OPEN' }, settings, t0, true).circuitState).toBe('OPEN');
    expect(afterSuccess()).toEqual(closed);
  });
});

describe('Connector HTTP: rate limiting, retries, error hygiene', () => {
  it('token bucket refills over time', () => {
    let now = 0;
    const l = new TokenBucketLimiter(2, 1, () => now);
    expect(l.take('a').allowed).toBe(true);
    expect(l.take('a').allowed).toBe(true);
    const denied = l.take('a');
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(1000);
    now = 1000;
    expect(l.take('a').allowed).toBe(true);
  });

  it('backoff honours Retry-After and is capped', () => {
    expect(computeBackoffMs(1, '2')).toBe(2000);
    expect(computeBackoffMs(1, '999')).toBe(5000);
    expect(computeBackoffMs(3, null, () => 0)).toBe(1000);
  });

  it('retries idempotent GETs on 503 and gives up with a ConnectorHttpError', async () => {
    let calls = 0;
    const http = createConnectorHttp('k', {
      limiter: new TokenBucketLimiter(100, 100),
      sleepImpl: async () => undefined,
      fetchImpl: (async () => {
        calls++;
        const body = Buffer.from('busy');
        return { status: 503, statusText: 'x', headers: {}, body, text: () => 'busy', json: () => ({}) };
      }) as any,
    });
    await expect(http.request({ url: 'https://x.example.com' })).rejects.toBeInstanceOf(ConnectorHttpError);
    expect(calls).toBe(3);
  });

  it('never retries non-idempotent POSTs', async () => {
    let calls = 0;
    const http = createConnectorHttp('k2', {
      limiter: new TokenBucketLimiter(100, 100),
      sleepImpl: async () => undefined,
      fetchImpl: (async () => {
        calls++;
        return { status: 502, statusText: 'x', headers: {}, body: Buffer.alloc(0), text: () => '', json: () => ({}) };
      }) as any,
    });
    await expect(http.request({ method: 'POST', url: 'https://x.example.com', body: '{}' })).rejects.toBeInstanceOf(ConnectorHttpError);
    expect(calls).toBe(1);
  });

  it('refuses calls when the per-connector bucket is empty', async () => {
    const http = createConnectorHttp('k3', { limiter: new TokenBucketLimiter(1, 0.001), fetchImpl: (async () => ({ status: 200, headers: {}, body: Buffer.alloc(0), text: () => '', json: () => ({}) })) as any });
    await http.request({ url: 'https://x.example.com' });
    await expect(http.request({ url: 'https://x.example.com' })).rejects.toBeInstanceOf(ConnectorRateLimitedError);
  });

  it('maps errors to short, secret-free messages', () => {
    expect(describeConnectorError(new ConnectorHttpError('x', 401, '', false)).message).toMatch(/authentication failed/);
    expect(describeConnectorError(new UnsafeOutboundUrlError('10.0.0.1 private')).message).toMatch(/SSRF/);
    expect(describeConnectorError(new UnsafeOutboundUrlError('10.0.0.1 private')).message).not.toContain('10.0.0.1');
  });
});

describe('Connector registry (typed config, least privilege, write action registry)', () => {
  it('declares every connector type with schemas and scopes', () => {
    for (const t of CONNECTOR_TYPES) {
      const d = getConnectorDefinition(t)!;
      expect(d.configSchema).toBeDefined();
      expect(d.credentialsSchema).toBeDefined();
      expect(d.canRead.length).toBeGreaterThan(0);
      expect(d.cannotAccess.length).toBeGreaterThan(0);
    }
  });

  it('only work item connectors register write actions, all requiring explicit confirmation', () => {
    for (const d of Object.values(CONNECTOR_DEFINITIONS)) {
      if (!d.workItems) expect(d.writeActions).toHaveLength(0);
      for (const w of d.writeActions) expect(w.approvalPolicy).toBe('EXPLICIT_USER_CONFIRMATION');
    }
  });

  it('validates configs strictly (unknown keys, bad URLs, Jira keys)', () => {
    const jira = CONNECTOR_DEFINITIONS.JIRA.configSchema;
    expect(jira.safeParse({ baseUrl: 'https://acme.atlassian.net', projectKey: 'SAPS4' }).success).toBe(true);
    expect(jira.safeParse({ baseUrl: 'https://acme.atlassian.net', projectKey: 'lower' }).success).toBe(false);
    expect(jira.safeParse({ baseUrl: 'ftp://x', projectKey: 'ABC' }).success).toBe(false);
    expect(jira.safeParse({ baseUrl: 'https://a.b', projectKey: 'ABC', extra: 1 }).success).toBe(false);
    const snowCreds = CONNECTOR_DEFINITIONS.SERVICENOW.credentialsSchema;
    expect(snowCreds.safeParse({ username: 'u' }).success).toBe(false);
    expect(snowCreds.safeParse({ oauthToken: 't' }).success).toBe(true);
  });

  it('describes form fields without exposing Zod internals', () => {
    const d = describeConnectorType(CONNECTOR_DEFINITIONS.AZURE_DEVOPS);
    const org = d.configFields.find((f: any) => f.name === 'organization');
    expect(org).toMatchObject({ required: true, kind: 'string' });
    expect(d.configFields.find((f: any) => f.name === 'baseUrl')).toMatchObject({ required: false, defaultValue: 'https://dev.azure.com' });
    expect(d.credentialFields.map((f: any) => f.name)).toEqual(['personalAccessToken']);
  });
});

describe('Defused XML parser', () => {
  it('parses namespaces, attributes, entities and CDATA', () => {
    const root = parseSafeXml('<a:root xmlns:a="u" v="1&amp;2"><b>t&lt;x&gt;</b><![CDATA[<raw>]]></a:root>');
    expect(root.local).toBe('root');
    expect(root.attrs.v).toBe('1&2');
    expect(root.children[0].text).toBe('t<x>');
    expect(root.text).toBe('<raw>');
  });

  it('rejects DOCTYPE, undeclared entities, deep nesting and oversize input', () => {
    expect(() => parseSafeXml('<!DOCTYPE r [<!ENTITY a "aaaa">]><r>&a;</r>')).toThrow(UnsafeXmlError);
    expect(() => parseSafeXml('<r>&foo;</r>')).toThrow(UnsafeXmlError);
    expect(() => parseSafeXml('<a>'.repeat(100) + '</a>'.repeat(100), { maxDepth: 64 })).toThrow(/deep/);
    expect(() => parseSafeXml('<r/>', { maxBytes: 2 })).toThrow(/exceeds/);
    expect(() => parseSafeXml('<a><b></a>')).toThrow(/Mismatched/);
  });
});

describe('Agent signing (Ed25519)', () => {
  it('signs canonical envelopes that verify with the published key and fail when altered', () => {
    const pair = ed25519FromSeed(crypto.randomBytes(32));
    const s = signEnvelope(pair, { b: 2, a: { z: 1, y: [3, 2] }, jobId: 'j' });
    expect(s.envelope).toBe('{"a":{"y":[3,2],"z":1},"b":2,"jobId":"j"}');
    expect(verifyEd25519(pair.publicKeyPem, s.envelope, s.signature)).toBe(true);
    expect(verifyEd25519(pair.publicKeyPem, s.envelope.replace('"b":2', '"b":3'), s.signature)).toBe(false);
    expect(canonicalJson({ x: undefined, y: 1 })).toBe('{"y":1}');
  });

  it('device request signatures bind method, path, time and body', () => {
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const str = deviceRequestSigningString('POST', '/api/v1/agent-api/heartbeat', '2026-01-01T00:00:00Z', '{"a":1}');
    const sig = crypto.sign(null, Buffer.from(str), privateKey).toString('base64');
    expect(verifyEd25519(pem, str, sig)).toBe(true);
    expect(verifyEd25519(pem, deviceRequestSigningString('POST', '/api/v1/agent-api/heartbeat', '2026-01-01T00:00:00Z', '{"a":2}'), sig)).toBe(false);
  });
});

describe('Webhook signing', () => {
  it('produces GitHub-compatible and timestamped signatures that the reference verifier accepts', () => {
    const body = '{"event":"analysis.completed"}';
    expect(hubSignature('whsec_x', body)).toBe(`sha256=${crypto.createHmac('sha256', 'whsec_x').update(body).digest('hex')}`);
    const now = 1_800_000_000;
    const header = timestampedSignature('whsec_x', body, now);
    expect(verifyTimestampedSignature('whsec_x', body, header, now + 10)).toBe(true);
    expect(verifyTimestampedSignature('whsec_x', body, header, now + 3600)).toBe(false); // replay window
    expect(verifyTimestampedSignature('whsec_y', body, header, now)).toBe(false);
  });

  it('retries with increasing delays', () => {
    expect([1, 2, 3, 4, 5, 9].map(retryDelayMs)).toEqual([30_000, 120_000, 600_000, 1_800_000, 7_200_000, 7_200_000]);
  });
});
