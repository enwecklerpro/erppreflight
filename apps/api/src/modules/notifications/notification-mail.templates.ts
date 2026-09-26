import { escapeHtml, RenderedMail } from '../mail/mail.templates';
import type { NotificationLocale, RenderedNotification } from './notification-renderer';

/**
 * E-mail bodies for notification events (EN/DE). Kept apart from the account/security
 * templates in mail/mail.templates.ts: different footer (preferences link instead of
 * "security message") and localized per recipient (users.preferred_locale).
 */

const PRODUCT = 'ERP Preflight';

const COPY: Record<
  NotificationLocale,
  {
    open: string;
    openFinding: string;
    fallbackLink: string;
    footer: string;
    automated: string;
    severity: string;
    rule: string;
    project: string;
    due: string;
    assignedBy: string;
    note: string;
    greeting: (name?: string | null) => string;
  }
> = {
  en: {
    open: 'Open in ERP Preflight',
    openFinding: 'Open the finding',
    fallbackLink: 'If the button does not work, copy this link into your browser:',
    footer: 'You receive this e-mail because of your notification settings. Change them in ERP Preflight → Notifications.',
    automated: 'automated notification, do not reply',
    severity: 'Severity',
    rule: 'Rule',
    project: 'Project',
    due: 'Due date',
    assignedBy: 'Assigned by',
    note: 'Note',
    greeting: (name) => (name && name.trim() ? `Hello ${name.trim()},` : 'Hello,'),
  },
  de: {
    open: 'In ERP Preflight öffnen',
    openFinding: 'Befund öffnen',
    fallbackLink: 'Falls die Schaltfläche nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:',
    footer:
      'Sie erhalten diese E-Mail aufgrund Ihrer Benachrichtigungseinstellungen. Ändern Sie diese in ERP Preflight → Benachrichtigungen.',
    automated: 'automatische Benachrichtigung, bitte nicht antworten',
    severity: 'Schweregrad',
    rule: 'Regel',
    project: 'Projekt',
    due: 'Fällig am',
    assignedBy: 'Zugewiesen von',
    note: 'Notiz',
    greeting: (name) => (name && name.trim() ? `Hallo ${name.trim()},` : 'Hallo,'),
  },
};

function layout(
  locale: NotificationLocale,
  title: string,
  paragraphs: string[],
  rows: Array<[string, string]>,
  action: { label: string; url: string } | null
): string {
  const c = COPY[locale];
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5;white-space:pre-line">${escapeHtml(p)}</p>`).join('');
  const table = rows.length
    ? `<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;font-size:14px">${rows
        .map(
          ([k, v]) =>
            `<tr><th scope="row" style="text-align:left;padding:4px 12px 4px 0;color:#555;font-weight:600">${escapeHtml(k)}</th><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`
        )
        .join('')}</table>`
    : '';
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#555">${escapeHtml(c.fallbackLink)}<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';
  return `<!doctype html><html lang="${locale}"><body style="font-family:Arial,Helvetica,sans-serif;color:#111;background:#f6f7f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<h1 style="font-size:18px;margin:0 0 18px">${escapeHtml(title)}</h1>${body}${table}${button}
<p style="margin:24px 0 0;font-size:12px;color:#666">${escapeHtml(c.footer)}</p>
<p style="margin:12px 0 0;font-size:11px;color:#888">${PRODUCT} — ${escapeHtml(c.automated)}.</p>
</div></body></html>`;
}

function text(
  locale: NotificationLocale,
  paragraphs: string[],
  rows: Array<[string, string]>,
  action: { label: string; url: string } | null
): string {
  const c = COPY[locale];
  const parts = [...paragraphs];
  if (rows.length) parts.push(rows.map(([k, v]) => `${k}: ${v}`).join('\n'));
  if (action) parts.push(`${action.label}: ${action.url}`);
  parts.push(c.footer);
  parts.push(`— ${PRODUCT} (${c.automated})`);
  return parts.join('\n\n');
}

/** Dedicated template for `finding.assigned` (P7): what, severity (as text), who, due date, deep link. */
export function renderFindingAssignedMail(
  locale: NotificationLocale,
  n: RenderedNotification,
  url: string | null,
  recipientName?: string | null
): RenderedMail {
  const c = COPY[locale];
  const f = n.facts ?? {};
  const subject = `[${PRODUCT}] ${n.title}`;
  const intro =
    locale === 'de'
      ? `${f.assignedBy ?? 'Ein Teammitglied'} hat Ihnen einen Befund zugewiesen.`
      : `${f.assignedBy ?? 'A team member'} assigned a finding to you.`;
  const rows: Array<[string, string]> = [
    [c.rule, f.ruleId ?? '—'],
    [c.severity, f.severityLabel ?? n.severity],
  ];
  if (f.project) rows.push([c.project, f.project]);
  if (f.dueDate) rows.push([c.due, f.dueDate]);
  if (f.assignedBy) rows.push([c.assignedBy, f.assignedBy]);
  const paragraphs = [c.greeting(recipientName), intro, f.title ?? ''];
  if (f.note) paragraphs.push(`${c.note}: ${f.note}`);
  const action = url ? { label: c.openFinding, url } : null;
  return {
    template: 'FINDING_ASSIGNED',
    subject,
    text: text(locale, paragraphs.filter(Boolean), rows, action),
    html: layout(locale, n.title, paragraphs.filter(Boolean), rows, action),
  };
}

/** Generic notification e-mail (analysis / critical finding / release watch events). */
export function renderNotificationMail(
  locale: NotificationLocale,
  n: RenderedNotification,
  severityText: string,
  url: string | null
): RenderedMail {
  const c = COPY[locale];
  const action = url ? { label: c.open, url } : null;
  const rows: Array<[string, string]> = [[c.severity, severityText]];
  return {
    template: 'NOTIFICATION',
    subject: `[${PRODUCT}] ${n.title}`,
    text: text(locale, [n.title, n.body], rows, action),
    html: layout(locale, n.title, [n.body], rows, action),
  };
}
