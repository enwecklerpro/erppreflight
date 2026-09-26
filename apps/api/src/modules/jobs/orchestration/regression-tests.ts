/**
 * Deterministic regression test generation (Part 01 §1.6 "… → suggested action →
 * generated test", §1.7 "regression test created"; Part 03 §3.8 stage
 * "Generating tests").
 *
 * A test is generated only for a finding that is actionable and evidence-backed:
 * severity BLOCKER/CRITICAL/MAJOR, confidence VERIFIED or RULE_DERIVED, not an
 * input-validation diagnostic, and at least one evidence item with a SHA-256 and a
 * line. The test re-checks exactly that evidence location; it never invents steps
 * beyond the finding's own remediation text.
 */
export const REGRESSION_TEST_VERSION = 'regtest-2026.09.1';
export const MAX_TESTS_PER_ANALYSIS = 200;

export interface TestSourceFinding {
  id: string;
  engine: string;
  ruleId: string;
  severity: string;
  category: string | null;
  title: string;
  confidenceClass: string | null;
  remediation: string | null;
  affectedObjects: string[];
  fingerprint: string | null;
  evidence: Array<{ artifactPath: string | null; lineNumber: number | null; sha256: string | null }>;
}

export interface GeneratedTest {
  findingId: string;
  title: string;
  testType: 'REGRESSION';
  steps: Array<{ order: number; action: string }>;
  expectedResult: string;
}

const ELIGIBLE_SEVERITIES = new Set(['BLOCKER', 'CRITICAL', 'MAJOR']);
const ELIGIBLE_CONFIDENCE = new Set(['VERIFIED', 'RULE_DERIVED']);

function firstSentence(text: string | null): string | null {
  if (!text) return null;
  const s = text.trim().split(/(?<=[.!?])\s+/)[0] ?? '';
  return s.length > 400 ? `${s.slice(0, 397)}...` : s || null;
}

export function isTestEligible(f: TestSourceFinding): boolean {
  if (!ELIGIBLE_SEVERITIES.has(f.severity)) return false;
  if (!ELIGIBLE_CONFIDENCE.has(f.confidenceClass ?? '')) return false;
  if ((f.category ?? '').toUpperCase() === 'INPUT_VALIDATION') return false;
  return f.evidence.some((e) => e.artifactPath && e.sha256 && typeof e.lineNumber === 'number' && e.lineNumber > 0);
}

export function buildRegressionTests(findings: TestSourceFinding[], targetRelease: string): GeneratedTest[] {
  const eligible = findings
    .filter(isTestEligible)
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, MAX_TESTS_PER_ANALYSIS);
  return eligible.map((f) => {
    const ev = f.evidence
      .filter((e) => e.artifactPath && e.sha256 && typeof e.lineNumber === 'number')
      .sort((a, b) => String(a.artifactPath).localeCompare(String(b.artifactPath)) || (a.lineNumber ?? 0) - (b.lineNumber ?? 0))[0];
    const object = f.affectedObjects[0] ?? 'the affected object';
    const remediation = firstSentence(f.remediation);
    const steps: GeneratedTest['steps'] = [
      { order: 1, action: `Open ${ev.artifactPath} at line ${ev.lineNumber} (evidence SHA-256 ${String(ev.sha256).slice(0, 12)}…) and locate ${object}.` },
    ];
    if (remediation) steps.push({ order: 2, action: `Apply the remediation: ${remediation}` });
    steps.push({
      order: steps.length + 1,
      action: `Re-export the corrected artifact and re-run ${f.engine} for target release ${targetRelease}.`,
    });
    return {
      findingId: f.id,
      title: `Regression: ${f.ruleId} on ${object}`.slice(0, 480),
      testType: 'REGRESSION',
      steps,
      expectedResult: `${f.engine} no longer reports ${f.ruleId} for ${object}${f.fingerprint ? ` (fingerprint ${f.fingerprint.slice(0, 16)} absent from the new run)` : ''}.`,
    };
  });
}
