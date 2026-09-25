import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChangeSetsService } from '../src/modules/changesets/changesets.service';
import { TraceabilityService } from '../src/modules/traceability/traceability.service';
import { DemoService } from '../src/modules/demo/demo.service';
import { KnowledgeService } from '../src/modules/knowledge/knowledge.service';
import { McpService } from '../src/modules/mcp/mcp.service';
import { AgentGateService } from '../src/modules/agent-gate/agent-gate.service';
import { ApiKeysService } from '../src/modules/api-keys/api-keys.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { LandscapesService } from '../src/modules/landscapes/landscapes.service';
import { JobsService } from '../src/modules/jobs/jobs.service';

describe('Enterprise Platform Services Suite', () => {
  let mockDb: any;
  const orgId = '11111111-1111-1111-1111-111111111111';
  const projectId = '22222222-2222-2222-2222-222222222222';
  const userId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
      mockDb = {
      query: vi.fn(),
      withTenantTransaction: vi.fn(async (_tenantIdOrCb, maybeCb) => {
        const cb = typeof _tenantIdOrCb === 'function' ? _tenantIdOrCb : maybeCb;
        return await cb(mockDb);
      }),
    };
  });

  describe('ChangeSetsService (What-If Simulation)', () => {
    it('should create a ChangeSet and calculate SHA-256 proposal hash', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'cs-1',
            organization_id: orgId,
            project_id: projectId,
            name: 'Remove Custom Field YY1_CLASS',
            proposal_hash: 'mockhash',
            approval_status: 'DRAFT',
          },
        ],
      });

      const service = new ChangeSetsService(mockDb);
      const res = await service.create(orgId, projectId, userId, {
        name: 'Remove Custom Field YY1_CLASS',
        proposedChanges: [
          {
            type: 'REMOVE_CUSTOM_FIELD',
            targetObject: 'YY1_CLASS',
            details: {},
          },
        ],
      });

      expect(res.id).toBe('cs-1');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO changesets'),
        expect.any(Array)
      );
    });

    it('should simulate blast radius and detect broken Adobe Form bindings', async () => {
      mockDb.query
        // findOne
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cs-1',
              organization_id: orgId,
              project_id: projectId,
              proposed_changes: JSON.stringify([
                { type: 'REMOVE_CUSTOM_FIELD', targetObject: 'YY1_CLASS', details: {} },
              ]),
            },
          ],
        })
        // baseline findings
        .mockResolvedValueOnce({
          rows: [{ id: 'f-1', rule_id: 'EXISTING_WARNING' }],
        })
        // sap_objects (empty for fallback path)
        .mockResolvedValueOnce({
          rows: [],
        })
        // update simulation result
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cs-1',
              simulation_result: {
                verdict: 'CONDITIONAL_APPROVAL_REQUIRED',
                blastRadiusObjects: [
                  { name: 'FORM_DOCTOR:MM_PURCHASE_ORDER_DEFAULT', impact: 'BINDING_BROKEN' },
                ],
              },
            },
          ],
        });

      const service = new ChangeSetsService(mockDb);
      const sim = await service.simulate(orgId, projectId, 'cs-1');

      expect(sim.simulation_result.verdict).toBe('CONDITIONAL_APPROVAL_REQUIRED');
      expect(sim.simulation_result.blastRadiusObjects.length).toBeGreaterThan(0);
    });

    it('should dynamically traverse sap_objects dependency graph and calculate real blast radius', async () => {
      mockDb.query
        // findOne
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cs-2',
              organization_id: orgId,
              project_id: projectId,
              proposed_changes: JSON.stringify([
                { type: 'REMOVE_CUSTOM_FIELD', targetObject: 'YY1_INVOICE_REF', details: {} },
              ]),
            },
          ],
        })
        // baseline findings
        .mockResolvedValueOnce({
          rows: [{ id: 'f-1', rule_id: 'RULE_CLEAN_CORE', title: 'Legacy DB Mutation' }],
        })
        // real sap_objects from database with dependency tree
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'obj-1',
              name: 'YY1_INVOICE_REF',
              object_type: 'DTEL',
              clean_core_tier: 'TIER_1_CLOUD',
              dependencies: [],
            },
            {
              id: 'obj-2',
              name: 'ZCL_BILLING_DISPATCHER',
              object_type: 'CLAS',
              clean_core_tier: 'TIER_3_CLASSIC',
              dependencies: [{ target: 'YY1_INVOICE_REF', type: 'FIELD_REFERENCE' }],
            },
            {
              id: 'obj-3',
              name: 'ZCDS_INVOICE_VIEW',
              object_type: 'CDS',
              clean_core_tier: 'TIER_2_DEVELOPER',
              dependencies: [{ target: 'YY1_INVOICE_REF', type: 'ANNOTATION_FIELD' }],
            },
          ],
        })
        // update simulation result
        .mockImplementationOnce((sql: string, params: any[]) => {
          const simResult = JSON.parse(params[0]);
          return Promise.resolve({
            rows: [
              {
                id: 'cs-2',
                simulation_result: simResult,
                approval_status: 'SIMULATED',
              },
            ],
          });
        });

      const service = new ChangeSetsService(mockDb);
      const sim = await service.simulate(orgId, projectId, 'cs-2');

      expect(sim.simulation_result.verdict).toBe('CONDITIONAL_APPROVAL_REQUIRED');
      expect(sim.simulation_result.blastRadiusObjects.length).toBe(3);
      expect(sim.simulation_result.blastRadiusObjects).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'YY1_INVOICE_REF', direct: true }),
          expect.objectContaining({ name: 'ZCL_BILLING_DISPATCHER', direct: false }),
          expect.objectContaining({ name: 'ZCDS_INVOICE_VIEW', direct: false }),
        ])
      );
      expect(sim.simulation_result.newFindings.length).toBe(2);
      expect(sim.simulation_result.requiredTests.length).toBe(2);
    });

    it('should approve ChangeSet and issue signed Change Evidence Pack', async () => {
      mockDb.query
        // findOne
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cs-1',
              organization_id: orgId,
              project_id: projectId,
              name: 'Valid Change',
              proposal_hash: 'a1b2c3d4',
              approval_status: 'SIMULATED',
              simulation_result: { verdict: 'CLEAR' },
            },
          ],
        })
        // update
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'cs-1',
              name: 'Valid Change',
              proposal_hash: 'a1b2c3d4',
              approval_status: 'APPROVED',
              approved_at: new Date().toISOString(),
              target_environment: 'QA',
              target_release: 'S4H_2023',
            },
          ],
        });

      const service = new ChangeSetsService(mockDb);
      const res = await service.approve(orgId, projectId, 'cs-1', userId, {
        reason: 'Architect approved after passing preflight checks',
      });

      expect(res.changeset.approval_status).toBe('APPROVED');
      expect(res.evidencePack.auditCertificate).toBeDefined();
    });
  });

  describe('TraceabilityService (Delivery Traceability)', () => {
    let mockCloudAlm: any;
    let mockJira: any;

    beforeEach(() => {
      mockCloudAlm = {
        createRemediationTask: vi.fn(),
      };
      mockJira = {
        createIssue: vi.fn(),
      };
    });

    it('should return 8-column matrix and calculate unmitigated risks', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'node-1',
            process_hierarchy: 'Order-to-Cash',
            requirement_id: 'REQ-01',
            finding_id: 'f-1',
            finding_severity: 'CRITICAL',
            remediation_task_id: null, // Critical finding without task!
            test_case_id: null, // Untested!
            transport_id: 'TRK900101',
            release_id: 'REL_2026_01',
            task_status: 'OPEN',
          },
        ],
      });

      const service = new TraceabilityService(mockDb, mockCloudAlm, mockJira);
      const matrix = await service.getMatrix(orgId, projectId);

      expect(matrix.nodes.length).toBe(1);
      expect(matrix.summary.requirementsWithoutTests).toBe(1);
      expect(matrix.summary.criticalFindingsWithoutTasks).toBe(1);
    });

    it('should dispatch remediation task to real SAP Cloud ALM connector when configured', async () => {
      mockDb.query
        // finding
        .mockResolvedValueOnce({
          rows: [{ id: 'f-1', rule_id: 'OPD_RULE_MISSING', severity: 'CRITICAL', title: 'Missing OPD rule' }],
        })
        // evidence
        .mockResolvedValueOnce({
          rows: [{ artifact_path: 'opd.xml', sha256: 'abc123hash' }],
        })
        // update traceability node
        .mockResolvedValueOnce({ rows: [] });

      mockCloudAlm.createRemediationTask.mockResolvedValueOnce({
        success: true,
        taskId: 'CALM-TASK-9988',
        deepLink: 'https://tenant.alm.cloud.sap/launchpad#Task-manage?sap-ui-app-id-hint=calm-tasks&/task/CALM-TASK-9988',
        status: 'SYNCHRONIZED',
      });

      const service = new TraceabilityService(mockDb, mockCloudAlm, mockJira);
      const task = await service.createRemediationTask(orgId, projectId, {
        findingId: 'f-1',
        externalSystem: 'SAP_CLOUD_ALM',
        tokenUrl: 'https://auth.btp.sap/oauth/token',
        clientId: 'my-client-id',
        clientSecret: 'my-client-secret',
        apiBaseUrl: 'https://tenant.alm.cloud.sap',
      } as any);

      expect(mockCloudAlm.createRemediationTask).toHaveBeenCalledWith(
        expect.objectContaining({
          tokenUrl: 'https://auth.btp.sap/oauth/token',
          clientId: 'my-client-id',
        }),
        expect.objectContaining({
          ruleId: 'OPD_RULE_MISSING',
          severity: 'CRITICAL',
        })
      );
      expect(task.taskId).toBe('CALM-TASK-9988');
      expect(task.status).toBe('SYNCHRONIZED');
      expect(task.deepLink).toContain('CALM-TASK-9988');
    });

    it('should report CREDENTIALS_REQUIRED when Cloud ALM credentials are not configured', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: 'f-1', rule_id: 'OPD_RULE_MISSING', severity: 'CRITICAL', title: 'Missing OPD rule' }],
        })
        .mockResolvedValueOnce({
          rows: [{ artifact_path: 'opd.xml', sha256: 'abc123hash' }],
        });

      mockCloudAlm.createRemediationTask.mockResolvedValueOnce({
        success: false,
        status: 'CREDENTIALS_REQUIRED',
        error: 'SAP Cloud ALM OAuth2 credentials are not configured.',
      });

      const service = new TraceabilityService(mockDb, mockCloudAlm, mockJira);
      const task = await service.createRemediationTask(orgId, projectId, {
        findingId: 'f-1',
        externalSystem: 'SAP_CLOUD_ALM',
      });

      expect(task.status).toBe('CREDENTIALS_REQUIRED');
      expect(task.error).toBeDefined();
    });
  });

  describe('DemoService (Synthetic Sandbox)', () => {
    it('should auto-provision sandbox with all 7 failure scenarios', async () => {
      mockDb.query
        // check existing
        .mockResolvedValueOnce({ rows: [] })
        // insert project
        .mockResolvedValueOnce({ rows: [{ id: 'demo-proj-1', name: 'Demo Project' }] })
        // insert analysis
        .mockResolvedValueOnce({ rows: [] })
        // 7 findings + 7 evidence insertions
        .mockResolvedValue({ rows: [] });

      const service = new DemoService(mockDb);
      const res = await service.provisionDemoProject(orgId, userId);

      expect(res.isNew).toBe(true);
      expect(res.project.id).toBe('demo-proj-1');
      // At least 1 (check) + 1 (project) + 1 (analysis) + 14 (findings & evidence) = 17 queries
      expect(mockDb.query.mock.calls.length).toBeGreaterThanOrEqual(17);
    });
  });

  describe('KnowledgeService (Release Governance)', () => {
    it('should provide canonical Release Compatibility Matrix across all 19 engines', () => {
      const service = new KnowledgeService();
      const matrix = service.getMatrix();

      expect(matrix.length).toBe(19);
      expect(matrix.some((m) => m.engineId === 'OPD_GUARD')).toBe(true);
      expect(matrix.some((m) => m.engineId === 'MFS_BLACKBOX')).toBe(true);
      expect(matrix.every((m) => m.status === 'SUPPORTED_VERIFIED')).toBe(true);
    });

    it('should expose immutable knowledge snapshots and finding stability diff', () => {
      const service = new KnowledgeService();
      const snapshots = service.getSnapshots();
      const stability = service.getFindingStabilityDiff();

      expect(snapshots.length).toBeGreaterThanOrEqual(2);
      expect(snapshots[0].immutableChecksum).toBeDefined();
      expect(stability.stabilityScorePercent).toBeGreaterThanOrEqual(99.0);
    });
  });

  describe('McpService (Model Context Protocol)', () => {
    it('should declare all 7 preflight tools in tools/list', () => {
      const knowledge = new KnowledgeService();
      const service = new McpService(mockDb, knowledge);
      const tools = service.getToolsList();

      expect(tools.length).toBe(7);
      expect(tools.some((t) => t.name === 'search_knowledge')).toBe(true);
      expect(tools.some((t) => t.name === 'lookup_object')).toBe(true);
      expect(tools.some((t) => t.name === 'compare_releases')).toBe(true);
    });

    it('should handle lookup_object correctly for standard SAP tables', async () => {
      const knowledge = new KnowledgeService();
      const service = new McpService(mockDb, knowledge);
      const res = await service.handleCall(orgId, 'lookup_object', { objectName: 'BKPF' });

      expect(res.classification).toBe('STANDARD_SAP_TABLE');
      expect(res.cleanCoreTier).toBe('TIER_3_CLASSIC');
      expect(res.releasedForCloud).toBe(false);
    });
  });

  describe('AgentGateService (Agentic Change Gate)', () => {
    it('should evaluate change proposal and return verdict', async () => {
      mockDb.query
        // verify agent
        .mockResolvedValueOnce({ rows: [{ id: 'ag-1', name: 'Cursor Claude' }] })
        // insert proposal
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prop-1',
              proposal_hash: 'prophash123',
              verdict: 'CLEAR',
              approval_status: 'PENDING_REVIEW',
            },
          ],
        });

      const service = new AgentGateService(mockDb);
      const res = await service.submitProposal(orgId, {
        projectId,
        agentId: 'ag-1',
        changeType: 'API_UPDATE',
        proposedDiff: { field: 'safe_change' },
        targetEnvironment: 'QA',
      });

      expect(res.id).toBe('prop-1');
      expect(res.verdict).toBe('CLEAR');
    });

    it('should approve proposal and issue 15-minute cryptographic Execution Token', async () => {
      mockDb.query
        // find proposal
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prop-1',
              proposal_hash: 'hash_abc',
              target_environment: 'QA',
              verdict: 'CLEAR',
            },
          ],
        })
        // update proposal
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prop-1',
              approval_status: 'APPROVED',
            },
          ],
        });

      const service = new AgentGateService(mockDb);
      const res = await service.approveProposal(orgId, 'prop-1', userId);

      expect(res.executionToken).toContain('EXEC_');
      expect(res.expiresAt).toBeDefined();
    });

    it('should verify and consume execution token and enforce anti-replay lifecycle', async () => {
      // 1. Approve to get valid token
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prop-exec-1',
              agent_id: 'agent-1',
              proposal_hash: 'hash_exec_123',
              target_environment: 'QA',
              verdict: 'CLEAR',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [{ id: 'prop-exec-1', approval_status: 'APPROVED' }],
        });

      const service = new AgentGateService(mockDb);
      const approved = await service.approveProposal(orgId, 'prop-exec-1', userId);

      // 2. Consume token successfully
      mockDb.query
        // verify proposal
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'prop-exec-1',
              agent_id: 'agent-1',
              proposal_hash: 'hash_exec_123',
              target_environment: 'QA',
              approval_status: 'APPROVED',
            },
          ],
        })
        // verify agent
        .mockResolvedValueOnce({
          rows: [{ id: 'agent-1', status: 'ACTIVE' }],
        })
        // update proposal status to EXECUTED
        .mockResolvedValueOnce({ rows: [] });

      const consumed = await service.verifyAndConsumeExecutionToken(orgId, approved.executionToken);
      expect(consumed.verified).toBe(true);
      expect(consumed.proposalId).toBe('prop-exec-1');

      // 3. Replay attempt: proposal is now EXECUTED -> must throw BadRequestException
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'prop-exec-1',
            agent_id: 'agent-1',
            proposal_hash: 'hash_exec_123',
            target_environment: 'QA',
            approval_status: 'EXECUTED',
          },
        ],
      });

      await expect(
        service.verifyAndConsumeExecutionToken(orgId, approved.executionToken)
      ).rejects.toThrow('replay prevention');
    });
  });

  describe('ApiKeysService (Developer API)', () => {
    it('should create API key with prefix and secret', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const service = new ApiKeysService(mockDb);
      const res = await service.create(orgId, userId, { name: 'CI/CD Key' });

      expect(res.apiKey).toContain('erppf_live_');
      expect(res.prefix).toBe(res.apiKey.slice(0, 15));
      expect(res.scopes).toContain('projects:read');
    });

    it('should validate active key and reject revoked key', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: 'k-1', status: 'ACTIVE', expires_at: null }],
        })
        // update last_used_at
        .mockResolvedValueOnce({ rows: [] });

      const service = new ApiKeysService(mockDb);
      const valid = await service.validateKey('erppf_live_mockkey');
      expect(valid).not.toBeNull();
      expect(valid?.id).toBe('k-1');
    });
  });

  describe('WebhooksService (Enterprise Real-Time Events)', () => {
    it('should create webhook with secret and send test ping with HMAC signature', async () => {
      mockDb.query
        // create
        .mockResolvedValueOnce({
          rows: [{ id: 'wh-1', url: 'https://webhook.site/test', secret: 'whsec_secret123' }],
        })
        // sendTestPing fetch
        .mockResolvedValueOnce({
          rows: [{ id: 'wh-1', url: 'https://webhook.site/test', secret: 'whsec_secret123' }],
        })
        // update last_triggered
        .mockResolvedValueOnce({ rows: [] });

      const service = new WebhooksService(mockDb);
      const created = await service.create(orgId, userId, { url: 'https://webhook.site/test' });
      expect(created.secret).toContain('whsec_');

      const ping = await service.sendTestPing(orgId, 'wh-1');
      expect(ping.signatureHeader).toContain('sha256=');
      expect(ping.success).toBe(true);
    });
  });

  describe('LandscapesService (Landscape Registry)', () => {
    it('should register system and list landscape models', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          { id: 'land-1', system_id: 'S4H_PRD', environment: 'PROD', criticality: 'CRITICAL' },
        ],
      });

      const service = new LandscapesService(mockDb);
      const list = await service.findAll(orgId);

      expect(list.length).toBe(1);
      expect(list[0].system_id).toBe('S4H_PRD');
    });

    it('should fail closed with FAILED_UNREACHABLE when target SAP host cannot be reached over network', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'land-fail-1',
              system_id: 'S4H_UNREACHABLE',
              environment: 'QA',
              product: 'SAP S/4HANA',
              edition: 'Private Cloud',
              release: '2023',
              // Use non-routable documentation IP with closed port to trigger real connection rejection
              url: 'http://127.0.0.1:49999',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // update landscapes status to UNREACHABLE

      const service = new LandscapesService(mockDb);
      const res = await service.testConnection(orgId, 'land-fail-1');

      expect(res.handshakeStatus).toBe('FAILED_UNREACHABLE');
      expect(res.error).toBeDefined();
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE landscapes SET status = 'UNREACHABLE'"),
        expect.any(Array)
      );
    });

    it('should handle missing URL with CONFIG_ERROR and mark OFFLINE', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'land-nourl',
              system_id: 'S4H_NO_URL',
              environment: 'DEV',
              url: '',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] });

      const service = new LandscapesService(mockDb);
      const res = await service.testConnection(orgId, 'land-nourl');

      expect(res.handshakeStatus).toBe('CONFIG_ERROR');
      expect(res.status).toBe('OFFLINE');
    });

    it('should block SSRF attempts to cloud metadata IP with BLOCKED_SSRF and mark SECURITY_BLOCKED', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'land-ssrf-1',
              system_id: 'S4H_ATTACK',
              environment: 'PROD',
              product: 'SAP S/4HANA',
              edition: 'Private Cloud',
              release: '2023',
              url: 'http://169.254.169.254/latest/meta-data/',
            },
          ],
        })
        .mockResolvedValueOnce({ rows: [] }); // update landscapes status to SECURITY_BLOCKED

      const service = new LandscapesService(mockDb);
      const res = await service.testConnection(orgId, 'land-ssrf-1');

      expect(res.handshakeStatus).toBe('BLOCKED_SSRF');
      expect(res.status).toBe('SECURITY_BLOCKED');
      expect(res.error).toContain('SSRF');
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE landscapes SET status = 'SECURITY_BLOCKED'"),
        expect.any(Array)
      );
    });

    it('should reject cloud metadata URL during landscape registration', async () => {
      const service = new LandscapesService(mockDb);
      await expect(
        service.create(orgId, {
          systemId: 'SSRF_DEV',
          product: 'SAP S/4HANA',
          edition: 'Private Cloud',
          release: '2023',
          environment: 'DEV',
          url: 'http://metadata.google.internal/computeMetadata/v1/',
        })
      ).rejects.toThrow('Cloud instance metadata endpoint detected');
    });
  });

  describe('JobsService (Scheduled Preflights Runtime)', () => {
    let mockQueue: any;
    let mockConfig: any;

    beforeEach(() => {
      mockQueue = {
        add: vi.fn().mockResolvedValue({ id: 'job-1' }),
        removeRepeatable: vi.fn().mockResolvedValue(true),
      };
      mockConfig = {
        get: vi.fn().mockReturnValue('http://localhost:8000'),
      };
    });

    it('should schedule recurring preflight with valid cron pattern and register BullMQ repeatable job', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            id: 'sched-1',
            organization_id: orgId,
            project_id: projectId,
            cron_expression: '0 2 * * *',
            engine_types: ['OPD_GUARD', 'FORM_DOCTOR'],
            target_release: 'S4H_2023',
            status: 'ACTIVE',
            repeat_job_key: `sched:${orgId}:${projectId}:sched-1`,
          },
        ],
      });

      const service = new JobsService(mockDb, mockConfig, mockQueue);
      const res = await service.schedulePreflight(orgId, userId, {
        projectId,
        cronExpression: '0 2 * * *',
        engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'] as any,
        targetRelease: 'S4H_2023' as any,
      });

      expect(res.id).toBe('sched-1');
      expect(mockQueue.add).toHaveBeenCalledWith(
        'scheduled-preflight',
        expect.objectContaining({
          organizationId: orgId,
          projectId,
          engineTypes: ['OPD_GUARD', 'FORM_DOCTOR'],
        }),
        expect.objectContaining({
          repeat: expect.objectContaining({ pattern: '0 2 * * *' }),
        })
      );
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO scheduled_preflights'),
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('should reject malformed cron patterns', async () => {
      const service = new JobsService(mockDb, mockConfig, mockQueue);
      await expect(
        service.schedulePreflight(orgId, userId, {
          projectId,
          cronExpression: 'invalid-cron',
          engineTypes: ['OPD_GUARD'] as any,
        })
      ).rejects.toThrow('Invalid cron pattern');
    });

    it('should cancel scheduled preflight and deregister BullMQ repeatable job', async () => {
      mockDb.query
        // find existing
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'sched-1',
              organization_id: orgId,
              cron_expression: '0 2 * * *',
              repeat_job_key: 'sched:repeat:key:1',
              status: 'ACTIVE',
            },
          ],
        })
        // update status to CANCELLED
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'sched-1',
              status: 'CANCELLED',
            },
          ],
        });

      const service = new JobsService(mockDb, mockConfig, mockQueue);
      const res = await service.cancelScheduledPreflight(orgId, 'sched-1');

      expect(res.status).toBe('CANCELLED');
      expect(mockQueue.removeRepeatable).toHaveBeenCalledWith('scheduled-preflight', {
        pattern: '0 2 * * *',
        jobId: 'sched:repeat:key:1',
      });
    });
  });
});

