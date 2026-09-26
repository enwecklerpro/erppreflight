/**
 * Pure mapping from domain events (transactional outbox) to notification
 * content. Deterministic and side-effect free so it can be unit tested.
 */
export type NotificationSeverity = 'BLOCKER' | 'CRITICAL' | 'MAJOR' | 'MEDIUM' | 'MINOR' | 'LOW' | 'INFO';

export const SEVERITY_ORDER: NotificationSeverity[] = ['INFO', 'LOW', 'MINOR', 'MEDIUM', 'MAJOR', 'CRITICAL', 'BLOCKER'];

export const NOTIFICATION_EVENT_TYPES = [
  'analysis.completed',
  'analysis.failed',
  'finding.critical',
  'release_watch.changed',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

/** Recipient policy per event type (avoid flooding, Part 14.33). */
export type RecipientPolicy = 'TRIGGERING_USER' | 'TRIGGERING_USER_AND_OWNERS' | 'ALL_MEMBERS';
export const RECIPIENT_POLICY: Record<NotificationEventType, RecipientPolicy> = {
  'analysis.completed': 'TRIGGERING_USER',
  'analysis.failed': 'TRIGGERING_USER_AND_OWNERS',
  'finding.critical': 'ALL_MEMBERS',
  'release_watch.changed': 'TRIGGERING_USER_AND_OWNERS',
};

/** E-mail is opt-out for important events and opt-in for routine ones. */
export const EMAIL_DEFAULT: Record<NotificationEventType, boolean> = {
  'analysis.completed': false,
  'analysis.failed': true,
  'finding.critical': true,
  'release_watch.changed': true,
};

export interface RenderedNotification {
  severity: NotificationSeverity;
  title: string;
  body: string;
  link: string | null;
  projectId: string | null;
  engine: string | null;
  resourceType: string;
  resourceId: string | null;
  groupKey: string;
  /** User who caused the event (recipient policy), if known. */
  actorUserId: string | null;
}

const WATCH_EVENT_SEVERITY: Record<string, NotificationSeverity> = {
  GAP_OPENED: 'MAJOR',
  OBJECT_REMOVED: 'MAJOR',
  NEW_DEPRECATION: 'MEDIUM',
  STATE_CHANGED: 'LOW',
  SUCCESSOR_CHANGED: 'LOW',
  GAP_CLOSED: 'INFO',
};

const WATCH_EVENT_LABEL: Record<string, string> = {
  GAP_CLOSED: 'Gap closed',
  GAP_OPENED: 'Gap opened',
  NEW_DEPRECATION: 'New deprecation',
  SUCCESSOR_CHANGED: 'Successor changed',
  STATE_CHANGED: 'Release state changed',
  OBJECT_REMOVED: 'Removed from release list',
};

function maxSeverity(list: NotificationSeverity[]): NotificationSeverity {
  return list.reduce<NotificationSeverity>(
    (acc, s) => (SEVERITY_ORDER.indexOf(s) > SEVERITY_ORDER.indexOf(acc) ? s : acc),
    'INFO'
  );
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function uuidOrNull(v: unknown): string | null {
  return typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null;
}

/** Deep link to the analysis detail page (falls back to the project workspace). */
function analysisLink(projectId: string | null, analysisId: string | null): string | null {
  if (!projectId) return null;
  return analysisId ? `/projects/${projectId}/analyses/${analysisId}` : `/projects/${projectId}`;
}

export function renderNotification(
  eventType: string,
  aggregateId: string,
  payload: Record<string, any>
): RenderedNotification | null {
  switch (eventType) {
    case 'analysis.completed': {
      const status = str(payload.status) ?? 'COMPLETED';
      const total = Number(payload.totalFindings ?? 0);
      const projectId = uuidOrNull(payload.projectId);
      return {
        severity: status === 'PARTIAL' ? 'MEDIUM' : 'INFO',
        title:
          status === 'PARTIAL'
            ? `Analysis partially completed: ${total} finding${total === 1 ? '' : 's'}`
            : `Analysis completed: ${total} finding${total === 1 ? '' : 's'}`,
        body: `Engines: ${(payload.engineTypes ?? []).join(', ') || 'n/a'}. Target release: ${payload.targetRelease ?? 'n/a'}.`,
        link: analysisLink(projectId, uuidOrNull(payload.analysisId) ?? uuidOrNull(aggregateId)),
        projectId,
        engine: Array.isArray(payload.engineTypes) && payload.engineTypes.length === 1 ? String(payload.engineTypes[0]) : null,
        resourceType: 'ANALYSIS',
        resourceId: uuidOrNull(aggregateId),
        groupKey: `analysis:${aggregateId}`,
        actorUserId: uuidOrNull(payload.triggeredBy),
      };
    }
    case 'analysis.failed': {
      const projectId = uuidOrNull(payload.projectId);
      return {
        severity: 'MAJOR',
        title: 'Analysis failed',
        body: str(payload.reason) ?? 'The analysis could not be completed. Open the run to review the error and re-run it.',
        link: analysisLink(projectId, uuidOrNull(payload.analysisId) ?? uuidOrNull(aggregateId)),
        projectId,
        engine: null,
        resourceType: 'ANALYSIS',
        resourceId: uuidOrNull(aggregateId),
        groupKey: `analysis:${aggregateId}`,
        actorUserId: uuidOrNull(payload.triggeredBy),
      };
    }
    case 'finding.critical': {
      const blocker = Number(payload.blockerCount ?? 0);
      const critical = Number(payload.criticalCount ?? 0);
      const projectId = uuidOrNull(payload.projectId);
      const parts = [
        blocker > 0 ? `${blocker} blocker` : null,
        critical > 0 ? `${critical} critical` : null,
      ].filter(Boolean);
      return {
        severity: blocker > 0 ? 'BLOCKER' : 'CRITICAL',
        title: `${parts.join(' and ')} finding${blocker + critical === 1 ? '' : 's'} detected`,
        body: `Engines: ${(payload.engines ?? []).join(', ') || 'n/a'}. Review them before the next release gate.`,
        link: analysisLink(projectId, uuidOrNull(payload.analysisId) ?? uuidOrNull(aggregateId)),
        projectId,
        engine: Array.isArray(payload.engines) && payload.engines.length === 1 ? String(payload.engines[0]) : null,
        resourceType: 'ANALYSIS',
        resourceId: uuidOrNull(payload.analysisId) ?? uuidOrNull(aggregateId),
        groupKey: `analysis:${payload.analysisId ?? aggregateId}`,
        actorUserId: uuidOrNull(payload.triggeredBy),
      };
    }
    case 'release_watch.changed': {
      const changes: any[] = Array.isArray(payload.changes) ? payload.changes : [];
      if (changes.length === 0) return null;
      const severity = maxSeverity(changes.map((c) => WATCH_EVENT_SEVERITY[c.eventType] ?? 'LOW'));
      const headline = (c: any) =>
        `${WATCH_EVENT_LABEL[c.eventType] ?? c.eventType}: ${c.objectKey ?? 'object'}${c.sapObjectType ? ` (${c.sapObjectType})` : ''}` +
        `${c.releaseLabel ? ` in ${c.releaseLabel}` : ''}`;
      const describe = (c: any) =>
        headline(c) +
        `${c.previous?.supportState || c.current?.supportState ? ` (${c.previous?.supportState ?? 'not listed'} → ${c.current?.supportState ?? 'not listed'})` : ''}`;
      const title =
        changes.length === 1 ? headline(changes[0]) : `Release watch "${payload.label ?? 'watch'}": ${changes.length} changes`;
      return {
        severity,
        title: title.slice(0, 300),
        body: changes.slice(0, 20).map(describe).join('\n') + (changes.length > 20 ? `\n… and ${changes.length - 20} more` : ''),
        link: uuidOrNull(payload.watchId) ? `/knowledge-graph/watches?watch=${payload.watchId}` : '/knowledge-graph/watches',
        projectId: null,
        engine: null,
        resourceType: 'RELEASE_WATCH',
        resourceId: uuidOrNull(payload.watchId) ?? uuidOrNull(aggregateId),
        groupKey: `release-watch:${payload.watchId ?? aggregateId}`,
        actorUserId: uuidOrNull(payload.createdBy),
      };
    }
    default:
      return null;
  }
}
