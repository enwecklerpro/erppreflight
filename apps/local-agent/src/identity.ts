import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';

export interface AgentIdentity {
  deviceId: string;
  organizationId?: string;
  enrollmentToken?: string;
  apiKey?: string;
  registeredAt?: string;
  hostname: string;
}

export class AgentIdentityManager {
  private identityFile: string;

  constructor() {
    this.identityFile = path.join(os.homedir(), '.erppreflight', 'agent-identity.json');
  }

  async load(): Promise<AgentIdentity | null> {
    try {
      const data = await fs.readFile(this.identityFile, 'utf-8');
      return JSON.parse(data) as AgentIdentity;
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        const fallback = path.join(process.cwd(), '.agent-identity.json');
        try {
          const fallbackData = await fs.readFile(fallback, 'utf-8');
          return JSON.parse(fallbackData) as AgentIdentity;
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  async save(identity: AgentIdentity): Promise<void> {
    const dir = path.dirname(this.identityFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.identityFile, JSON.stringify(identity, null, 2), { mode: 0o600 });
  }

  async enroll(apiUrl: string, pairingToken: string): Promise<AgentIdentity> {
    const deviceId = crypto.randomUUID();
    const hostname = os.hostname();
    const fingerprint = crypto.createHash('sha256').update(`${deviceId}-${hostname}-${Date.now()}`).digest('hex');

    const res = await fetch(`${apiUrl}/agent-gate/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId,
        hostname,
        pairingToken,
        fingerprint
      })
    });

    if (!res.ok) {
      throw new Error(`Enrollment failed: HTTP ${res.status} ${res.statusText}`);
    }

    const data = await res.json() as any;
    const identity: AgentIdentity = {
      deviceId,
      organizationId: data.organizationId,
      apiKey: data.apiKey,
      registeredAt: new Date().toISOString(),
      hostname
    };

    await this.save(identity);
    return identity;
  }
}
