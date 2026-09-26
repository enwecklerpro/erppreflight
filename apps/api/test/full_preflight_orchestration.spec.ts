import { describe, it, expect, vi } from 'vitest';
import { detectArtifactSignals } from '../src/modules/jobs/orchestration/artifact-signals';
import { planFullPreflight, type PlannerArtifact } from '../src/modules/jobs/orchestration/preflight-planner';
import { buildEngineStages } from '../src/modules/jobs/orchestration/engine-profiles';
import { correlate, objectKeys, categoriesFor, type CorrelationFinding } from '../src/modules/jobs/orchestration/correlation';
import { buildRegressionTests, isTestEligible } from '../src/modules/jobs/orchestration/regression-tests';
import {
  AnalysisProgressTracker,
  applyTransition,
  computePercent,
  initialProgressState,
  parseProgressState,
} from '../src/modules/jobs/analysis-progress';

function art(fileId: string, fileName: string, artifactType: any, text: string | null, contractAccepted: any): PlannerArtifact {
  return { fileId, fileName, artifactType, contractAccepted, signals: detectArtifactSignals({ fileId, fileName, artifactType, text }) };
}

const OPD_JSON = JSON.stringify({ scenario: { DocumentType: 'NB' }, tables: { Channel: [{ RESULT: 'EMAIL' }] } });
const XDP = '<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template/></xdp:xdp>';
const DATA_XML = '<?xml version="1.0"?><Invoice><Header/></Invoice>';

describe('Artifact signals', () => {
  it('detects OPD decision tables, XDP templates, ABAP, CSV transport exports and generic XML', () => {
    expect(detectArtifactSignals({ fileId: '1', fileName: 'a.json', artifactType: 'JSON', text: OPD_JSON }).engines.OPD_GUARD).toMatch(/tables/);
    expect(detectArtifactSignals({ fileId: '2', fileName: 't.xdp', artifactType: 'XDP', text: XDP }).roles).toContain('XDP_TEMPLATE');
    expect(detectArtifactSignals({ fileId: '3', fileName: 'z.abap', artifactType: 'ABAP', text: 'REPORT z.' }).engines.CLEAN_CORE_OBJECT_GUARD).toBeDefined();
    expect(detectArtifactSignals({ fileId: '4', fileName: 'e071.csv', artifactType: 'CSV', text: 'TRKORR,PGMID,OBJECT\nDEVK900001,R3TR,CLAS' }).engines.TRANSPORT_DEPENDENCY_ANALYZER).toBeDefined();
    expect(detectArtifactSignals({ fileId: '5', fileName: 'inv.xml', artifactType: 'XML', text: DATA_XML }).roles).toContain('GENERIC_XML');
    expect(detectArtifactSignals({ fileId: '6', fileName: 'x.json', artifactType: 'JSON', text: '{not json' }).engines).toEqual({});
  });
});

describe('Full Project Preflight planner', () => {
  it('assigns by contract ∩ signal, pairs XDP + data XML and stages OPD before FormDoctor', () => {
    const plan = planFullPreflight([
      art('f1', 'opd_po.json', 'JSON', OPD_JSON, ['OPD_GUARD']),
      art('f2', 'invoice_template.xdp', 'XDP', XDP, ['OPD_GUARD', 'FORM_DOCTOR']),
      art('f3', 'invoice_payload.xml', 'XML', DATA_XML, ['OPD_GUARD', 'FORM_DOCTOR']),
      art('f4', 'legacy.abap', 'ABAP', 'REPORT zlegacy.', ['SAP_GAP_RADAR', 'CLEAN_CORE_OBJECT_GUARD']),
    ]);
    expect(plan.engines).toEqual(['OPD_GUARD', 'FORM_DOCTOR', 'CLEAN_CORE_OBJECT_GUARD']);
    const form = plan.assignments.find((a) => a.engine === 'FORM_DOCTOR');
    expect(form).toMatchObject({ fileId: 'f3', companions: [{ fileId: 'f2', configKey: 'xdp_content' }] });
    expect(plan.assignments.filter((a) => a.engine === 'OPD_GUARD').map((a) => a.fileId)).toEqual(['f1']);
    expect(plan.assignments.some((a) => a.engine === 'SAP_GAP_RADAR')).toBe(false);
    expect(plan.stages).toEqual([['OPD_GUARD', 'CLEAN_CORE_OBJECT_GUARD'], ['FORM_DOCTOR']]);
    expect(plan.unassigned).toEqual([]);
  });

  it('reports an XDP without data XML and ambiguous artifacts as unassigned instead of guessing', () => {
    const plan = planFullPreflight([
      art('f2', 'form.xdp', 'XDP', XDP, ['OPD_GUARD', 'FORM_DOCTOR']),
      art('f9', 'graph.json', 'JSON', JSON.stringify({ A: ['B'] }), ['EXTENSION_IMPACT_GUARD', 'TRANSPORT_DEPENDENCY_ANALYZER']),
      art('f8', 'random.json', 'JSON', JSON.stringify({ hello: 1 }), []),
    ]);
    expect(plan.assignments).toEqual([]);
    expect(plan.unassigned.map((u) => u.fileId).sort()).toEqual(['f2', 'f8', 'f9']);
    expect(plan.unassigned.find((u) => u.fileId === 'f2')?.reason).toMatch(/runtime data XML/);
  });

  it('assigns an artifact accepted by exactly one contract even without a specific signal', () => {
    const plan = planFullPreflight([art('f1', 'extension_graph.json', 'JSON', JSON.stringify({ YY1_X: ['CDS_A'] }), ['EXTENSION_IMPACT_GUARD'])]);
    expect(plan.assignments).toEqual([expect.objectContaining({ engine: 'EXTENSION_IMPACT_GUARD', fileId: 'f1' })]);
  });

  it('pairs API baseline and candidate specifications by file name', () => {
    const spec = JSON.stringify({ paths: { '/po': ['get'] } });
    const plan = planFullPreflight([
      art('b', 'api_baseline.json', 'JSON', spec, ['API_CHANGE_GUARD']),
      art('c', 'api_breaking.json', 'JSON', spec, ['API_CHANGE_GUARD']),
    ]);
    expect(plan.assignments).toEqual([
      expect.objectContaining({
        engine: 'API_CHANGE_GUARD',
        fileId: 'b',
        companions: [
          { fileId: 'b', configKey: 'baseline' },
          { fileId: 'c', configKey: 'candidate' },
        ],
      }),
    ]);
  });

  it('lists context-relevant engines without inputs as missing inputs and honours engine restriction', () => {
    const plan = planFullPreflight([art('f1', 'opd.json', 'JSON', OPD_JSON, ['OPD_GUARD'])], {
      sourceErp: 'SAP_ECC',
      targetProduct: 'S4HANA_CLOUD_PUBLIC',
    });
    expect(plan.missingInputs.map((m) => m.engine)).toEqual(['ECC2CLOUD_NAVIGATOR', 'SPRO2CLOUD', 'SAP_GAP_RADAR', 'CLEAN_CORE_OBJECT_GUARD']);
    const restricted = planFullPreflight([art('f1', 'opd.json', 'JSON', OPD_JSON, ['OPD_GUARD'])], {}, ['CLEAN_CORE_OBJECT_GUARD']);
    expect(restricted.assignments).toEqual([]);
  });

  it('is deterministic regardless of input order', () => {
    const a = [art('f1', 'a.json', 'JSON', OPD_JSON, ['OPD_GUARD']), art('f4', 'b.abap', 'ABAP', 'REPORT z.', ['CLEAN_CORE_OBJECT_GUARD'])];
    expect(planFullPreflight(a)).toEqual(planFullPreflight([...a].reverse()));
  });

  it('builds topological stages from the declared precedence', () => {
    expect(buildEngineStages(['CUSTOM_FIELD_FLOW_DOCTOR', 'FORM_DOCTOR', 'OPD_GUARD', 'MFS_BLACKBOX'])).toEqual([
      ['OPD_GUARD', 'MFS_BLACKBOX'],
      ['FORM_DOCTOR'],
      ['CUSTOM_FIELD_FLOW_DOCTOR'],
    ]);
  });
});

function finding(p: Partial<CorrelationFinding> & { id: string; engine: string; ruleId: string }): CorrelationFinding {
  return {
    severity: 'CRITICAL',
    category: 'X',
    title: p.ruleId,
    confidenceClass: 'VERIFIED',
    affectedObjects: [],
    fingerprint: null,
    artifactPaths: [],
    ...p,
  };
}

describe('Correlation pass', () => {
  it('groups FormDoctor + Custom Field Flow findings on the same field and picks the upstream root cause', () => {
    const s = correlate(
      [
        finding({ id: 'a', engine: 'CUSTOM_FIELD_FLOW_DOCTOR', ruleId: 'FIELD_PROPAGATION_BLOCKED', affectedObjects: ['YY1_SUPPLIER_VAT', 'MM_PURCHASE_ORDER'] }),
        finding({ id: 'b', engine: 'FORM_DOCTOR', ruleId: 'FORM_FIELD_MISSING_IN_XML', affectedObjects: ['YY1_SUPPLIER_VAT'], severity: 'MAJOR' }),
        finding({ id: 'c', engine: 'OPD_GUARD', ruleId: 'OPD_DETERMINATION_STEP_MISSING', affectedObjects: ['OPD_STEP_EMAIL_RECIPIENT'] }),
      ],
      []
    );
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0]).toMatchObject({ kind: 'FORM_DATA_PATH', rootCauseFindingId: 'b', sharedObjects: ['YY1_SUPPLIER_VAT'] });
    expect(s.groups[0].findingIds.sort()).toEqual(['a', 'b']);
  });

  it('builds an OUTPUT_CHAIN with OPD as root cause when OPD and FormDoctor name the same object', () => {
    const s = correlate(
      [
        finding({ id: 'x', engine: 'FORM_DOCTOR', ruleId: 'FORM_BINDING_PATH_MISMATCH', affectedObjects: ['MM_PURCHASE_ORDER_FORM'] }),
        finding({ id: 'y', engine: 'OPD_GUARD', ruleId: 'OPD_CHANNEL_INACTIVE', affectedObjects: ['MM_PURCHASE_ORDER_FORM'], severity: 'MAJOR' }),
      ],
      []
    );
    expect(s.groups[0]).toMatchObject({ kind: 'OUTPUT_CHAIN', rootCauseFindingId: 'y' });
  });

  it('does not correlate findings of one engine or without a shared object', () => {
    const s = correlate(
      [
        finding({ id: '1', engine: 'CLEAN_CORE_OBJECT_GUARD', ruleId: 'CLEAN_CORE_DIRECT_DB_ACCESS', affectedObjects: ['MARA'] }),
        finding({ id: '2', engine: 'CLEAN_CORE_OBJECT_GUARD', ruleId: 'CLEAN_CORE_OBSOLETE_SYNTAX', affectedObjects: ['MARA'] }),
        finding({ id: '3', engine: 'TRANSPORT_DEPENDENCY_ANALYZER', ruleId: 'TR_OBJECT_COLLISION', affectedObjects: ['CLAS ZCL_ORDER'] }),
      ],
      []
    );
    expect(s.groups).toEqual([]);
  });

  it('deduplicates by fingerprint and excludes input-validation diagnostics from the counts', () => {
    const s = correlate(
      [
        finding({ id: 'b2', engine: 'OPD_GUARD', ruleId: 'OPD_CHANNEL_INACTIVE', fingerprint: 'fp1' }),
        finding({ id: 'b1', engine: 'OPD_GUARD', ruleId: 'OPD_CHANNEL_INACTIVE', fingerprint: 'fp1' }),
        finding({ id: 'i', engine: 'FORM_DOCTOR', ruleId: 'FORM_INSUFFICIENT_INPUT', category: 'INPUT_VALIDATION', severity: 'INFO' }),
      ],
      [
        { engine: 'OPD_GUARD', fileId: 'f1', fileName: 'a', outcome: 'COMPLETED', findings: 2, rulesEvaluated: 5, durationMs: 3 },
        { engine: 'OPD_GUARD', fileId: 'f2', fileName: 'b', outcome: 'COMPLETED', findings: 0, rulesEvaluated: 5, durationMs: 3 },
        { engine: 'FORM_DOCTOR', fileId: 'f3', fileName: 'c', outcome: 'FAILED', findings: 0, rulesEvaluated: 0, durationMs: 3 },
      ]
    );
    expect(s.totals).toMatchObject({ findings: 3, uniqueFindings: 1, duplicates: 1, inputValidation: 1, checksPassed: 1, checksFailed: 1, rulesEvaluated: 10, artifactsAnalyzed: 3 });
    expect(s.duplicates).toEqual([{ fingerprint: 'fp1', keptFindingId: 'b1', duplicateFindingIds: ['b2'] }]);
    expect(s.categories.OUTPUT_PROBLEMS).toBe(1);
    expect(s.engines.find((e) => e.engine === 'FORM_DOCTOR')?.outcome).toBe('FAILED');
  });

  it('maps findings to summary categories (migration blockers, unsupported APIs, …)', () => {
    expect(categoriesFor(finding({ id: '1', engine: 'CLEAN_CORE_OBJECT_GUARD', ruleId: 'CLEAN_CORE_UNRELEASED_API' }))).toEqual(['MIGRATION_BLOCKERS', 'UNSUPPORTED_APIS']);
    expect(categoriesFor(finding({ id: '2', engine: 'OPD_GUARD', ruleId: 'OPD_CHANNEL_INACTIVE', severity: 'MAJOR' }))).toEqual(['OUTPUT_PROBLEMS']);
    expect(categoriesFor(finding({ id: '3', engine: 'MFS_BLACKBOX', ruleId: 'MFS_X', severity: 'BLOCKER' }))).toEqual(['MIGRATION_BLOCKERS', 'OPERATIONAL_RISKS']);
  });

  it('normalises object keys', () => {
    expect(objectKeys(['CLAS ZCL_ORDER_HANDLER', 'TABLES', 'mara', 'GLOBAL'])).toEqual(['MARA', 'ZCL_ORDER_HANDLER']);
  });
});

describe('Correlation via technical-detail evidence and XDP redaction safety', () => {
  it('links a FormDoctor missing data leaf with the Custom Field Flow finding on the same custom field', () => {
    const s = correlate(
      [
        finding({
          id: 'form',
          engine: 'FORM_DOCTOR',
          ruleId: 'FORM_FIELD_MISSING_IN_XML',
          affectedObjects: [],
          technicalDetails: { field: 'SupplierVat', dataRef: '$.PurchaseOrder.Header.YY1_SUPPLIER_VAT', missingLeaf: 'YY1_SUPPLIER_VAT' },
        }),
        finding({ id: 'cffd', engine: 'CUSTOM_FIELD_FLOW_DOCTOR', ruleId: 'FIELD_MISSING_TARGET_CONTEXT', affectedObjects: ['YY1_SUPPLIER_VAT', 'MM_PURCHASE_ORDER_FORM_OUTPUT'] }),
      ],
      []
    );
    expect(s.groups).toEqual([
      expect.objectContaining({ kind: 'FORM_DATA_PATH', rootCauseFindingId: 'form', sharedObjects: ['YY1_SUPPLIER_VAT'], engines: ['FORM_DOCTOR', 'CUSTOM_FIELD_FLOW_DOCTOR'] }),
    ]);
  });

  it('keeps Adobe Form data-binding paths intact during secret redaction', async () => {
    const { SecretRedactorService } = await import('../src/modules/redaction/secret-redactor.service');
    const svc = new SecretRedactorService({ get: () => '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' } as any);
    const xdp = '<bind match="dataRef" ref="$.PurchaseOrder.Header.YY1_SUPPLIER_VAT"/>\n<bind ref="$record.Items[*].NetPrice"/>';
    const r = svc.redact(xdp, '11111111-1111-4111-8111-111111111111');
    expect(r.sanitizedText).toBe(xdp);
    const secret = svc.redact('token = "aK9x2LmQ7pZr4TvW8yB3nC6d"', '11111111-1111-4111-8111-111111111111');
    expect(secret.redactionsCount).toBeGreaterThan(0);
  });
});

describe('Regression test generation', () => {
  const base = {
    id: 'f1',
    engine: 'OPD_GUARD',
    ruleId: 'OPD_DETERMINATION_STEP_MISSING',
    severity: 'CRITICAL',
    category: 'Output Determination',
    title: 't',
    confidenceClass: 'VERIFIED',
    remediation: 'Add a decision table row. Then re-run.',
    affectedObjects: ['OPD_STEP_EMAIL_RECIPIENT'],
    fingerprint: 'abcdef0123456789abcdef',
    evidence: [{ artifactPath: 'opd#Email Recipient', lineNumber: 2, sha256: 'a'.repeat(64) }],
  };
  it('creates an evidence-anchored test for an eligible finding', () => {
    const [t] = buildRegressionTests([base], 'S4H_2023');
    expect(t.title).toBe('Regression: OPD_DETERMINATION_STEP_MISSING on OPD_STEP_EMAIL_RECIPIENT');
    expect(t.steps[0].action).toContain('opd#Email Recipient at line 2');
    expect(t.steps[1].action).toBe('Apply the remediation: Add a decision table row.');
    expect(t.expectedResult).toContain('no longer reports OPD_DETERMINATION_STEP_MISSING');
  });
  it('skips inferred, low-severity, input-validation and evidence-less findings', () => {
    expect(isTestEligible({ ...base, confidenceClass: 'INFERRED' })).toBe(false);
    expect(isTestEligible({ ...base, severity: 'MINOR' })).toBe(false);
    expect(isTestEligible({ ...base, category: 'INPUT_VALIDATION' })).toBe(false);
    expect(isTestEligible({ ...base, evidence: [{ artifactPath: 'x', lineNumber: null, sha256: 'a' }] })).toBe(false);
  });
});

describe('Analysis progress state', () => {
  it('computes weighted percentages and running-stage fractions', () => {
    let s = initialProgressState();
    s = applyTransition(s, 'UPLOAD_VALIDATED', 'COMPLETED', {}, '2026-01-01T00:00:00Z');
    s = applyTransition(s, 'PARSING', 'COMPLETED', {}, '2026-01-01T00:00:01Z');
    s = applyTransition(s, 'RUNNING_RULES', 'PROGRESS', { done: 1, total: 2 }, '2026-01-01T00:00:02Z');
    expect(s.currentStage).toBe('RUNNING_RULES');
    expect(s.stages.RUNNING_RULES.state).toBe('RUNNING');
    expect(computePercent(s)).toBe(Math.round(5 + 10 + 55 / 2));
    s = applyTransition(s, 'GENERATING_TESTS', 'SKIPPED', { reason: 'none' }, '2026-01-01T00:00:03Z');
    expect(s.stages.GENERATING_TESTS.state).toBe('SKIPPED');
  });

  it('round-trips through the persisted JSON and tolerates garbage', () => {
    const s = applyTransition(initialProgressState(), 'PARSING', 'STARTED', { artifacts: 2 }, '2026-01-01T00:00:00Z');
    expect(parseProgressState(JSON.stringify(s)).stages.PARSING).toMatchObject({ state: 'RUNNING', detail: { artifacts: 2 } });
    expect(parseProgressState('not json').currentStage).toBeNull();
  });

  it('persists every transition as an event plus snapshot inside the tenant transaction and never throws', async () => {
    const calls: any[] = [];
    const db: any = {
      withTenantTransaction: vi.fn(async (_t: string, cb: any) => cb({ query: vi.fn(async (sql: string, params: any[]) => calls.push({ sql, params })) })),
    };
    const tracker = new AnalysisProgressTracker(db, 'org-1', 'ana-1');
    await tracker.complete('UPLOAD_VALIDATED', { files: 1 });
    expect(db.withTenantTransaction).toHaveBeenCalledWith('org-1', expect.any(Function));
    expect(calls[0].sql).toContain('INSERT INTO analysis_progress_events');
    expect(calls[0].params.slice(0, 4)).toEqual(['org-1', 'ana-1', 'UPLOAD_VALIDATED', 'COMPLETED']);
    expect(calls[1].sql).toContain('UPDATE analyses SET progress');
    const failing: any = { withTenantTransaction: vi.fn(async () => { throw new Error('db down'); }) };
    await expect(new AnalysisProgressTracker(failing, 'o', 'a').start('PARSING')).resolves.toBeUndefined();
  });
});
