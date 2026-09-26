import { describe, it, expect } from 'vitest';
import {
  TransitionFindingStatusSchema,
  isTransitionAllowed,
  rolesForStatus,
} from '@erppreflight/schemas';
import {
  evaluateCarryOver,
  lifecycleBaseKey,
  lifecycleKey,
  objectStateHash,
  LifecycleSnapshot,
} from './lifecycle-keys';

const base: LifecycleSnapshot = {
  status: 'OPEN',
  suppressionMode: null,
  suppressedUntil: null,
  suppressedRelease: null,
  suppressedObjectHash: null,
  lastObjectHash: 'a'.repeat(64),
  lastTargetRelease: 'S4H_2023',
};
const now = new Date('2026-09-26T00:00:00Z');
const detect = (over: Partial<{ now: Date; targetRelease: string; objectHash: string }> = {}) => ({
  now,
  targetRelease: 'S4H_2023',
  objectHash: 'a'.repeat(64),
  ...over,
});

describe('lifecycle keys', () => {
  it('are independent of line numbers / evidence content but depend on rule, objects and artifact', () => {
    const k1 = lifecycleBaseKey('OPD_GUARD', 'R1', [{ name: 'B' }, { name: 'A' }], 'x.xml');
    const k2 = lifecycleBaseKey('OPD_GUARD', 'R1', ['A', 'B'], 'x.xml');
    expect(k1).toBe(k2);
    expect(lifecycleBaseKey('OPD_GUARD', 'R2', ['A', 'B'], 'x.xml')).not.toBe(k1);
    expect(lifecycleBaseKey('OPD_GUARD', 'R1', ['A', 'B'], 'y.xml')).not.toBe(k1);
    expect(lifecycleKey(k1, 0)).toBe(k1);
    expect(lifecycleKey(k1, 1)).not.toBe(k1);
  });

  it('object state hash changes with the evidence content but not its order', () => {
    const e1 = { sha256: '1', snippet: 'a' };
    const e2 = { sha256: '2', snippet: 'b' };
    expect(objectStateHash({ evidence: [e1, e2], affectedObjects: ['X'] })).toBe(
      objectStateHash({ evidence: [e2, e1], affectedObjects: ['X'] })
    );
    expect(objectStateHash({ evidence: [e1], affectedObjects: ['X'] })).not.toBe(
      objectStateHash({ evidence: [{ sha256: '1', snippet: 'changed' }], affectedObjects: ['X'] })
    );
  });
});

describe('carry-over evaluation (Part 04 §4.11)', () => {
  it('keeps open-like statuses and permanent suppression', () => {
    expect(evaluateCarryOver(base, detect()).action).toBe('KEEP');
    expect(evaluateCarryOver({ ...base, status: 'SUPPRESSED', suppressionMode: 'PERMANENT' }, detect({ objectHash: 'b'.repeat(64) })).action).toBe('KEEP');
  });

  it('re-opens a resolved finding that re-appears (regression)', () => {
    const d = evaluateCarryOver({ ...base, status: 'RESOLVED' }, detect());
    expect(d).toMatchObject({ action: 'REOPEN', event: 'REOPENED' });
  });

  it('lapses an expired date suppression only after the end date', () => {
    const lc = { ...base, status: 'SUPPRESSED' as const, suppressionMode: 'UNTIL_DATE' as const, suppressedUntil: new Date('2026-10-01T23:59:59Z') };
    expect(evaluateCarryOver(lc, detect()).action).toBe('KEEP');
    expect(evaluateCarryOver(lc, detect({ now: new Date('2026-10-02T00:00:00Z') }))).toMatchObject({ action: 'REOPEN', event: 'SUPPRESSION_LAPSED' });
  });

  it('lapses release and object scoped suppressions when they change', () => {
    const rel = { ...base, status: 'SUPPRESSED' as const, suppressionMode: 'UNTIL_RELEASE' as const, suppressedRelease: 'S4H_2023' };
    expect(evaluateCarryOver(rel, detect()).action).toBe('KEEP');
    expect(evaluateCarryOver(rel, detect({ targetRelease: 'S4HANA_CLOUD_2408' })).action).toBe('REOPEN');
    const obj = { ...base, status: 'SUPPRESSED' as const, suppressionMode: 'UNTIL_OBJECT_CHANGE' as const, suppressedObjectHash: 'a'.repeat(64) };
    expect(evaluateCarryOver(obj, detect()).action).toBe('KEEP');
    expect(evaluateCarryOver(obj, detect({ objectHash: 'c'.repeat(64) })).action).toBe('REOPEN');
  });

  it('re-opens accepted risk when the object or the release changes, false positive when the object changes', () => {
    const ar = { ...base, status: 'ACCEPTED_RISK' as const };
    expect(evaluateCarryOver(ar, detect()).action).toBe('KEEP');
    expect(evaluateCarryOver(ar, detect({ objectHash: 'd'.repeat(64) }))).toMatchObject({ event: 'DECISION_LAPSED' });
    expect(evaluateCarryOver(ar, detect({ targetRelease: 'S4H_2022' }))).toMatchObject({ event: 'DECISION_LAPSED' });
    const fp = { ...base, status: 'FALSE_POSITIVE' as const };
    expect(evaluateCarryOver(fp, detect({ targetRelease: 'S4H_2022' })).action).toBe('KEEP');
    expect(evaluateCarryOver(fp, detect({ objectHash: 'd'.repeat(64) })).action).toBe('REOPEN');
  });
});

describe('state machine contract', () => {
  it('allows only declared transitions', () => {
    expect(isTransitionAllowed('OPEN', 'ACKNOWLEDGED')).toBe(true);
    expect(isTransitionAllowed('ACCEPTED_RISK', 'ACKNOWLEDGED')).toBe(false);
    expect(isTransitionAllowed('RESOLVED', 'OPEN')).toBe(true);
    expect(isTransitionAllowed('OPEN', 'REGRESSION_TEST_CREATED')).toBe(false);
  });

  it('restricts risk decisions to governance roles', () => {
    expect(rolesForStatus('ACCEPTED_RISK')).not.toContain('MIGRATION_CONSULTANT');
    expect(rolesForStatus('SUPPRESSED')).toContain('SECURITY_ADMIN');
    expect(rolesForStatus('ACKNOWLEDGED')).toContain('MIGRATION_CONSULTANT');
    expect(rolesForStatus('ACKNOWLEDGED')).not.toContain('VIEWER');
  });

  it('requires reasons and a suppression scope', () => {
    expect(TransitionFindingStatusSchema.safeParse({ status: 'ACCEPTED_RISK' }).success).toBe(false);
    expect(TransitionFindingStatusSchema.safeParse({ status: 'ACCEPTED_RISK', reason: 'Mitigated manually until Q3' }).success).toBe(true);
    expect(TransitionFindingStatusSchema.safeParse({ status: 'SUPPRESSED', reason: 'Tracked in CR-4711 now' }).success).toBe(false);
    expect(
      TransitionFindingStatusSchema.safeParse({ status: 'SUPPRESSED', reason: 'Tracked in CR-4711 now', suppression: { mode: 'UNTIL_DATE' } }).success
    ).toBe(false);
    expect(TransitionFindingStatusSchema.safeParse({ status: 'REGRESSION_TEST_CREATED' }).success).toBe(false);
    expect(TransitionFindingStatusSchema.safeParse({ status: 'ACKNOWLEDGED', extra: 1 }).success).toBe(false);
  });
});
