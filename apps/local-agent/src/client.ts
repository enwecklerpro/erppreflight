export interface AgentClientConfig {
  apiUrl: string;
  apiKey?: string;
  authToken?: string;
  tenantId?: string;
  timeoutMs?: number;
}

export class ErpPreflightClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;

  constructor(config: AgentClientConfig) {
    this.baseUrl = config.apiUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs || 15000;
    this.headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    if (config.apiKey) {
      this.headers['X-Api-Key'] = config.apiKey;
    } else if (config.authToken) {
      this.headers['Authorization'] = `Bearer ${config.authToken}`;
    }

    if (config.tenantId) {
      this.headers['X-Tenant-Id'] = config.tenantId;
    }
  }

  async ping(): Promise<{ healthy: boolean; status: number; message: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/health/liveness`, {
        method: 'GET',
        headers: this.headers,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return {
        healthy: res.ok,
        status: res.status,
        message: res.ok ? 'OK' : `HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        healthy: false,
        status: 0,
        message: err.message || 'Connection refused',
      };
    }
  }

  async triggerAnalysis(params: {
    projectId: string;
    engineTypes: string[];
    targetRelease?: string;
    artifactType?: string;
    rawContent?: string;
  }): Promise<{ analysisId: string; status: string }> {
    const res = await fetch(`${this.baseUrl}/analyses/trigger`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        projectId: params.projectId,
        engineTypes: params.engineTypes,
        targetRelease: params.targetRelease || 'S4H_2023',
        artifactType: params.artifactType || 'XML',
        rawContent: params.rawContent,
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Analysis trigger failed [HTTP ${res.status}]: ${errText}`);
    }

    return await res.json();
  }

  async getAnalysis(analysisId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/analyses/${analysisId}`, {
      method: 'GET',
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch analysis ${analysisId} [HTTP ${res.status}]`);
    }

    return await res.json();
  }
}
