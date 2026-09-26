import { describe, expect, it, vi } from 'vitest';
import { buildWatchState, diffWatchState, WatchState } from '../src/modules/release-intelligence/release-watch.evaluator';
import { CreateWatchSchema, SnapshotDiffQuerySchema } from '../src/modules/release-intelligence/release-intelligence.types';
import { renderNotification } from '../src/modules/notifications/notification-renderer';
import { NotificationsService } from '../src/modules/notifications/notifications.service';

const O = '11111111-1111-4111-8111-111111111111';
const R = '22222222-2222-4222-8222-222222222222';
const key = `${O}|${R}|RELEASE_CONTRACT`;
const fact = (supportState: string, successors: string[] = [], state = supportState.toLowerCase()) => ({
  supportState,
  state,
  successors,
  successorConcept: null,
});

describe('release watch evaluation', () => {
  it.each([
    ['NOT_RELEASED', 'RELEASED', 'GAP_CLOSED'],
    ['RELEASED', 'DEPRECATED', 'NEW_DEPRECATION'],
    ['RELEASED', 'NOT_RELEASED', 'GAP_OPENED'],
    ['NOT_RELEASED', 'NOT_TO_BE_RELEASED_STABLE', 'STATE_CHANGED'],
  ])('%s -> %s yields %s', (from, to, expected) => {
    const changes = diffWatchState({ [key]: fact(from) }, { [key]: fact(to) });
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ eventType: expected, objectId: O, releaseId: R, scheme: 'RELEASE_CONTRACT' });
  });

  it('detects successor changes, removals and first appearance as released', () => {
    expect(diffWatchState({ [key]: fact('NOT_RELEASED', ['CDS_STOB:A']) }, { [key]: fact('NOT_RELEASED', ['CDS_STOB:B']) })[0].eventType).toBe(
      'SUCCESSOR_CHANGED'
    );
    expect(diffWatchState({ [key]: fact('RELEASED') }, {})[0].eventType).toBe('OBJECT_REMOVED');
    expect(diffWatchState({}, { [key]: fact('RELEASED') })[0].eventType).toBe('GAP_CLOSED');
    expect(diffWatchState({ [key]: fact('RELEASED') }, { [key]: fact('RELEASED') })).toEqual([]);
  });

  it('builds a canonical watch state from effective states', () => {
    const state: WatchState = buildWatchState([
      {
        objectId: O,
        releaseId: R,
        scheme: 'RELEASE_CONTRACT',
        state: 'notToBeReleased',
        supportState: 'NOT_RELEASED',
        cleanCoreLevel: null,
        successors: [
          { sapObjectType: 'CDS_STOB', objectKey: 'I_PRODUCTSALES' },
          { sapObjectType: 'CDS_STOB', objectKey: 'I_PRODUCT' },
        ],
        successorConcept: null,
        successorClassification: 'multipleObjects',
        trustLevel: 'OFFICIAL_REPOSITORY',
        sourceId: 's',
      },
    ]);
    expect(state[key].successors).toEqual(['CDS_STOB:I_PRODUCT', 'CDS_STOB:I_PRODUCTSALES']);
  });

  it('validates watch requests', () => {
    expect(CreateWatchSchema.safeParse({ watchType: 'FINDING' }).success).toBe(false);
    expect(CreateWatchSchema.safeParse({ watchType: 'GAP' }).success).toBe(false);
    expect(CreateWatchSchema.safeParse({ watchType: 'GAP', objectId: O }).success).toBe(true);
    expect(SnapshotDiffQuerySchema.safeParse({ from: 3, to: 2 }).success).toBe(false);
  });
});

describe('notification rendering', () => {
  it('renders release watch changes with the worst severity and a readable title', () => {
    const n = renderNotification('release_watch.changed', O, {
      watchId: O,
      label: 'Gap: MARA',
      createdBy: R,
      changes: [
        { eventType: 'GAP_CLOSED', objectKey: 'MARA', sapObjectType: 'TABL', releaseLabel: 'SAP Cloud ERP Private — latest release',
          previous: { supportState: 'NOT_RELEASED' }, current: { supportState: 'RELEASED' } },
      ],
    })!;
    expect(n.title).toBe('Gap closed: MARA (TABL) in SAP Cloud ERP Private — latest release');
    expect(n.severity).toBe('INFO');
    expect(n.body).toContain('NOT_RELEASED → RELEASED');
    expect(n.actorUserId).toBe(R);
    const two = renderNotification('release_watch.changed', O, {
      watchId: O,
      label: 'API watch',
      changes: [{ eventType: 'GAP_CLOSED' }, { eventType: 'GAP_OPENED' }],
    })!;
    expect(two.severity).toBe('MAJOR');
    expect(two.title).toBe('Release watch "API watch": 2 changes');
  });

  it('renders analysis and critical finding events', () => {
    expect(renderNotification('analysis.completed', O, { status: 'COMPLETED', totalFindings: 1, projectId: R })).toMatchObject({
      title: 'Analysis completed: 1 finding',
      severity: 'INFO',
      link: `/projects/${R}/analyses/${O}`,
    });
    expect(renderNotification('analysis.failed', O, { projectId: R, analysisId: O })?.link).toBe(`/projects/${R}/analyses/${O}`);
    expect(renderNotification('analysis.completed', 'not-a-uuid', { projectId: R })?.link).toBe(`/projects/${R}`);
    expect(renderNotification('finding.critical', O, { blockerCount: 1, criticalCount: 2, engines: ['X'] })).toMatchObject({
      severity: 'BLOCKER',
      title: '1 blocker and 2 critical findings detected',
    });
    expect(renderNotification('something.else', O, {})).toBeNull();
  });
});

describe('NotificationsService delivery', () => {
  function makeService(opts: { prefs?: any[]; inserted?: boolean }) {
    const inserts: any[][] = [];
    const client = {
      query: vi.fn(async (_sql: string, params: any[]) => {
        inserts.push(params);
        return { rows: opts.inserted === false ? [] : [{ id: 'n1' }] };
      }),
    };
    const db: any = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM organization_members')) {
          return {
            rows: [
              { user_id: R, role: 'MIGRATION_CONSULTANT', email: 'actor@example.test' },
              { user_id: O, role: 'ORGANIZATION_OWNER', email: 'owner@example.test' },
              { user_id: '33333333-3333-4333-8333-333333333333', role: 'VIEWER', email: 'viewer@example.test' },
            ],
          };
        }
        if (sql.includes('FROM notification_preferences')) return { rows: opts.prefs ?? [] };
        return { rows: [] };
      }),
      withTenantTransaction: vi.fn(async (_org: string, fn: any) => fn(client)),
    };
    const outbox: any = { subscribe: vi.fn() };
    const svc = new NotificationsService(db, outbox, { get: () => null } as any);
    return { svc, db, outbox, inserts };
  }
  const event = (eventType: string, payload: any) =>
    ({ id: 'e1', organizationId: 'org', eventType, aggregateType: 'ANALYSIS', aggregateId: O, payload }) as any;

  it('subscribes to the notification event types on init', () => {
    const { svc, outbox } = makeService({});
    svc.onModuleInit();
    expect(outbox.subscribe.mock.calls.map((c: any[]) => c[0])).toEqual([
      'analysis.completed',
      'analysis.failed',
      'finding.critical',
      'release_watch.changed',
    ]);
  });

  it('delivers analysis.failed to the actor and owners, with idempotent dedupe keys, and e-mails via MailSender', async () => {
    const { svc, inserts } = makeService({});
    const send = vi.fn(async (_m: unknown) => undefined);
    svc.setMailSender({ send });
    await svc.handleEvent(event('analysis.failed', { triggeredBy: R, projectId: O }));
    expect(inserts.map((p) => p[1]).sort()).toEqual([O, R].sort());
    expect(new Set(inserts.map((p) => p[12]))).toEqual(new Set([`analysis.failed:${O}`]));
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0] as unknown[])[0]).toMatchObject({ subject: '[ERP Preflight] Analysis failed' });
  });

  it('does not re-send e-mail when the in-app row already existed (outbox retry) and honours mutes', async () => {
    const retry = makeService({ inserted: false });
    const send = vi.fn(async (_m: unknown) => undefined);
    retry.svc.setMailSender({ send });
    await retry.svc.handleEvent(event('finding.critical', { criticalCount: 1 }));
    expect(send).not.toHaveBeenCalled();

    const muted = makeService({ prefs: [{ user_id: R, channel: 'IN_APP', enabled: false }] });
    await muted.svc.handleEvent(event('finding.critical', { criticalCount: 1 }));
    expect(muted.inserts.map((p) => p[1])).not.toContain(R);
    expect(muted.inserts).toHaveLength(2);
  });

  it('works without a mail provider (e-mail channel is a no-op)', async () => {
    const { svc, inserts } = makeService({});
    await svc.handleEvent(event('analysis.completed', { triggeredBy: R, totalFindings: 0 }));
    expect(inserts.map((p) => p[1])).toEqual([R]);
    expect(svc.channels()).toEqual({ inApp: true, webhook: true, email: false });
  });
});
