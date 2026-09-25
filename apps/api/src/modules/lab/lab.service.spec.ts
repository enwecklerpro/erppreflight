import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LabService } from './lab.service';
import { ScenarioDomain, ScenarioFailureType } from './dto/lab.dto';
import { ServiceUnavailableException } from '@nestjs/common';

describe('LabService (Comprehensive M1 Test Suite)', () => {
  let mockDb: any;
  let labService: LabService;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    labService = new LabService(mockDb);
    vi.restoreAllMocks();
  });

  describe('Synthetic Scenario Generation across 4 Domains', () => {
    it('generates valid OPD scenarios across all failure types', () => {
      const types = [
        ScenarioFailureType.CLEAN_PASS,
        ScenarioFailureType.OPD_MISSING_RECIPIENT,
        ScenarioFailureType.OPD_INVALID_CHANNEL,
        ScenarioFailureType.OPD_SHADOWED_RULE,
      ];

      for (const ft of types) {
        const res = labService.generateScenario({
          domain: ScenarioDomain.OPD,
          failureType: ft,
        });

        expect(res.scenarioId).toBeDefined();
        expect(res.domain).toBe('OPD');
        expect(res.format).toBe('xml');
        expect(res.payload).toContain('<OutputParameterDetermination>');
        expect(res.payload).toContain('<Scenario>');
        expect(res.payload).toContain('<DecisionTables>');

        if (ft === ScenarioFailureType.CLEAN_PASS) {
          expect(res.expectedFindings).toHaveLength(0);
        } else if (ft === ScenarioFailureType.OPD_MISSING_RECIPIENT) {
          expect(res.expectedFindings[0].ruleId).toBe('OPD_DETERMINATION_STEP_MISSING');
        } else if (ft === ScenarioFailureType.OPD_INVALID_CHANNEL) {
          expect(res.expectedFindings[0].ruleId).toBe('OPD_CHANNEL_INACTIVE');
        } else if (ft === ScenarioFailureType.OPD_SHADOWED_RULE) {
          expect(res.expectedFindings[0].ruleId).toBe('OPD_UNREACHABLE_RULE');
        }
      }
    });

    it('generates valid FORM scenarios across failure types', () => {
      const types = [
        ScenarioFailureType.CLEAN_PASS,
        ScenarioFailureType.FORM_MISSING_BINDING,
        ScenarioFailureType.FORM_BINDING_MISMATCH,
        ScenarioFailureType.FORM_TRUNCATION_RISK,
      ];

      for (const ft of types) {
        const res = labService.generateScenario({
          domain: ScenarioDomain.FORM,
          failureType: ft,
        });

        expect(res.domain).toBe('FORM');
        expect(res.format).toBe('json');
        const parsed = JSON.parse(res.payload);
        expect(parsed.xdp_content).toBeDefined();
        expect(parsed.xml_content).toBeDefined();

        if (ft === ScenarioFailureType.CLEAN_PASS) {
          expect(res.expectedFindings).toHaveLength(0);
        } else if (ft === ScenarioFailureType.FORM_MISSING_BINDING) {
          expect(res.expectedFindings[0].ruleId).toBe('FORM_FIELD_MISSING_IN_XML');
        }
      }
    });

    it('generates valid MFS conveyor topology and telegram scenarios', () => {
      const types = [
        ScenarioFailureType.CLEAN_PASS,
        ScenarioFailureType.MFS_LOCATION_JUMP,
        ScenarioFailureType.MFS_ACK_TIMEOUT,
      ];

      for (const ft of types) {
        const res = labService.generateScenario({
          domain: ScenarioDomain.MFS,
          failureType: ft,
        });

        expect(res.domain).toBe('MFS');
        expect(res.format).toBe('json');
        const parsed = JSON.parse(res.payload);
        expect(parsed.conveyor_edges).toBeDefined();
        expect(parsed.telegrams).toBeInstanceOf(Array);

        if (ft === ScenarioFailureType.MFS_LOCATION_JUMP) {
          expect(res.expectedFindings[0].ruleId).toBe('MFS_IMPOSSIBLE_TOPOLOGY_JUMP');
        }
      }
    });

    it('generates valid CHANGE_POINTER delta scenarios', () => {
      const types = [
        ScenarioFailureType.CLEAN_PASS,
        ScenarioFailureType.CP_MISSING_FIELD_TRIGGER,
        ScenarioFailureType.CP_GLOBAL_DISABLED,
      ];

      for (const ft of types) {
        const res = labService.generateScenario({
          domain: ScenarioDomain.CHANGE_POINTER,
          failureType: ft,
        });

        expect(res.domain).toBe('CHANGE_POINTER');
        expect(res.format).toBe('json');
        const parsed = JSON.parse(res.payload);
        expect(parsed.message_type).toBe('MATMAS');
        expect(parsed.bd52_fields).toBeDefined();

        if (ft === ScenarioFailureType.CP_MISSING_FIELD_TRIGGER) {
          expect(res.expectedFindings[0].ruleId).toBe('CP_CRITICAL_FIELD_MISSING');
        } else if (ft === ScenarioFailureType.CP_GLOBAL_DISABLED) {
          expect(res.expectedFindings[0].ruleId).toBe('CP_GLOBAL_DISABLED');
        }
      }
    });
  });

  describe('Live Preflight Dispatch & Assertion Ledger Evaluation', () => {
    it('executes live run and produces 100% verified assertion ledger when defects match expected', async () => {
      const mockResponse = {
        job_id: 'a1111111-1111-1111-1111-111111111111',
        engine_type: 'MFS_BLACKBOX',
        status: 'COMPLETED',
        findings: [
          {
            id: 'b1111111-1111-1111-1111-111111111111',
            rule_id: 'MFS_IMPOSSIBLE_TOPOLOGY_JUMP',
            severity: 'CRITICAL',
            title: 'Impossible conveyor topology jump',
            description: 'HU_8811 jumped from CP01 to CP05.',
            confidence: 'VERIFIED',
            confidence_score: 1.0,
            remediation: 'Check conveyor diversion switch.',
            evidence: [
              {
                artifact_path: 'telegrams.json',
                line_number: 22,
                snippet: 'CP05 MOVE HU_8811',
                sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
                provenance: 'VERIFIED',
                trust_score: 1.0,
              },
            ],
          },
        ],
        metrics: {
          execution_time_ms: 65,
          rules_evaluated: 24,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const run = await labService.runScenario({
        domain: ScenarioDomain.MFS,
        payload: '{"conveyor_edges":[],"telegrams":[]}',
        expectedFindings: [
          {
            ruleId: 'MFS_IMPOSSIBLE_TOPOLOGY_JUMP',
            severity: 'CRITICAL',
            description: 'Impossible jump',
          },
        ],
      });

      expect(run.overallStatus).toBe('PASSED');
      expect(run.verdict).toBe('DEFECTS_DETECTED');
      expect(run.allPassed).toBe(true);
      expect(run.passedCount).toBe(1);
      expect(run.failedCount).toBe(0);
      expect(run.assertionLedger[0].passed).toBe(true);
      expect(run.assertionLedger[0].ruleId).toBe('MFS_IMPOSSIBLE_TOPOLOGY_JUMP');
      expect(run.assertionLedger[0].evidenceSha256).toBeDefined();
    });

    it('detects a regression when an expected defect is missed by preflight analysis', async () => {
      // Mock engine returns 0 findings, but we expected a critical defect!
      const mockResponse = {
        job_id: 'a2222222-2222-2222-2222-222222222222',
        engine_type: 'OPD_GUARD',
        status: 'COMPLETED',
        findings: [],
        metrics: { execution_time_ms: 20, rules_evaluated: 10 },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const run = await labService.runScenario({
        domain: ScenarioDomain.OPD,
        payload: '<OutputParameterDetermination />',
        expectedFindings: [
          {
            ruleId: 'OPD_DETERMINATION_STEP_MISSING',
            severity: 'CRITICAL',
            description: 'Expected missing channel',
          },
        ],
      });

      expect(run.overallStatus).toBe('REGRESSION_DETECTED');
      expect(run.allPassed).toBe(false);
      expect(run.failedCount).toBe(1);
      expect(run.assertionLedger[0].passed).toBe(false);
      expect(run.assertionLedger[0].message).toContain('Regression / Defect Missed');
    });

    it('detects unexpected findings as false positive failures', async () => {
      // Engine returns an unpredicted defect on a clean scenario
      const mockResponse = {
        job_id: 'a3333333-3333-3333-3333-333333333333',
        engine_type: 'CHANGE_POINTER_COVERAGE_AUDITOR',
        status: 'COMPLETED',
        findings: [
          {
            id: 'b3333333-3333-3333-3333-333333333333',
            rule_id: 'CP_UNEXPECTED_ANOMALY',
            severity: 'MAJOR',
            title: 'Unexpected Anomaly Triggered',
            description: 'Anomaly in test',
            confidence: 'RULE_DERIVED',
            confidence_score: 0.85,
            remediation: 'Review configuration',
            evidence: [],
          },
        ],
        metrics: { execution_time_ms: 15, rules_evaluated: 8 },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockResponse,
      } as any);

      const run = await labService.runScenario({
        domain: ScenarioDomain.CHANGE_POINTER,
        payload: '{}',
        expectedFindings: [], // expected clean!
      });

      expect(run.overallStatus).toBe('REGRESSION_DETECTED');
      expect(run.allPassed).toBe(false);
      expect(run.failedCount).toBe(1);
      expect(run.assertionLedger[0].passed).toBe(false);
      expect(run.assertionLedger[0].message).toContain('False positive / Unexpected defect');
    });

    it('throws ServiceUnavailableException when analysis microservice is unreachable', async () => {
      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(
        new Error('connect ECONNREFUSED 127.0.0.1:8000')
      );

      await expect(
        labService.runScenario({
          domain: ScenarioDomain.OPD,
          payload: '<xml/>',
        })
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });

  describe('Database Persistence & Retrieval', () => {
    it('persists synthetic scenario into synthetic_scenarios table', async () => {
      mockDb.query.mockResolvedValueOnce({ rows: [] });

      const scenario = labService.generateScenario(
        {
          domain: ScenarioDomain.OPD,
          failureType: ScenarioFailureType.OPD_INVALID_CHANNEL,
        },
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      );

      await labService.persistScenario(
        scenario,
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000002',
      );

      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO synthetic_scenarios'),
        expect.arrayContaining([
          scenario.scenarioId,
          '00000000-0000-0000-0000-000000000001',
          '00000000-0000-0000-0000-000000000002',
          'OPD',
        ]),
        { tenantId: '00000000-0000-0000-0000-000000000001' },
      );
    });

    it('retrieves saved scenarios with tenant RLS isolation', async () => {
      mockDb.query.mockResolvedValueOnce({
        rows: [
          {
            scenarioId: 'scen-101',
            projectId: 'proj-1',
            domain: 'OPD',
            scenarioName: 'Test OPD Missing Channel',
            failureType: 'OPD_INVALID_CHANNEL',
            payload: '<xml/>',
            expectedFindings: [
              {
                ruleId: 'OPD_CHANNEL_INACTIVE',
                severity: 'CRITICAL',
                description: 'Decommissioned channel',
              },
            ],
            createdAt: new Date('2026-09-25T03:00:00Z'),
          },
        ],
      });

      const scenarios = await labService.getScenarios(
        'org-tenant-1',
        'proj-1',
      );

      expect(scenarios).toHaveLength(1);
      expect(scenarios[0].scenarioId).toBe('scen-101');
      expect(scenarios[0].domain).toBe('OPD');
      expect(scenarios[0].expectedFindings).toHaveLength(1);
      expect(mockDb.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT'),
        ['org-tenant-1', 'proj-1'],
        { tenantId: 'org-tenant-1' },
      );
    });
  });
});
