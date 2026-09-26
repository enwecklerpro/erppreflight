import { describe, it, expect, vi } from 'vitest';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import {
  EMAIL_DEFAULT,
  NOTIFICATION_EVENT_TYPES,
  RECIPIENT_POLICY,
  findingDeepLink,
  renderNotification,
} from '../src/modules/notifications/notification-renderer';
import { renderFindingAssignedMail } from '../src/modules/notifications/notification-mail.templates';

const ORG = '11111111-1111-4111-8111-111111111111';
const PROJECT = '22222222-2222-4222-8222-222222222222';
const FINDING = '33333333-3333-4333-8333-333333333333';
const ASSIGNEE = '44444444-4444-4444-8444-444444444444';
const ASSIGNER = '55555555-5555-4555-8555-555555555555';
const OWNER = '66666666-6666-4666-8666-666666666666';
const LIFECYCLE = '77777777-7777-4777-8777-777777777777';

const payload = (extra: Record<string, unknown> = {}) => ({
  organizationId: ORG,
  lifecycleId: LIFECYCLE,
  projectId: PROJECT,
  findingId: FINDING,
  assigneeId: ASSIGNEE,
  assignedBy: ASSIGNER,
  assignedByName: 'Anna Assigner',
  dueDate: '2026-10-31',
  ruleId: 'OPD_DETERMINATION_STEP_MISSING',
  title: 'Determination step <missing>',
  severity: 'CRITICAL',
  engine: 'OPD_GUARD',
  projectName: 'S/4 Wave 2',
  note: 'Please check before the gate',
  ...extra,
});

describe('P7: finding.assigned rendering (EN/DE)', () => {
  it('is a notification event type addressed to the assignee only, e-mailed by default', () => {
    expect(NOTIFICATION_EVENT_TYPES).toContain('finding.assigned');
    expect(RECIPIENT_POLICY['finding.assigned']).toBe('RECIPIENT_USER');
    expect(EMAIL_DEFAULT['finding.assigned']).toBe(true);
  });

  it('renders English with severity as text and a deep link to the finding', () => {
    const n = renderNotification('finding.assigned', FINDING, payload())!;
    expect(n.title).toBe('Finding assigned to you: Determination step <missing>');
    expect(n.body).toContain('Anna Assigner assigned OPD_DETERMINATION_STEP_MISSING (severity: Critical) in project "S/4 Wave 2" to you. Due 2026-10-31.');
    expect(n.body).toContain('Note: Please check before the gate');
    expect(n.link).toBe(`/projects/${PROJECT}/findings?finding=${FINDING}&org=${ORG}`);
    expect(n).toMatchObject({ severity: 'CRITICAL', resourceType: 'FINDING', resourceId: FINDING, recipientUserId: ASSIGNEE, actorUserId: ASSIGNER });
  });

  it('renders German with umlauts and German date format', () => {
    const n = renderNotification('finding.assigned', FINDING, payload(), 'de')!;
    expect(n.title).toBe('Befund zugewiesen: Determination step <missing>');
    expect(n.body).toContain('Anna Assigner hat Ihnen OPD_DETERMINATION_STEP_MISSING (Schweregrad: Kritisch) im Projekt „S/4 Wave 2“ zugewiesen. Fällig am 31.10.2026.');
    expect(n.body).toContain('Notiz: Please check before the gate');
  });

  it('ignores events without an assignee (unassignment) and falls back to the project ledger link', () => {
    expect(renderNotification('finding.assigned', FINDING, payload({ assigneeId: null }))).toBeNull();
    expect(findingDeepLink(PROJECT, null)).toBe(`/projects/${PROJECT}/findings`);
    expect(findingDeepLink(PROJECT, FINDING)).toBe(`/projects/${PROJECT}/findings?finding=${FINDING}`);
    expect(findingDeepLink(null, FINDING)).toBeNull();
  });

  it('e-mail template: localized, escaped HTML, severity in words, absolute deep link', () => {
    const n = renderNotification('finding.assigned', FINDING, payload(), 'de')!;
    const url = `https://app.example.com/projects/${PROJECT}/findings?finding=${FINDING}&org=${ORG}`;
    const mail = renderFindingAssignedMail('de', n, url, 'Bea Berater');
    expect(mail.template).toBe('FINDING_ASSIGNED');
    expect(mail.subject).toBe('[ERP Preflight] Befund zugewiesen: Determination step <missing>');
    expect(mail.text).toContain('Hallo Bea Berater,');
    expect(mail.text).toContain('Schweregrad: Kritisch');
    expect(mail.text).toContain('Fällig am: 31.10.2026');
    expect(mail.text).toContain(`Befund öffnen: ${url}`);
    expect(mail.html).toContain('Determination step &lt;missing&gt;');
    expect(mail.html).not.toContain('<missing>');
    expect(mail.html).toContain('lang="de"');
    const en = renderFindingAssignedMail('en', renderNotification('finding.assigned', FINDING, payload())!, url, null);
    expect(en.text).toContain('Hello,');
    expect(en.text).toContain('Severity: Critical');
    expect(en.text).toContain(`Open the finding: ${url}`);
  });
});

describe('P7: finding.assigned delivery (preferences, locale, recipients)', () => {
  function makeService(opts: { prefs?: any[]; locale?: string | null } = {}) {
    const inserts: any[][] = [];
    const client = {
      query: vi.fn(async (_sql: string, params: any[]) => {
        inserts.push(params);
        return { rows: [{ id: 'n1' }] };
      }),
    };
    const db: any = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM organization_members')) {
          return {
            rows: [
              { user_id: ASSIGNEE, role: 'MIGRATION_CONSULTANT', email: 'assignee@example.test', full_name: 'Bea Berater', preferred_locale: opts.locale ?? null },
              { user_id: ASSIGNER, role: 'ORGANIZATION_OWNER', email: 'assigner@example.test', full_name: 'Anna Assigner', preferred_locale: null },
              { user_id: OWNER, role: 'ORGANIZATION_OWNER', email: 'owner@example.test', full_name: null, preferred_locale: 'de' },
            ],
          };
        }
        if (sql.includes('FROM notification_preferences')) return { rows: opts.prefs ?? [] };
        return { rows: [] };
      }),
      withTenantTransaction: vi.fn(async (_org: string, fn: any) => fn(client)),
    };
    const mail = {
      transportKind: 'dev',
      link: vi.fn((path: string) => `https://app.example.com${path}`),
      send: vi.fn(async () => ({ transport: 'dev', messageId: 'm1' })),
    };
    const svc = new NotificationsService(db, { subscribe: vi.fn() } as any, { get: () => null } as any, mail as any);
    return { svc, inserts, mail };
  }
  const event = (p: Record<string, unknown>) =>
    ({ id: 'evt-1', organizationId: ORG, eventType: 'finding.assigned', aggregateType: 'FINDING', aggregateId: FINDING, payload: p }) as any;

  it('notifies only the assignee, in-app + e-mail in the assignee language, with the deep link', async () => {
    const { svc, inserts, mail } = makeService({ locale: 'de' });
    await svc.handleEvent(event(payload()));
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toBe(ASSIGNEE);
    expect(inserts[0][4]).toBe('Befund zugewiesen: Determination step <missing>');
    expect(inserts[0][6]).toBe(`/projects/${PROJECT}/findings?finding=${FINDING}&org=${ORG}`);
    expect(inserts[0][12]).toBe('finding.assigned:evt-1');
    expect(mail.send).toHaveBeenCalledTimes(1);
    const [to, rendered] = mail.send.mock.calls[0] as unknown as [string, any];
    expect(to).toBe('assignee@example.test');
    expect(rendered.template).toBe('FINDING_ASSIGNED');
    expect(rendered.text).toContain(`https://app.example.com/projects/${PROJECT}/findings?finding=${FINDING}&org=${ORG}`);
    expect(svc.channels().email).toBe(true);
  });

  it('respects the e-mail preference (in-app still delivered) and the in-app mute', async () => {
    const noMail = makeService({ prefs: [{ user_id: ASSIGNEE, channel: 'EMAIL', enabled: false }] });
    await noMail.svc.handleEvent(event(payload()));
    expect(noMail.inserts).toHaveLength(1);
    expect(noMail.mail.send).not.toHaveBeenCalled();

    const mailOnly = makeService({ prefs: [{ user_id: ASSIGNEE, channel: 'IN_APP', enabled: false }] });
    await mailOnly.svc.handleEvent(event(payload()));
    expect(mailOnly.inserts).toHaveLength(0);
    expect(mailOnly.mail.send).toHaveBeenCalledTimes(1);
    expect((mailOnly.mail.send.mock.calls[0] as unknown as [string, any])[1].subject).toContain('Finding assigned to you');
  });

  it('never notifies for self-assignment or an assignee outside the organization', async () => {
    const self = makeService();
    await self.svc.handleEvent(event(payload({ assigneeId: ASSIGNER })));
    expect(self.inserts).toHaveLength(0);
    expect(self.mail.send).not.toHaveBeenCalled();

    const foreign = makeService();
    await foreign.svc.handleEvent(event(payload({ assigneeId: '99999999-9999-4999-8999-999999999999' })));
    expect(foreign.inserts).toHaveLength(0);
  });

  it('stores and reads the notification language', async () => {
    const calls: any[] = [];
    const db: any = {
      query: vi.fn(async (sql: string, params: any[]) => {
        calls.push([sql, params]);
        return { rows: [{ preferred_locale: null }] };
      }),
    };
    const svc = new NotificationsService(db, { subscribe: vi.fn() } as any, { get: () => null } as any);
    expect(await svc.emailLocale(ASSIGNEE)).toEqual({ locale: 'en', explicit: false });
    expect(await svc.setEmailLocale(ASSIGNEE, 'de')).toEqual({ locale: 'de', explicit: true });
    expect(calls[1][0]).toMatch(/UPDATE users SET preferred_locale = \$2 WHERE id = \$1/);
    expect(calls[1][1]).toEqual([ASSIGNEE, 'de']);
    expect(svc.channels().email).toBe(false);
  });
});
