import { describe, it, expect } from 'vitest';
import { classifyProblem, type ClassifierArtifact } from '../src/modules/router/problem-classifier';
import { detectArtifactSignals } from '../src/modules/jobs/orchestration/artifact-signals';
import { ROUTER_RULESET_VERSION, normalizeProblemText } from '../src/modules/router/router-rules';

const engines = (text: string, extra: Parameters<typeof classifyProblem>[0] = { text }) =>
  classifyProblem({ ...extra, text });
const primary = (text: string) => engines(text).suggestions.filter((s) => s.role === 'PRIMARY').map((s) => s.engine);
const all = (text: string) => engines(text).suggestions.map((s) => s.engine);

function artifact(fileName: string, text: string, contractAccepted: any = null): ClassifierArtifact {
  const artifactType = fileName.endsWith('.xdp') ? 'XDP' : fileName.endsWith('.json') ? 'JSON' : fileName.endsWith('.abap') ? 'ABAP' : 'XML';
  return {
    fileId: `f-${fileName}`,
    fileName,
    contractAccepted,
    signals: detectArtifactSignals({ fileId: `f-${fileName}`, fileName, artifactType: artifactType as any, text }),
  };
}

describe('Problem Router — spec examples (Part 01 §1.4)', () => {
  it('routes "supplier email not sent" to OPD Guard as primary and does NOT add FormDoctor without form evidence', () => {
    const res = engines('Purchase order is created but supplier email is not sent.');
    expect(res.suggestions[0].engine).toBe('OPD_GUARD');
    expect(res.suggestions[0].role).toBe('PRIMARY');
    expect(res.suggestions.map((s) => s.engine)).not.toContain('FORM_DOCTOR');
  });

  it('adds FormDoctor as SECONDARY only when a form artifact indicates it', () => {
    const xdp = artifact('po_form.xdp', '<?xml version="1.0"?><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template/></xdp:xdp>');
    const res = classifyProblem({ text: 'Purchase order is created but supplier email is not sent.', artifacts: [xdp] });
    expect(res.suggestions[0].engine).toBe('OPD_GUARD');
    const form = res.suggestions.find((s) => s.engine === 'FORM_DOCTOR');
    expect(form?.role).toBe('SECONDARY');
    expect(form?.why.some((w) => w.kind === 'ARTIFACT')).toBe(true);
    expect(form?.matchingFileIds).toEqual(['f-po_form.xdp']);
  });

  it('routes "supplier VAT number in PO PDF" to FormDoctor + Custom Field Flow Doctor (conditional)', () => {
    const res = engines('I need supplier VAT number in purchase order PDF.');
    expect(res.suggestions[0].engine).toBe('FORM_DOCTOR');
    expect(res.suggestions[0].role).toBe('PRIMARY');
    const cffd = res.suggestions.find((s) => s.engine === 'CUSTOM_FIELD_FLOW_DOCTOR');
    expect(cffd).toBeDefined();
    expect(cffd?.role).toBe('SECONDARY');
    expect(cffd?.condition).toMatch(/not part of the standard form data/);
  });

  it('routes the ECC EHP8 → S/4HANA Cloud Public Edition migration to ECC2Cloud, SPRO2Cloud, Gap Radar and Clean Core', () => {
    const res = engines('We are moving ECC EHP8 FI/MM/SD to S/4HANA Cloud Public Edition.');
    const p = res.suggestions.filter((s) => s.role === 'PRIMARY').map((s) => s.engine).sort();
    expect(p).toEqual(['CLEAN_CORE_OBJECT_GUARD', 'ECC2CLOUD_NAVIGATOR', 'SAP_GAP_RADAR', 'SPRO2CLOUD']);
  });
});

describe('Problem Router — routing table (EN + DE)', () => {
  const cases: Array<[string, string]> = [
    ['Bestellung wird angelegt, aber die E-Mail an den Lieferanten wird nicht versendet.', 'OPD_GUARD'],
    ['Die Rechnung wird nicht gedruckt.', 'OPD_GUARD'],
    ['Billing document output is not triggered, the BRFplus decision table looks wrong.', 'OPD_GUARD'],
    ['Ich brauche die USt-IdNr. des Lieferanten im Bestellformular (PDF).', 'FORM_DOCTOR'],
    ['Adobe form field is empty in the invoice PDF.', 'FORM_DOCTOR'],
    ['We migrate our Smart Forms to Adobe Forms.', 'FORM_DOCTOR'],
    ['Wir migrieren von ECC 6.0 auf S/4HANA Cloud Public Edition.', 'ECC2CLOUD_NAVIGATOR'],
    ['Which transactions used in ECC do not exist in S/4HANA?', 'ECC2CLOUD_NAVIGATOR'],
    ['Which SPRO settings have no equivalent in the cloud?', 'SPRO2CLOUD'],
    ['Customizing aus dem IMG in die Cloud übertragen.', 'SPRO2CLOUD'],
    ['We need a fit-to-standard gap analysis for our requirements.', 'SAP_GAP_RADAR'],
    ['Is our custom ABAP code clean core compliant?', 'CLEAN_CORE_OBJECT_GUARD'],
    ['Das Z-Programm liest direkt aus der Tabelle MARA – ist das Clean Core konform?', 'CLEAN_CORE_OBJECT_GUARD'],
    ['Custom field YY1_PROJECT_CODE is not shown in the supplier invoice.', 'CUSTOM_FIELD_FLOW_DOCTOR'],
    ['Das Kundenfeld wird in den Folgebeleg nicht übernommen.', 'CUSTOM_FIELD_FLOW_DOCTOR'],
    ['If we delete the extension YY1_PROJECT_CODE, what breaks?', 'EXTENSION_IMPACT_GUARD'],
    ['Which OData APIs break after the upgrade to 2408?', 'API_CHANGE_GUARD'],
    ['Die API wird im Release 2408 als veraltet markiert und entfernt.', 'API_CHANGE_GUARD'],
    ['Material master changes are not replicated via IDoc MATMAS.', 'CHANGE_POINTER_COVERAGE_AUDITOR'],
    ['Änderungszeiger für DEBMAS werden nicht geschrieben.', 'CHANGE_POINTER_COVERAGE_AUDITOR'],
    ['The transport import fails because objects are missing from an earlier transport.', 'TRANSPORT_DEPENDENCY_ANALYZER'],
    ['Bitte die Transportreihenfolge der Transportaufträge prüfen.', 'TRANSPORT_DEPENDENCY_ANALYZER'],
    ['Software collection export fails because dependent items are missing.', 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD'],
    ['Can we delete the user BATCH_ADMIN safely?', 'SAFE_DECOMMISSION_PREFLIGHT'],
    ['Wir wollen den technischen Benutzer RFC_ARIBA stilllegen.', 'SAFE_DECOMMISSION_PREFLIGHT'],
    ['Fiori app shows 403 Forbidden for the purchaser.', 'FIORI_403_ROOT_CAUSE_DOCTOR'],
    ['Die Fiori-App liefert 403, die Berechtigung fehlt.', 'FIORI_403_ROOT_CAUSE_DOCTOR'],
    ['The approval workflow is stuck in status READY, no agent found.', 'WORKFLOW_STUCK_EXPLAINER'],
    ['Das Workitem hängt, es wird kein Bearbeiter gefunden.', 'WORKFLOW_STUCK_EXPLAINER'],
    ['We pay too much for Fiori licenses; which roles can be downgraded?', 'IAM_COST_OPTIMIZER'],
    ['GR/IR postings go to the wrong G/L account (OBYC WRX).', 'ACCOUNT_DETERMINATION_PREFLIGHT'],
    ['Die Kontenfindung für Umsatzerlöse (VKOA) fehlt.', 'ACCOUNT_DETERMINATION_PREFLIGHT'],
    ['After the system copy the RFC destinations still point to production.', 'SYSTEM_REFRESH_DELTA_GUARD'],
    ['Nach dem Systemrefresh zeigen RFC-Destinationen auf PRD.', 'SYSTEM_REFRESH_DELTA_GUARD'],
    ['Conveyor telegrams from the PLC are lost and handling units get stuck.', 'MFS_BLACKBOX'],
    ['In der Fördertechnik gehen MFS-Telegramme verloren.', 'MFS_BLACKBOX'],
  ];

  it.each(cases)('"%s" → %s (primary)', (text, expected) => {
    expect(primary(text)).toContain(expected);
  });

  it('has at least 30 routing cases including German phrasing', () => {
    expect(cases.length + 4).toBeGreaterThanOrEqual(30);
    expect(cases.filter(([t]) => /[äöüß]|\b(wird|nicht|der|die|das)\b/i.test(t)).length).toBeGreaterThanOrEqual(12);
  });
});

describe('Problem Router — signals, determinism and guarantees', () => {
  it('uses an object identifier (transport number) when the text is generic', () => {
    const res = classifyProblem({ text: 'Please check this object', objectIdentifier: 'devk900101' });
    expect(res.suggestions[0].engine).toBe('TRANSPORT_DEPENDENCY_ANALYZER');
    expect(res.suggestions[0].why[0].kind).toBe('OBJECT');
  });

  it('uses artifact content signals alone (decision table upload → OPD Guard primary)', () => {
    const opd = artifact('opd.json', JSON.stringify({ tables: { Channel: [{ RESULT: 'EMAIL' }] } }), ['OPD_GUARD']);
    const res = classifyProblem({ text: 'Please have a look', artifacts: [opd] });
    expect(res.suggestions[0]).toMatchObject({ engine: 'OPD_GUARD', role: 'PRIMARY' });
  });

  it('ignores an artifact signal the engine contract rejected', () => {
    const opd = artifact('opd.json', JSON.stringify({ tables: { Channel: [] , X: [1]} }), []);
    const res = classifyProblem({ text: 'Please have a look', artifacts: [opd] });
    expect(res.unmatched).toBe(true);
  });

  it('project context strengthens but never creates a route', () => {
    const ctx = { sourceErp: 'SAP_ECC', targetProduct: 'S4HANA_CLOUD_PUBLIC', deploymentType: 'PUBLIC_CLOUD', modules: ['MM'] };
    expect(classifyProblem({ text: 'hello world', context: ctx }).unmatched).toBe(true);
    const withCtx = classifyProblem({ text: 'Is our custom ABAP code clean core compliant?', context: ctx });
    const without = classifyProblem({ text: 'Is our custom ABAP code clean core compliant?' });
    expect(withCtx.suggestions[0].score).toBeGreaterThan(without.suggestions[0].score);
    expect(withCtx.suggestions[0].why.some((w) => w.kind === 'CONTEXT')).toBe(true);
  });

  it('returns unmatched for unrelated text', () => {
    expect(engines('What is the weather like today?').unmatched).toBe(true);
  });

  it('is deterministic and versioned', () => {
    const a = engines('We are moving ECC EHP8 FI/MM/SD to S/4HANA Cloud Public Edition.');
    const b = engines('We are moving ECC EHP8 FI/MM/SD to S/4HANA Cloud Public Edition.');
    expect(a).toEqual(b);
    expect(a.version).toBe(ROUTER_RULESET_VERSION);
  });

  it('caps confidence at RULE_DERIVED 0.85', () => {
    const res = engines('OPD BRFplus output determination: the invoice e-mail is not sent to the recipient, output type channel wrong');
    for (const s of res.suggestions) {
      expect(s.confidenceClass).toBe('RULE_DERIVED');
      expect(s.confidence).toBeLessThanOrEqual(0.85);
    }
  });

  it('normalises umlauts and case', () => {
    expect(normalizeProblemText('Änderungszeiger GRÖßE Übersicht')).toBe('aenderungszeiger groesse uebersicht');
  });

  it('never proposes more than six engines', () => {
    const res = engines(
      'OPD output not sent, adobe form field empty, custom field YY1_X, transport order, 403 forbidden, workflow stuck, MFS telegram, OBYC, system copy RFC production, software collection'
    );
    expect(res.suggestions.length).toBeLessThanOrEqual(6);
  });
});
