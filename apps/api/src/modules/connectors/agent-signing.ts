import * as crypto from 'node:crypto';

/**
 * Ed25519 signing for local agent job instructions and update manifests
 * (Part 03 §3.12 "signed job instructions", Part 18.8 "signed updates").
 *
 * The private key is derived deterministically from AGENT_JOB_SIGNING_KEY
 * (64 hex chars = raw 32-byte Ed25519 seed) or, if unset, via HKDF from
 * MASTER_ENCRYPTION_KEY, so every API replica signs with the same key and the
 * public key agents pin at enrollment stays stable across restarts.
 */

const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export interface SigningKeyPair {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  publicKeyPem: string;
  keyId: string;
}

let cached: { source: string; pair: SigningKeyPair } | null = null;

export function ed25519FromSeed(seed: Buffer): SigningKeyPair {
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = crypto.createPublicKey(privateKey);
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const keyId = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex').slice(0, 16);
  return { privateKey, publicKey, publicKeyPem, keyId };
}

export function getAgentSigningKey(env: NodeJS.ProcessEnv = process.env, masterKey?: string): SigningKeyPair {
  const explicit = env.AGENT_JOB_SIGNING_KEY?.trim();
  const master = masterKey || env.MASTER_ENCRYPTION_KEY || '';
  const source = explicit ? `explicit:${explicit}` : `master:${master}`;
  if (cached && cached.source === source) return cached.pair;
  let seed: Buffer;
  if (explicit) {
    if (!/^[0-9a-fA-F]{64}$/.test(explicit)) throw new Error('AGENT_JOB_SIGNING_KEY must be 64 hex characters (32-byte Ed25519 seed)');
    seed = Buffer.from(explicit, 'hex');
  } else {
    if (!master) throw new Error('MASTER_ENCRYPTION_KEY (or AGENT_JOB_SIGNING_KEY) is required to sign agent jobs');
    seed = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(master, 'utf8'), Buffer.alloc(0), 'erppreflight/agent-job-signing/v1', 32));
  }
  const pair = ed25519FromSeed(seed);
  cached = { source, pair };
  return pair;
}

/** Deterministic JSON (sorted keys) so signer and verifier hash identical bytes. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(',')}}`;
}

export function signEnvelope(pair: SigningKeyPair, envelope: Record<string, unknown>): { envelope: string; signature: string; keyId: string } {
  const text = canonicalJson(envelope);
  const signature = crypto.sign(null, Buffer.from(text, 'utf8'), pair.privateKey).toString('base64');
  return { envelope: text, signature, keyId: pair.keyId };
}

export function verifyEd25519(publicKeyPem: string, message: string | Buffer, signatureB64: string): boolean {
  try {
    const key = crypto.createPublicKey(publicKeyPem);
    if (key.asymmetricKeyType !== 'ed25519') return false;
    return crypto.verify(null, typeof message === 'string' ? Buffer.from(message, 'utf8') : message, key, Buffer.from(signatureB64, 'base64'));
  } catch {
    return false;
  }
}

/** String a device signs for every request (method, path, timestamp, body hash). */
export function deviceRequestSigningString(method: string, path: string, timestamp: string, body: string): string {
  const bodyHash = crypto.createHash('sha256').update(body || '').digest('hex');
  return `${method.toUpperCase()}\n${path}\n${timestamp}\n${bodyHash}`;
}
