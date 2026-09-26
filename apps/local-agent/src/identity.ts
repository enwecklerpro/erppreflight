import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Device identity (Part 18.7, C §36).
 *
 * On enrollment the agent generates an Ed25519 key pair locally; only the public
 * key leaves the machine. The identity file (mode 0600, directory 0700) holds the
 * device private key, the device credential issued by the API and the pinned
 * API job-signing public key used to verify every job instruction.
 */
export interface AgentIdentity {
  version: 2;
  deviceId: string;
  organizationId: string;
  connectorId?: string;
  apiUrl: string;
  deviceCredential: string;
  privateKeyPem: string;
  publicKeyPem: string;
  publicKeyFingerprint: string;
  jobSigningPublicKey: string;
  jobSigningKeyId?: string;
  heartbeatIntervalSec: number;
  registeredAt: string;
  hostname: string;
  name: string;
}

export const AGENT_VERSION = '0.2.0';

export function agentHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.ERP_PREFLIGHT_AGENT_HOME || path.join(os.homedir(), '.erppreflight');
}

/** Accepts `https://api.example.com` or `https://api.example.com/api/v1`. */
export function normalizeApiBase(apiUrl: string): string {
  const u = new URL(apiUrl);
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('API URL must be http(s)');
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  return base.endsWith('/api/v1') ? base : `${base}/api/v1`;
}

export class AgentIdentityManager {
  readonly identityFile: string;

  constructor(home: string = agentHome()) {
    this.identityFile = path.join(home, 'agent-identity.json');
  }

  async load(): Promise<AgentIdentity | null> {
    try {
      const data = JSON.parse(await fs.readFile(this.identityFile, 'utf-8'));
      if (data?.version !== 2 || !data.deviceCredential || !data.privateKeyPem) return null;
      return data as AgentIdentity;
    } catch (e: any) {
      if (e.code === 'ENOENT') return null;
      throw new Error(`Identity file ${this.identityFile} is unreadable: ${e.message}`);
    }
  }

  async save(identity: AgentIdentity): Promise<void> {
    const dir = path.dirname(this.identityFile);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${this.identityFile}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(identity, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.identityFile);
    await fs.chmod(this.identityFile, 0o600);
  }

  async enroll(apiUrl: string, enrollmentToken: string, name?: string): Promise<AgentIdentity> {
    const base = normalizeApiBase(apiUrl);
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const hostname = os.hostname();

    const res = await fetch(`${base}/agent-api/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        enrollmentToken,
        name: name || hostname,
        hostname,
        publicKeyPem,
        agentVersion: AGENT_VERSION,
        platform: `${process.platform}-${process.arch} node${process.versions.node}`,
        capabilities: ['SCAN_DIRECTORY', 'PROBE_URL', 'LOCAL_REDACTION'],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text);
        msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || text;
      } catch {
        /* plain text */
      }
      throw new Error(`Enrollment failed: HTTP ${res.status} ${msg}`.slice(0, 300));
    }
    const data = JSON.parse(text);
    const fingerprint = crypto.createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex');
    if (data.publicKeyFingerprint && data.publicKeyFingerprint !== fingerprint) {
      throw new Error('Enrollment response does not match the generated device key');
    }
    const identity: AgentIdentity = {
      version: 2,
      deviceId: data.deviceId,
      organizationId: data.organizationId,
      connectorId: data.connectorId,
      apiUrl: base,
      deviceCredential: data.deviceCredential,
      privateKeyPem,
      publicKeyPem,
      publicKeyFingerprint: fingerprint,
      jobSigningPublicKey: data.jobSigningPublicKey,
      jobSigningKeyId: data.jobSigningKeyId,
      heartbeatIntervalSec: Number(data.heartbeatIntervalSec) || 30,
      registeredAt: new Date().toISOString(),
      hostname,
      name: name || hostname,
    };
    await this.save(identity);
    return identity;
  }
}
