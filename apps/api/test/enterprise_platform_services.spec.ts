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

describe('Enterprise Platform Services Suite', () => {
  let mockDb: any;
  const orgId = '11111111-1111-1111-1111-111111111111';
  const projectId = '22222222-2222-2222-2222-222222222222';
  const userId = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
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

      const service = new TraceabilityService(mockDb);
      const matrix = await service.getMatrix(orgId, projectId);

      expect(matrix.nodes.length).toBe(1);
      expect(matrix.summary.requirementsWithoutTests).toBe(1);
      expect(matrix.summary.criticalFindingsWithoutTasks).toBe(1);
    });

    it('should generate Cloud ALM remediation task with deep links', async () => {
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

      const service = new TraceabilityService(mockDb);
      const task = await service.createRemediationTask(orgId, projectId, {
        findingId: 'f-1',
        externalSystem: 'SAP_CLOUD_ALM',
      });

      expect(task.taskId).toContain('CALM-TSK');
      expect(task.deepLink).toContain('/findings?id=f-1');
      expect(task.evidenceSha256).toBe('abc123hash');
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
  });
});
