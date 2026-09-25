import { Injectable, Logger } from '@nestjs/common';

export interface JiraConfig {
  host: string;
  email: string;
  apiToken: string;
  projectKey: string;
  issueType?: string;
}

export interface JiraTaskPayload {
  title: string;
  description: string;
  ruleId: string;
  severity: string;
  remediation: string;
  artifactPath?: string;
  artifactSha256?: string;
  findingDeepLink: string;
}

export interface JiraTaskResult {
  success: boolean;
  taskId?: string;
  deepLink?: string;
  status: 'SYNCHRONIZED' | 'CREDENTIALS_REQUIRED' | 'FAILED_AUTHENTICATION' | 'FAILED_API_ERROR';
  error?: string;
  httpStatus?: number;
}

@Injectable()
export class JiraConnectorService {
  private readonly logger = new Logger(JiraConnectorService.name);

  /**
   * Creates a remediation issue in Atlassian Jira REST API v3.
   */
  async createIssue(config: JiraConfig | null, payload: JiraTaskPayload): Promise<JiraTaskResult> {
    if (!config?.host || !config?.email || !config?.apiToken || !config?.projectKey) {
      return {
        success: false,
        status: 'CREDENTIALS_REQUIRED',
        error: 'Jira API credentials (host, email, apiToken, projectKey) are not configured for this tenant.',
      };
    }

    try {
      const basicAuth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
      const host = config.host.replace(/\/+$/, '');
      const url = `${host}/rest/api/3/issue`;

      const priorityMap: Record<string, string> = {
        BLOCKER: 'Highest',
        CRITICAL: 'High',
        MAJOR: 'Medium',
        MEDIUM: 'Medium',
        MINOR: 'Low',
        INFO: 'Lowest',
      };
      const jiraPriority = priorityMap[payload.severity.toUpperCase()] || 'Medium';

      // Atlassian Document Format (ADF) description body
      const issueBody = {
        fields: {
          project: { key: config.projectKey },
          summary: `[ERP Preflight] ${payload.ruleId}: ${payload.title.slice(0, 100)}`,
          issuetype: { name: config.issueType || 'Bug' },
          priority: { name: jiraPriority },
          labels: ['erppreflight', 'clean-core', payload.ruleId.toLowerCase().replace(/_/g, '-')],
          description: {
            version: 1,
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: `Clean Core Audit Finding Remediation for ${payload.ruleId}`,
                    marks: [{ type: 'strong' }],
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: `Remediation Guidance: ${payload.remediation}`,
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: `Evidence Artifact: ${payload.artifactPath || 'N/A'} (SHA-256: ${payload.artifactSha256 || 'none'})`,
                  },
                ],
              },
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'Open finding in ERP Preflight: ',
                  },
                  {
                    type: 'text',
                    text: payload.findingDeepLink,
                    marks: [
                      {
                        type: 'link',
                        attrs: { href: payload.findingDeepLink },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
      };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 6000);

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'User-Agent': 'ERPPreflight-JiraConnector/1.0',
        },
        body: JSON.stringify(issueBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        this.logger.error(`Jira API returned HTTP ${res.status}: ${errText}`);
        return {
          success: false,
          status: res.status === 401 ? 'FAILED_AUTHENTICATION' : 'FAILED_API_ERROR',
          httpStatus: res.status,
          error: `Jira returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
        };
      }

      const resData = (await res.json()) as any;
      const issueKey = resData.key || `${config.projectKey}-TASK`;
      const deepLink = `${host}/browse/${issueKey}`;

      return {
        success: true,
        taskId: issueKey,
        deepLink,
        status: 'SYNCHRONIZED',
      };
    } catch (err: any) {
      this.logger.error(`Jira issue creation failed: ${err.message}`);
      return {
        success: false,
        status: 'FAILED_API_ERROR',
        error: err.name === 'AbortError' ? 'Connection to Jira API timed out after 6000ms' : err.message,
      };
    }
  }
}
