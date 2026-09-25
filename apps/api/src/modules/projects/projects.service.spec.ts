import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProjectsService, computeCleanCoreIndex } from './projects.service';
import { DatabaseService } from '../database/database.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { createFindingFingerprint } from '@erppreflight/evidence';

describe('ProjectsService', () => {
  let service: ProjectsService;
  let mockDb: Partial<DatabaseService>;

  beforeEach(() => {
    mockDb = {
      query: vi.fn(),
    };
    service = new ProjectsService(mockDb as DatabaseService);
  });

  it('should create a new project', async () => {
    const mockCreated = {
      id: 'proj-1',
      organization_id: 'org-1',
      name: 'Migration S4 2023',
      target_release: 'S4H_2023',
    };
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [mockCreated] });

    const result = await service.create('org-1', 'user-1', {
      name: 'Migration S4 2023',
      description: 'S/4HANA Clean Core Migration',
      targetRelease: 'S4H_2023',
    });

    expect(result.id).toBe('proj-1');
    expect(result.name).toBe('Migration S4 2023');
  });

  it('should return all projects for organization', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({
      rows: [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }],
    });

    const list = await service.findAll('org-1');
    expect(list.length).toBe(2);
  });

  it('should throw NotFoundException when project is missing', async () => {
    mockDb.query = vi.fn().mockResolvedValueOnce({ rows: [] });

    await expect(service.findOne('org-1', 'missing-id')).rejects.toThrow(
      NotFoundException
    );
  });

  describe('setBaseline', () => {
    it('successfully sets a COMPLETED analysis run as the baseline', async () => {
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', organization_id: 'org-1' }] }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-1', project_id: 'proj-1', status: 'COMPLETED' }],
        }) // find analysis
        .mockResolvedValueOnce({ rows: [] }) // reset existing baseline
        .mockResolvedValueOnce({ rows: [] }) // set is_baseline = true
        .mockResolvedValueOnce({
          rows: [{ id: 'proj-1', baseline_analysis_id: 'ana-1' }],
        }); // update project

      const result = await service.setBaseline('org-1', 'proj-1', 'ana-1');
      expect(result.success).toBe(true);
      expect(result.baselineAnalysisId).toBe('ana-1');
    });

    it('rejects RUNNING analysis runs with BadRequestException', async () => {
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', organization_id: 'org-1' }] }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-run', project_id: 'proj-1', status: 'RUNNING' }],
        }); // find analysis

      await expect(service.setBaseline('org-1', 'proj-1', 'ana-run')).rejects.toThrow(
        BadRequestException
      );
    });

    it('rejects FAILED analysis runs with BadRequestException', async () => {
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', organization_id: 'org-1' }] }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-fail', project_id: 'proj-1', status: 'FAILED' }],
        }); // find analysis

      await expect(service.setBaseline('org-1', 'proj-1', 'ana-fail')).rejects.toThrow(
        BadRequestException
      );
    });

    it('rejects QUEUED / PENDING analysis runs with BadRequestException', async () => {
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', organization_id: 'org-1' }] }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-pend', project_id: 'proj-1', status: 'QUEUED' }],
        }); // find analysis

      await expect(service.setBaseline('org-1', 'proj-1', 'ana-pend')).rejects.toThrow(
        BadRequestException
      );
    });

    it('throws NotFoundException when analysis does not exist for project', async () => {
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({ rows: [{ id: 'proj-1', organization_id: 'org-1' }] }) // findOne
        .mockResolvedValueOnce({ rows: [] }); // analysis not found

      await expect(service.setBaseline('org-1', 'proj-1', 'ana-nonexistent')).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('getDrift', () => {
    it('returns hasBaseline: false when project has no active baseline', async () => {
      mockDb.query = vi.fn().mockResolvedValueOnce({
        rows: [{ id: 'proj-1', organization_id: 'org-1', baseline_analysis_id: null }],
      });

      const res = await service.getDrift('org-1', 'proj-1');
      expect(res.hasBaseline).toBe(false);
      expect(res.driftSummary.knownBaselineRisks).toBe(0);
      expect(res.driftSummary.newlyIntroducedRisks).toBe(0);
      expect(res.driftSummary.resolvedRisks).toBe(0);
    });

    it('returns hasBaseline: true with comparison: null when no comparison analysis is found', async () => {
      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'proj-1', organization_id: 'org-1', baseline_analysis_id: 'ana-base' }],
        }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-base', created_at: '2026-09-01T00:00:00Z', target_release: 'S4H_2023' }],
        }) // baseline analysis
        .mockResolvedValueOnce({ rows: [] }) // no comparison analysis
        .mockResolvedValueOnce({
          rows: [
            { id: 'f-1', severity: 'BLOCKER', rule_id: 'RULE_1' },
          ],
        }); // baseline findings

      const res = await service.getDrift('org-1', 'proj-1');
      expect(res.hasBaseline).toBe(true);
      expect(res.comparison).toBeNull();
      expect(res.baseline?.cleanCoreIndex).toBe(85); // 100 - 15 = 85
    });

    it('uses SHA-256 fingerprint and multi-occurrence matching to categorize risks and compute scoreDelta', async () => {
      const fpA = createFindingFingerprint('OPD_GUARD_RULE_1', 'Z_BILLING_DOC', 'src/opd.xml');
      const fpB = createFindingFingerprint('FORM_DOC_RULE_2', 'Z_PURCHASE_ORDER', 'src/form.xml');
      const fpC = createFindingFingerprint('CLEAN_CORE_TIER3', 'Z_CDS_VIEW', 'src/view.cds');

      mockDb.query = vi
        .fn()
        .mockResolvedValueOnce({
          rows: [{ id: 'proj-1', organization_id: 'org-1', baseline_analysis_id: 'ana-base' }],
        }) // findOne
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-base', created_at: '2026-09-01T00:00:00Z', target_release: 'S4H_2023' }],
        }) // baseline analysis
        .mockResolvedValueOnce({
          rows: [{ id: 'ana-comp', created_at: '2026-09-24T00:00:00Z', target_release: 'S4H_2023' }],
        }) // comparison analysis
        .mockResolvedValueOnce({
          rows: [
            // 2 occurrences of fpA in baseline
            { id: 'f-base-1', fingerprint: fpA, rule_id: 'OPD_GUARD_RULE_1', severity: 'BLOCKER', title: 'OPD Error 1' },
            { id: 'f-base-2', fingerprint: fpA, rule_id: 'OPD_GUARD_RULE_1', severity: 'BLOCKER', title: 'OPD Error 2' },
            // 1 occurrence of fpB in baseline (will be resolved)
            { id: 'f-base-3', fingerprint: fpB, rule_id: 'FORM_DOC_RULE_2', severity: 'CRITICAL', title: 'Form Error' },
          ],
        }) // baseline findings
        .mockResolvedValueOnce({
          rows: [
            // 1 occurrence of fpA in comparison (1 matched as known, 1 resolved)
            { id: 'f-comp-1', fingerprint: fpA, rule_id: 'OPD_GUARD_RULE_1', severity: 'BLOCKER', title: 'OPD Error 1' },
            // 1 occurrence of fpC in comparison (newly introduced)
            { id: 'f-comp-2', fingerprint: fpC, rule_id: 'CLEAN_CORE_TIER3', severity: 'MAJOR', title: 'Clean Core Direct DB' },
          ],
        }); // comparison findings

      const drift = await service.getDrift('org-1', 'proj-1', 'ana-comp');

      expect(drift.hasBaseline).toBe(true);
      expect(drift.driftSummary.knownBaselineRisks).toBe(1);
      expect(drift.driftSummary.newlyIntroducedRisks).toBe(1);
      expect(drift.driftSummary.resolvedRisks).toBe(2); // 1 excess fpA from baseline + 1 fpB

      expect(drift.findings.knownBaseline[0].driftClassification).toBe('KNOWN_BASELINE_RISK');
      expect(drift.findings.knownBaseline[0].baselineFindingId).toBe('f-base-1');
      expect(drift.findings.newlyIntroduced[0].driftClassification).toBe('NEWLY_INTRODUCED_RISK');
      expect(drift.findings.resolved.map((r: any) => r.driftClassification)).toEqual([
        'RESOLVED_RISK',
        'RESOLVED_RISK',
      ]);

      // Baseline score: 2 blockers (30) + 1 critical (8) = 38 penalty -> Score 62.0
      // Comparison score: 1 blocker (15) + 1 major (3) = 18 penalty -> Score 82.0
      // Score delta: 82.0 - 62.0 = +20.0
      expect(drift.baseline?.cleanCoreIndex).toBe(62);
      expect(drift.comparison?.cleanCoreIndex).toBe(82);
      expect(drift.driftSummary.scoreDelta).toBe(20);
    });
  });

  describe('computeCleanCoreIndex', () => {
    it('returns 100 for empty findings', () => {
      expect(computeCleanCoreIndex([])).toBe(100);
    });

    it('computes correct penalty formula (blockers*15 + criticals*8 + majors*3)', () => {
      const findings = [
        { severity: 'BLOCKER' },
        { severity: 'CRITICAL' },
        { severity: 'MAJOR' },
        { severity: 'MINOR' }, // Minor has 0 penalty in index
      ];
      // penalty = 15 + 8 + 3 = 26 => score = 74
      expect(computeCleanCoreIndex(findings)).toBe(74);
    });

    it('caps maximum penalty at 100 (never negative)', () => {
      const findings = [
        { severity: 'BLOCKER' },
        { severity: 'BLOCKER' },
        { severity: 'BLOCKER' },
        { severity: 'BLOCKER' },
        { severity: 'BLOCKER' },
        { severity: 'BLOCKER' },
        { severity: 'BLOCKER' }, // 7 * 15 = 105 penalty
      ];
      expect(computeCleanCoreIndex(findings)).toBe(0);
    });
  });
});

