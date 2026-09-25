import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloudAlmConnectorService } from '../src/modules/traceability/connectors/cloud-alm.connector';
import { JiraConnectorService } from '../src/modules/traceability/connectors/jira.connector';

describe('SAP Cloud ALM & Jira Live Connectors Suite (Part 15.2)', () => {
  let cloudAlm: CloudAlmConnectorService;
  let jira: JiraConnectorService;

  beforeEach(() => {
    cloudAlm = new CloudAlmConnectorService();
    jira = new JiraConnectorService();
    vi.restoreAllMocks();
  });

  describe('CloudAlmConnectorService', () => {
    it('returns CREDENTIALS_REQUIRED when configuration is missing', async () => {
      const res = await cloudAlm.createRemediationTask(null, {
        title: 'Fix direct DB update in Z_SALES',
        description: 'VBAK updated directly',
        ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
        severity: 'BLOCKER',
        remediation: 'Use released RAP business object',
        findingDeepLink: 'https://erppreflight.com/findings/123',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('CREDENTIALS_REQUIRED');
      expect(res.error).toContain('OAuth2 credentials');
    });

    it('successfully exchanges OAuth token and posts defect task to SAP Cloud ALM', async () => {
      const mockFetch = vi.fn();
      global.fetch = mockFetch;

      // 1. Mock OAuth Token Response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock-btp-bearer-token-12345',
          expires_in: 3600,
        }),
      });

      // 2. Mock Cloud ALM Create Task Response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          id: 'CALM-TASK-78901',
          type: 'DEFECT',
          status: 'OPEN',
        }),
      });

      const res = await cloudAlm.createRemediationTask(
        {
          tokenUrl: 'https://auth.cloud.sap/oauth/token',
          clientId: 'client-id-xyz',
          clientSecret: 'client-secret-abc',
          apiBaseUrl: 'https://tenant.alm.cloud.sap',
          calmProjectId: 'PROJ-CORE-ERP',
        },
        {
          title: 'Direct DB access to VBAK',
          description: 'Custom program bypasses RAP BO',
          ruleId: 'CLEAN_CORE_TIER3_DIRECT_DB_MUTATION',
          severity: 'BLOCKER',
          remediation: 'Refactor using I_SalesOrderTP',
          artifactPath: 'src/z_sales.prog.abap',
          artifactSha256: 'a'.repeat(64),
          findingDeepLink: 'https://erppreflight.com/findings/f-1',
        }
      );

      expect(res.success).toBe(true);
      expect(res.status).toBe('SYNCHRONIZED');
      expect(res.taskId).toBe('CALM-TASK-78901');
      expect(res.deepLink).toContain('CALM-TASK-78901');

      // Assert OAuth call
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        'https://auth.cloud.sap/oauth/token',
        expect.objectContaining({
          method: 'POST',
          body: 'grant_type=client_credentials',
        })
      );

      // Assert Cloud ALM Task call
      const taskCall = mockFetch.mock.calls[1];
      expect(taskCall[0]).toContain('/api/calm-projects/v1/projects/PROJ-CORE-ERP/tasks');
      const body = JSON.parse(taskCall[1].body);
      expect(body.priority).toBe('VERY_HIGH'); // BLOCKER maps to VERY_HIGH
      expect(body.tags).toContain('CLEAN_CORE');
      expect(body.tags).toContain('CLEAN_CORE_TIER3_DIRECT_DB_MUTATION');
    });

    it('handles authentication failure from SAP BTP IAS', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Invalid client credentials',
      });

      const res = await cloudAlm.createRemediationTask(
        {
          tokenUrl: 'https://auth.cloud.sap/oauth/token',
          clientId: 'bad-client',
          clientSecret: 'bad-secret',
          apiBaseUrl: 'https://tenant.alm.cloud.sap',
        },
        {
          title: 'Test finding',
          description: 'Desc',
          ruleId: 'OPD_RULE_MISSING',
          severity: 'CRITICAL',
          remediation: 'Fix it',
          findingDeepLink: 'https://erppreflight.com',
        }
      );

      expect(res.success).toBe(false);
      expect(res.status).toBe('FAILED_AUTHENTICATION');
      expect(res.error).toContain('HTTP 401');
    });
  });

  describe('JiraConnectorService', () => {
    it('returns CREDENTIALS_REQUIRED when Jira host or credentials missing', async () => {
      const res = await jira.createIssue(null, {
        title: 'Broken Adobe Form layout',
        description: 'Binding error',
        ruleId: 'FORM_DOCTOR_PDF_RENDER_FAIL',
        severity: 'CRITICAL',
        remediation: 'Update binding',
        findingDeepLink: 'https://erppreflight.com/findings/f-2',
      });

      expect(res.success).toBe(false);
      expect(res.status).toBe('CREDENTIALS_REQUIRED');
    });

    it('successfully posts Atlassian ADF issue payload and returns issue key', async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          key: 'ERP-555',
          id: '10055',
        }),
      });

      const res = await jira.createIssue(
        {
          host: 'https://acme.atlassian.net',
          email: 'architect@acme.com',
          apiToken: 'jira-api-token-secret',
          projectKey: 'ERP',
        },
        {
          title: 'Missing OPD Determination Step',
          description: 'Billing document output routing missing channel PRINT',
          ruleId: 'OPD_DETERMINATION_STEP_MISSING',
          severity: 'MAJOR',
          remediation: 'Maintain decision table in BRFplus',
          findingDeepLink: 'https://erppreflight.com/findings/f-3',
        }
      );

      expect(res.success).toBe(true);
      expect(res.status).toBe('SYNCHRONIZED');
      expect(res.taskId).toBe('ERP-555');
      expect(res.deepLink).toBe('https://acme.atlassian.net/browse/ERP-555');
    });
  });
});
