import * as crypto from 'node:crypto';

/**
 * Webhook signature scheme (C §48). Every delivery carries:
 *   X-Hub-Signature-256: sha256=<hex HMAC-SHA256(secret, rawBody)>        (GitHub-compatible)
 *   X-ERPPreflight-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 * Receivers should verify v1 and reject timestamps older than 5 minutes (replay
 * protection), and de-duplicate on X-ERPPreflight-Event-Id (idempotency).
 */

export function hubSignature(secret: string, body: string): string {
  return `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
}

export function timestampedSignature(secret: string, body: string, timestampSec: number): string {
  const v1 = crypto.createHmac('sha256', secret).update(`${timestampSec}.${body}`).digest('hex');
  return `t=${timestampSec},v1=${v1}`;
}

/** Reference verifier (also used by tests and documented for receivers). */
export function verifyTimestampedSignature(
  secret: string,
  body: string,
  header: string,
  nowSec = Math.floor(Date.now() / 1000),
  toleranceSec = 300
): boolean {
  const parts = Object.fromEntries(
    String(header)
      .split(',')
      .map((p) => p.trim().split('=') as [string, string])
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(parts.v1, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Retry schedule after failed attempt n (1-based): 30s, 2m, 10m, 30m, 2h. */
export function retryDelayMs(attempt: number): number {
  const schedule = [30_000, 120_000, 600_000, 1_800_000, 7_200_000];
  return schedule[Math.min(Math.max(attempt, 1), schedule.length) - 1];
}

export const WEBHOOK_EVENT_CATALOG = [
  { type: 'analysis.completed', description: 'An analysis finished (status COMPLETED or PARTIAL).', payload: ['analysisId', 'projectId', 'status', 'totalFindings', 'engineOutcomes'] },
  { type: 'analysis.failed', description: 'An analysis failed or could not be executed.', payload: ['analysisId', 'projectId', 'status|error'] },
  { type: 'finding.critical', description: 'An analysis produced BLOCKER or CRITICAL findings.', payload: ['analysisId', 'projectId', 'criticalFindings', 'bySeverity'] },
  { type: 'finding.reviewed', description: 'A finding was reviewed (verified, risk accepted, suppressed).', payload: ['findingId', 'status', 'suppressScope'] },
  { type: 'connector.unhealthy', description: 'A connector became UNHEALTHY (circuit opened after repeated failures).', payload: ['connectorId', 'type', 'name', 'error'] },
  { type: 'traceability.task_dispatched', description: 'A work item was created from a finding in an external system.', payload: ['findingId', 'projectId', 'connectorId', 'externalSystem', 'externalId', 'url'] },
  { type: 'change_set.created', description: 'A change set was created.', payload: ['changeSetId'] },
  { type: 'change_set.simulated', description: 'A what-if simulation finished for a change set.', payload: ['changeSetId'] },
  { type: 'change_set.approved', description: 'A change set was approved.', payload: ['changeSetId'] },
  { type: 'agent.proposal_verdict', description: 'The agent change gate produced a verdict.', payload: ['proposalId', 'verdict'] },
  { type: 'agent.proposal_approved', description: 'An agent proposal was approved by a human.', payload: ['proposalId'] },
  { type: 'agent.proposal_executed', description: 'An approved agent proposal was executed.', payload: ['proposalId'] },
  { type: 'organization.plan_upgraded', description: 'The organization plan changed.', payload: ['plan'] },
] as const;

export const WEBHOOK_EVENT_TYPES = new Set<string>(WEBHOOK_EVENT_CATALOG.map((e) => e.type));
