import * as crypto from 'node:crypto';
import type { FindingStatus, SuppressionMode } from '@erppreflight/schemas';

/**
 * Pure, deterministic helpers of the finding lifecycle (no I/O, no clock reads).
 *
 * lifecycle key  = identity of "the same finding" across analyses of a project:
 *                  engine + rule + affected objects + logical artifact name (+ ordinal
 *                  when a rule fires several times for the same identity). It is
 *                  deliberately independent of line numbers and content hashes so a
 *                  corrected or shifted artifact still maps to the same lifecycle.
 * object state   = content-sensitive hash of the evidence (hash + snippet) and the
 *                  affected objects. It changes when the flagged object changes and
 *                  drives the "until object changes" suppression (Part 04 §4.11).
 */

const SEP = '\u001f';

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

export function affectedObjectNames(affected: unknown): string[] {
  if (!Array.isArray(affected)) return [];
  return affected
    .map((o) => (typeof o === 'string' ? o : o && typeof o === 'object' ? String((o as any).name ?? '') : ''))
    .map((n) => n.trim())
    .filter(Boolean)
    .sort();
}

export function lifecycleBaseKey(engine: string, ruleId: string, affected: unknown, artifactName: string | null): string {
  return sha256(
    ['lifecycle/v1', engine.trim(), ruleId.trim(), affectedObjectNames(affected).join(','), (artifactName ?? '').trim()].join(SEP)
  );
}

export function lifecycleKey(baseKey: string, ordinal: number): string {
  return ordinal === 0 ? baseKey : sha256(`${baseKey}${SEP}${ordinal}`);
}

export function objectStateHash(finding: { evidence?: unknown; affectedObjects?: unknown }): string {
  const evidence = Array.isArray(finding.evidence) ? finding.evidence : [];
  const evidenceKeys = evidence
    .map((e: any) => `${e?.sha256 ?? ''}:${e?.snippet ?? ''}`)
    .sort();
  return sha256(['object-state/v1', evidenceKeys.join('\n'), affectedObjectNames(finding.affectedObjects).join(',')].join(SEP));
}

export interface LifecycleSnapshot {
  status: FindingStatus;
  suppressionMode: SuppressionMode | null;
  suppressedUntil: Date | null;
  suppressedRelease: string | null;
  suppressedObjectHash: string | null;
  lastObjectHash: string | null;
  lastTargetRelease: string | null;
}

export type CarryOverDecision =
  | { action: 'KEEP' }
  | { action: 'REOPEN'; event: 'REOPENED' | 'SUPPRESSION_LAPSED' | 'DECISION_LAPSED'; reason: string };

/**
 * Decides what happens to a lifecycle when a later analysis detects the finding again.
 * `now` is the analysis evaluation time (passed in, never read from the clock here).
 */
export function evaluateCarryOver(
  lc: LifecycleSnapshot,
  detection: { now: Date; targetRelease: string; objectHash: string }
): CarryOverDecision {
  const objectChanged = lc.lastObjectHash !== null && lc.lastObjectHash !== detection.objectHash;
  const releaseChanged = lc.lastTargetRelease !== null && lc.lastTargetRelease !== detection.targetRelease;

  switch (lc.status) {
    case 'RESOLVED':
      return { action: 'REOPEN', event: 'REOPENED', reason: 'Regression: the resolved finding was detected again.' };
    case 'SUPPRESSED': {
      switch (lc.suppressionMode) {
        case 'PERMANENT':
          return { action: 'KEEP' };
        case 'UNTIL_DATE':
          if (!lc.suppressedUntil || detection.now.getTime() > lc.suppressedUntil.getTime()) {
            return { action: 'REOPEN', event: 'SUPPRESSION_LAPSED', reason: 'Suppression expired (end date passed).' };
          }
          return { action: 'KEEP' };
        case 'UNTIL_RELEASE':
          if (lc.suppressedRelease !== detection.targetRelease) {
            return {
              action: 'REOPEN',
              event: 'SUPPRESSION_LAPSED',
              reason: `Suppression was limited to release ${lc.suppressedRelease}; evaluated against ${detection.targetRelease}.`,
            };
          }
          return { action: 'KEEP' };
        case 'UNTIL_OBJECT_CHANGE':
          if (lc.suppressedObjectHash !== detection.objectHash) {
            return { action: 'REOPEN', event: 'SUPPRESSION_LAPSED', reason: 'Suppression lapsed: the affected object changed.' };
          }
          return { action: 'KEEP' };
        default:
          return { action: 'REOPEN', event: 'SUPPRESSION_LAPSED', reason: 'Suppression without a valid scope.' };
      }
    }
    case 'ACCEPTED_RISK':
      if (objectChanged) {
        return { action: 'REOPEN', event: 'DECISION_LAPSED', reason: 'Accepted risk re-opened: the affected object changed.' };
      }
      if (releaseChanged) {
        return {
          action: 'REOPEN',
          event: 'DECISION_LAPSED',
          reason: `Accepted risk re-opened: target release changed from ${lc.lastTargetRelease} to ${detection.targetRelease}.`,
        };
      }
      return { action: 'KEEP' };
    case 'FALSE_POSITIVE':
      if (objectChanged) {
        return { action: 'REOPEN', event: 'DECISION_LAPSED', reason: 'False-positive verdict re-opened: the affected object changed.' };
      }
      return { action: 'KEEP' };
    default:
      return { action: 'KEEP' };
  }
}

/** Statuses a clean re-evaluation may auto-resolve (decisions like accepted risk are kept). */
export const AUTO_RESOLVABLE_STATUSES: readonly FindingStatus[] = ['OPEN', 'ACKNOWLEDGED', 'REGRESSION_TEST_CREATED'];
