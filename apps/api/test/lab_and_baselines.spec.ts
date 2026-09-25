import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LabService } from '../src/modules/lab/lab.service';
import { ScenarioDomain, ScenarioFailureType } from '../src/modules/lab/dto/lab.dto';
import { ProjectsService } from '../src/modules/projects/projects.service';
import { ExportService } from '../src/modules/export/export.service';
import unzipper from 'unzipper';

describe('R1, R2, R3: Scenario Lab, Baselines/Drift, and Reproducibility Bundle', () => {
  let mockDb: any;
  let labService: LabService;
  let projectsService: ProjectsService;
  let exportService: ExportService;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    labService = new LabService(mockDb);
    projectsService = new ProjectsService(mockDb);
    exportService = new ExportService(mockDb, {} as any);
  });

  describe('R1: Scenario & Regression Test Lab (LabService)', () => {
    it('generates synthetic OPD scenario with defect', () => {
      const res = labService.generateScenario({
        domain: ScenarioDomain.OPD,
        failureType: ScenarioFailureType.OPD_MISSING_RECIPIENT,
      });

      expect(res).toBeDefined();
      expect(res.domain).toBe('OPD');
      expect(res.failureType).toBe('OPD_MISSING_RECIPIENT');
      expect(res.expectedFindings.length).toBeGreaterThan(0);
      expect(res.expectedFindings[0].ruleId).toBe('OPD_DETERMINATION_STEP_MISSING');
      expect(res.payload).toContain('BILLING_DOCUMENT');
    });

    it('executes live regression run on scenario and verifies assertions', async () => {
      const scenario = labService.generateScenario({
        domain: ScenarioDomain.OPD,
        failureType: ScenarioFailureType.OPD_MISSING_RECIPIENT,
      });

      const mockAnalysisResponse = {
        job_id: 'a0000000-0000-0000-0000-000000000001',
        engine_type: 'OPD_GUARD',
        status: 'COMPLETED',
        findings: [
          {
            id: 'b0000000-0000-0000-0000-000000000001',
            rule_id: 'OPD_DETERMINATION_STEP_MISSING',
            severity: 'CRITICAL',
            title: 'Email Recipient determination failed for customer 100045',
            description: 'No recipient rule matched.',
            confidence: 'VERIFIED',
            confidence_score: 1.0,
            remediation: 'Add rule to Email Recipient table.',
            evidence: [
              {
                artifact_path: 'opd_decision_tables#Email Recipient',
                line_number: 14,
                snippet: 'Step Email Recipient',
                sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
                provenance: 'VERIFIED',
                trust_score: 1.0,
              },
            ],
          },
        ],
        metrics: {
          execution_time_ms: 45,
          rules_evaluated: 12,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockAnalysisResponse,
      } as any);

      const run = await labService.runScenario({
        domain: ScenarioDomain.OPD,
        payload: scenario.payload,
        expectedFindings: scenario.expectedFindings,
      });

      expect(run.overallStatus).toBe('PASSED');
      expect(run.verdict).toBe('DEFECTS_DETECTED');
      expect(run.assertionsCount).toBe(1);
      expect(run.findings.length).toBe(1);
      expect(run.findings[0].ruleId).toBe('OPD_DETERMINATION_STEP_MISSING');
    });

    it('executes clean pass on clean scenario', async () => {
      const scenario = labService.generateScenario({
        domain: ScenarioDomain.OPD,
        failureType: ScenarioFailureType.CLEAN_PASS,
      });

      const mockCleanResponse = {
        job_id: 'a0000000-0000-0000-0000-000000000002',
        engine_type: 'OPD_GUARD',
        status: 'COMPLETED',
        findings: [],
        metrics: {
          execution_time_ms: 30,
          rules_evaluated: 16,
        },
      };

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
        ok: true,
        json: async () => mockCleanResponse,
      } as any);

      const run = await labService.runScenario({
        domain: ScenarioDomain.OPD,
        payload: scenario.payload,
        expectedFindings: scenario.expectedFindings,
      });

      expect(run.overallStatus).toBe('PASSED');
      expect(run.verdict).toBe('CLEAR');
      expect(run.passedAssertions).toBe(1);
      expect(run.failedAssertions).toBe(0);
      expect(run.findings.length).toBe(0);
    });
  });

  describe('R2: Project Baselines & Configuration Drift Engine', () => {
    it('sets an analysis run as project baseline', async () => {
      mockDb.query
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', organization_id: 'org-1', name: 'S4H Migration' }] }) // findOne
        .mockResolvedValueOnce({ rows: [{ id: 'ana-1', project_id: 'proj-1' }] }) // verify analysis
        .mockResolvedValueOnce({ rows: [] }) // reset prev baseline
        .mockResolvedValueOnce({ rows: [] }) // mark new baseline
        .mockResolvedValueOnce({
          rows: [{ id: 'proj-1', baseline_analysis_id: 'ana-1', name: 'S4H Migration' }],
        }); // update project

      const result = await projectsService.setBaseline('org-1', 'proj-1', 'ana-1');
      expect(result.success).toBe(true);
      expect(result.baselineAnalysisId).toBe('ana-1');
    });

    it('computes exact configuration drift between baseline and current run', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [{ id: 'proj-1', organization_id: 'org-1', baseline_analysis_id: 'ana-base' }],
        }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-base', created_at: '2026-09-01T00:00:00Z', clean_core_score: 80 }],
        }) // baseline analysis
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-latest', created_at: '2026-09-24T00:00:00Z', clean_core_score: 85 }],
        }) // latest analysis
        .mockResolvedValueOnce({
          rows: [
            { id: 'f-1', rule_id: 'CLEAN_CORE_DIRECT_DB', title: 'Direct DB Write in Z_REPORT' },
            { id: 'f-2', rule_id: 'FORM_DOCTOR_OBSOLETE_SMARTFORM', title: 'Obsolete Smartform Z_INVOICE' },
          ],
        }) // baseline findings
        .mockResolvedValueOnce({
          rows: [
            { id: 'f-1', rule_id: 'CLEAN_CORE_DIRECT_DB', title: 'Direct DB Write in Z_REPORT' }, // persistent
            { id: 'f-3', rule_id: 'OPD_CHANNEL_MISSING', title: 'Missing OPD Channel EDI' }, // new
          ],
        }); // comparison findings

      const drift = await projectsService.getDrift('org-1', 'proj-1');

      expect(drift.hasBaseline).toBe(true);
      expect(drift.driftSummary.knownBaselineRisks).toBe(1);
      expect(drift.driftSummary.newlyIntroducedRisks).toBe(1);
      expect(drift.driftSummary.resolvedRisks).toBe(1);
      expect(drift.driftSummary.scoreDelta).toBe(5);
      expect(drift.findings.knownBaseline[0].driftClassification).toBe('KNOWN_BASELINE_RISK');
      expect(drift.findings.newlyIntroduced[0].driftClassification).toBe('NEWLY_INTRODUCED_RISK');
      expect(drift.findings.resolved[0].driftClassification).toBe('RESOLVED_RISK');
    });
  });

  describe('R3: Reproducibility Bundle Downloader (.zip)', () => {
    it('generates a valid signed ZIP containing manifest, hashes, findings ledger, and remediation guide', async () => {
      mockDb.query
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'ana-1',
              project_id: 'proj-1',
              project_name: 'SAP S/4HANA 2023 Wave 1',
              organization_id: 'org-1',
              target_release: 'S4H_2023',
              clean_core_score: 82,
              status: 'COMPLETED',
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'f-1',
              rule_id: 'OPD_DETERMINATION_STEP_MISSING',
              severity: 'CRITICAL',
              title: 'Output Determination Step Missing for Email Channel',
              description: 'No condition record found for output type BILLING_DOCUMENT.',
              remediation: 'Configure BRFplus decision table rule in transaction OPD.',
              confidence_class: 'VERIFIED',
              confidence_score: 1.0,
              created_at: new Date().toISOString(),
            },
          ],
        })
        .mockResolvedValueOnce({
          rows: [
            {
              id: 'ev-1',
              finding_id: 'f-1',
              artifact_path: 'exports/opd_rules.xml',
              line_number: 142,
              snippet: '<DeterminationRule step="002" active="false" />',
              sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
              provenance: 'VERIFIED',
            },
          ],
        });

      const { buffer, fileName, checksumSha256 } = await exportService.generateReproducibilityZip(
        'org-1',
        'ana-1'
      );

      expect(fileName).toMatch(/^Reproducibility_Bundle_ana-1.*\.zip$/);
      expect(checksumSha256).toBeDefined();
      expect(buffer.length).toBeGreaterThan(0);

      // Verify that unzipper can read all 4 expected files from the buffer
      const directory = await unzipper.Open.buffer(buffer);
      const fileNames = directory.files.map((f) => f.path);

      expect(fileNames).toContain('manifest.json');
      expect(fileNames).toContain('normalized_hashes.json');
      expect(fileNames).toContain('findings_ledger.json');
      expect(fileNames).toContain('remediation_guide.md');

      const manifestContent = await directory.files.find((f) => f.path === 'manifest.json')?.buffer();
      const manifestParsed = JSON.parse(manifestContent!.toString());
      expect(manifestParsed.knowledge_snapshot_id).toBe('KNOW_SNAP_2026_09_24');
      expect(manifestParsed.target_release).toBe('S4H_2023');
      expect(manifestParsed.engine_versions.OPD_GUARD).toBe('2.4.1');
    });
  });
});
