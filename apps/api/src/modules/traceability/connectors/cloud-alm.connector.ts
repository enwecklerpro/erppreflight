import { Injectable, Logger } from '@nestjs/common';

export interface CloudAlmConfig {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
  calmProjectId?: string;
}

export interface CloudAlmTaskPayload {
  title: string;
  description: string;
  ruleId: string;
  severity: string;
  remediation: string;
  artifactPath?: string;
  artifactSha256?: string;
  findingDeepLink: string;
}

export interface CloudAlmTaskResult {
  success: boolean;
  taskId?: string;
  deepLink?: string;
  status: 'SYNCHRONIZED' | 'CREDENTIALS_REQUIRED' | 'FAILED_AUTHENTICATION' | 'FAILED_API_ERROR';
  error?: string;
  httpStatus?: number;
}

@Injectable()
export class CloudAlmConnectorService {
  private readonly logger = new Logger(CloudAlmConnectorService.name);

  /**
   * Dispatches a preflight finding remediation task to SAP Cloud ALM REST API.
   * Authenticates via SAP BTP / IAS OAuth2 Client Credentials grant.
   */
  async createRemediationTask(
    config: CloudAlmConfig | null,
    payload: CloudAlmTaskPayload
  ): Promise<CloudAlmTaskResult> {
    if (!config?.tokenUrl || !config?.clientId || !config?.clientSecret || !config?.apiBaseUrl) {
      return {
        success: false,
        status: 'CREDENTIALS_REQUIRED',
        error: 'SAP Cloud ALM OAuth2 credentials (tokenUrl, clientId, clientSecret, apiBaseUrl) are not configured for this tenant.',
      };
    }

    try {
      // 1. Fetch OAuth2 Bearer Token
      const token = await this.fetchOAuthToken(config.tokenUrl, config.clientId, config.clientSecret);

      // 2. Map ERP Preflight finding severity to Cloud ALM Priority
      const priorityMap: Record<string, string> = {
        BLOCKER: 'VERY_HIGH',
        CRITICAL: 'HIGH',
        MAJOR: 'MEDIUM',
        MEDIUM: 'MEDIUM',
        MINOR: 'LOW',
        INFO: 'LOW',
      };
      const calmPriority = priorityMap[payload.severity.toUpperCase()] || 'MEDIUM';

      // 3. Construct SAP Cloud ALM Task JSON Body
      const calmBody = {
        title: `[ERP Preflight] ${payload.ruleId}: ${payload.title.slice(0, 100)}`,
        description: `### Clean Core Preflight Finding Remediation\n\n` +
          `**Rule ID**: \`${payload.ruleId}\`\n` +
          `**Severity**: ${payload.severity}\n\n` +
          `**Required Remediation**:\n${payload.remediation}\n\n` +
          `**Cryptographic Evidence**:\n- Artifact: \`${payload.artifactPath || 'N/A'}\`\n- SHA-256: \`${payload.artifactSha256 || 'N/A'}\`\n\n` +
          `[View Finding in ERP Preflight Inspector](${payload.findingDeepLink})`,
        type: 'DEFECT',
        priority: calmPriority,
        status: 'OPEN',
        tags: ['ERP_PREFLIGHT', 'CLEAN_CORE', payload.ruleId],
      };

      const calmProjectId = config.calmProjectId || 'DEFAULT_PROJECT';
      const taskApiUrl = `${config.apiBaseUrl.replace(/\/+$/, '')}/api/calm-projects/v1/projects/${calmProjectId}/tasks`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(taskApiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'ERPPreflight-CloudALMConnector/1.0',
        },
        body: JSON.stringify(calmBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        this.logger.error(`SAP Cloud ALM Task API error [HTTP ${res.status}]: ${errorText}`);
        return {
          success: false,
          status: 'FAILED_API_ERROR',
          httpStatus: res.status,
          error: `SAP Cloud ALM returned HTTP ${res.status}: ${errorText.slice(0, 200)}`,
        };
      }

      const responseData = (await res.json().catch(() => ({}))) as any;
      const calmTaskId = responseData.id || responseData.taskId || `CALM-${Date.now().toString().slice(-6)}`;
      const deepLink = `${config.apiBaseUrl.replace(/\/+$/, '')}/launchpad#Task-manage?sap-ui-app-id-hint=calm-tasks&/task/${calmTaskId}`;

      return {
        success: true,
        taskId: calmTaskId,
        deepLink,
        status: 'SYNCHRONIZED',
      };
    } catch (err: any) {
      this.logger.error(`SAP Cloud ALM dispatch failed: ${err.message}`);
      return {
        success: false,
        status: err.message.includes('401') || err.message.includes('token') ? 'FAILED_AUTHENTICATION' : 'FAILED_API_ERROR',
        error: err.name === 'AbortError' ? 'Connection to SAP Cloud ALM timed out after 6000ms' : err.message,
      };
    }
  }

  private async fetchOAuthToken(tokenUrl: string, clientId: string, clientSecret: string): Promise<string> {
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basicAuth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
      },
      body: 'grant_type=client_credentials',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`OAuth token request failed with HTTP ${res.status}: ${errText.slice(0, 150)}`);
    }

    const data = (await res.json()) as any;
    if (!data.access_token) {
      throw new Error('OAuth token response missing access_token field.');
    }

    return data.access_token;
  }
}
