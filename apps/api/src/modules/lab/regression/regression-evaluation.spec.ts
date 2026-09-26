import { describe, it, expect } from 'vitest';
import { compareWithBaseline, evaluateRegressionRun, summarizeFindings } from './regression-evaluation';

const findings = summarizeFindings([
  {
    ruleId: 'OPD_DETERMINATION_STEP_MISSING',
    severity: 'MAJOR',
    title: 'Channel Determination Failed',
    affectedObjects: ['OPD_STEP_CHANNEL'],
    evidence: [{ artifactPath: 'opd#Channel', lineNumber: 23, sha256: 'x' }],
  },
  { ruleId: 'OTHER', severity: 'INFO', title: 'o', affectedObjects: [{ name: 'Z' }], evidence: [] },
]);

describe('regression run evaluation', () => {
  it('matches by rule and all recorded affected objects', () => {
    const r = evaluateRegressionRun(
      { ruleId: 'OPD_DETERMINATION_STEP_MISSING', matchObjects: ['OPD_STEP_CHANNEL'], expectedOutcome: 'FINDING_ABSENT' },
      findings
    );
    expect(r).toMatchObject({ findingPresent: true, status: 'FAILED' });
    expect(r.matched[0].evidence?.lineNumber).toBe(23);
  });

  it('passes FINDING_ABSENT when the rule no longer fires for the object', () => {
    expect(
      evaluateRegressionRun({ ruleId: 'OPD_DETERMINATION_STEP_MISSING', matchObjects: ['OTHER_STEP'], expectedOutcome: 'FINDING_ABSENT' }, findings)
        .status
    ).toBe('PASSED');
    expect(evaluateRegressionRun({ ruleId: 'R', matchObjects: [], expectedOutcome: 'FINDING_PRESENT' }, []).status).toBe('FAILED');
  });

  it('compares with the baseline run', () => {
    const baseline = { id: 'b', status: 'FAILED', findingPresent: true, findings };
    expect(compareWithBaseline(baseline, { status: 'FAILED', findingPresent: true, findings }).verdict).toBe('UNCHANGED');
    const improved = compareWithBaseline(baseline, { status: 'PASSED', findingPresent: false, findings: findings.slice(1) });
    expect(improved).toMatchObject({ verdict: 'IMPROVED', disappearedRuleIds: ['OPD_DETERMINATION_STEP_MISSING'], findingPresentChanged: true });
    expect(compareWithBaseline({ ...baseline, status: 'PASSED' }, { status: 'FAILED', findingPresent: true, findings }).verdict).toBe('REGRESSED');
  });
});
