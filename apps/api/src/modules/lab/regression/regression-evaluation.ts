import type { RegressionExpectedOutcome, RegressionRunStatus } from '@erppreflight/schemas';

/** Compact, persisted view of one finding returned by a regression run. */
export interface RunFindingSummary {
  ruleId: string;
  severity: string;
  title: string;
  affectedObjects: string[];
  evidence: { artifactPath: string | null; lineNumber: number | null; sha256: string | null } | null;
}

export function summarizeFindings(findings: Array<Record<string, any>>): RunFindingSummary[] {
  return findings
    .map((f) => {
      const ev = Array.isArray(f.evidence) && f.evidence.length > 0 ? f.evidence[0] : null;
      return {
        ruleId: String(f.ruleId ?? ''),
        severity: String(f.severity ?? ''),
        title: String(f.title ?? ''),
        affectedObjects: (Array.isArray(f.affectedObjects) ? f.affectedObjects : [])
          .map((o: any) => (typeof o === 'string' ? o : String(o?.name ?? '')))
          .filter(Boolean)
          .sort(),
        evidence: ev
          ? { artifactPath: ev.artifactPath ?? null, lineNumber: ev.lineNumber ?? null, sha256: ev.sha256 ?? null }
          : null,
      };
    })
    .sort((a, b) => (a.ruleId + a.affectedObjects.join(',')).localeCompare(b.ruleId + b.affectedObjects.join(',')));
}

/**
 * The test's target finding is "present" when a returned finding carries the same
 * rule code and covers every affected object recorded on the source finding.
 */
export function evaluateRegressionRun(
  test: { ruleId: string; matchObjects: string[]; expectedOutcome: RegressionExpectedOutcome },
  findings: RunFindingSummary[]
): { findingPresent: boolean; matched: RunFindingSummary[]; status: Exclude<RegressionRunStatus, 'ERROR'> } {
  const matched = findings.filter(
    (f) => f.ruleId === test.ruleId && test.matchObjects.every((o) => f.affectedObjects.includes(o))
  );
  const findingPresent = matched.length > 0;
  const passed = test.expectedOutcome === 'FINDING_PRESENT' ? findingPresent : !findingPresent;
  return { findingPresent, matched, status: passed ? 'PASSED' : 'FAILED' };
}

export interface BaselineComparison {
  baselineRunId: string;
  baselineStatus: string;
  statusChanged: boolean;
  findingPresentChanged: boolean;
  newRuleIds: string[];
  disappearedRuleIds: string[];
  verdict: 'UNCHANGED' | 'IMPROVED' | 'REGRESSED' | 'CHANGED';
}

/** Compares a run with the test's baseline run (same fixture version). */
export function compareWithBaseline(
  baseline: { id: string; status: string; findingPresent: boolean | null; findings: RunFindingSummary[] },
  current: { status: string; findingPresent: boolean | null; findings: RunFindingSummary[] }
): BaselineComparison {
  const before = new Set(baseline.findings.map((f) => f.ruleId));
  const after = new Set(current.findings.map((f) => f.ruleId));
  const newRuleIds = [...after].filter((r) => !before.has(r)).sort();
  const disappearedRuleIds = [...before].filter((r) => !after.has(r)).sort();
  const statusChanged = baseline.status !== current.status;
  let verdict: BaselineComparison['verdict'] = 'UNCHANGED';
  if (statusChanged) {
    verdict = current.status === 'PASSED' ? 'IMPROVED' : baseline.status === 'PASSED' ? 'REGRESSED' : 'CHANGED';
  } else if (newRuleIds.length > 0 || disappearedRuleIds.length > 0) {
    verdict = 'CHANGED';
  }
  return {
    baselineRunId: baseline.id,
    baselineStatus: baseline.status,
    statusChanged,
    findingPresentChanged: baseline.findingPresent !== current.findingPresent,
    newRuleIds,
    disappearedRuleIds,
    verdict,
  };
}
