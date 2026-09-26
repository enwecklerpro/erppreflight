import { escapeHtml, RenderedMail } from './mail.templates';
import type { MailTemplateId } from './mail.types';

/**
 * Operational e-mails in English and German (human-written copy, spec C §42):
 *  - tenant owner notices (suspension, reactivation, trial extension) — the platform
 *    does not store a language preference per user, so owner notices carry both
 *    languages (German first, as for the DACH market, then English);
 *  - support ticket e-mails (created / reply / status change) in the ticket's
 *    language for the requester and in SUPPORT_INBOX_LOCALE for the support inbox.
 * All dynamic values are HTML-escaped; subjects are single-line.
 */

export type MailLocale = 'en' | 'de';

export function normalizeMailLocale(value: unknown): MailLocale {
  return String(value ?? '').trim().toLowerCase().startsWith('de') ? 'de' : 'en';
}

const PRODUCT = 'ERP Preflight';

interface Section {
  heading: string;
  paragraphs: string[];
  /** Pre-formatted text rendered as a quoted block (reason, message body). */
  quote?: { label: string; text: string };
  action?: { label: string; url: string };
}

function singleLine(value: string, max = 200): string {
  return String(value).replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
}

function htmlSection(s: Section): string {
  const paras = s.paragraphs.map((p) => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(p)}</p>`).join('');
  const quote = s.quote
    ? `<p style="margin:0 0 4px;font-size:12px;color:#555">${escapeHtml(s.quote.label)}</p>
<blockquote style="margin:0 0 14px;padding:10px 14px;border-left:3px solid #2563eb;background:#f3f6fb;white-space:pre-wrap">${escapeHtml(s.quote.text)}</blockquote>`
    : '';
  const action = s.action
    ? `<p style="margin:18px 0"><a href="${escapeHtml(s.action.url)}" style="background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(s.action.label)}</a></p>
<p style="margin:0 0 12px;font-size:12px;color:#555;word-break:break-all">${escapeHtml(s.action.url)}</p>`
    : '';
  return `<h1 style="font-size:17px;margin:0 0 14px">${escapeHtml(s.heading)}</h1>${paras}${quote}${action}`;
}

function textSection(s: Section): string {
  const parts = [s.heading, '', ...s.paragraphs];
  if (s.quote) parts.push(`${s.quote.label}:`, ...s.quote.text.split('\n').map((l) => `> ${l}`));
  if (s.action) parts.push(`${s.action.label}: ${s.action.url}`);
  return parts.join('\n');
}

function renderSections(template: MailTemplateId, subject: string, sections: Section[], footer: string): RenderedMail {
  const html = `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;background:#f6f7f9;padding:24px">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
${sections.map(htmlSection).join('<hr style="border:none;border-top:1px solid #e5e7eb;margin:22px 0">')}
<p style="margin:24px 0 0;font-size:11px;color:#888">${escapeHtml(footer)}</p>
</div></body></html>`;
  const text = [...sections.map(textSection), `— ${footer}`].join('\n\n----\n\n');
  return { template, subject: singleLine(subject, 300), text, html };
}

const OPS_FOOTER = `${PRODUCT} — Plattformbetrieb / platform operations. Automatische Nachricht / automated message.`;

// -----------------------------------------------------------------------------
// Tenant owner notices (bilingual)
// -----------------------------------------------------------------------------

export function renderTenantSuspended(p: {
  organizationName: string;
  reason: string;
  when: string;
  supportEmail?: string | null;
  exportUrl: string;
}): RenderedMail {
  const contactDe = p.supportEmail ? `Bei Fragen erreichen Sie uns unter ${p.supportEmail}.` : 'Bei Fragen wenden Sie sich an den ERP Preflight Support.';
  const contactEn = p.supportEmail ? `If you have questions, contact us at ${p.supportEmail}.` : 'If you have questions, contact ERP Preflight support.';
  return renderSections(
    'TENANT_SUSPENDED',
    `Organisation „${singleLine(p.organizationName, 80)}“ gesperrt / Organization "${singleLine(p.organizationName, 80)}" suspended`,
    [
      {
        heading: `Ihre Organisation „${p.organizationName}“ wurde gesperrt`,
        paragraphs: [
          'Guten Tag,',
          `der ERP Preflight Betrieb hat Ihre Organisation am ${p.when} (UTC) gesperrt. Bis zur Entsperrung sind Projekte, Analysen, Berichte und Integrationen dieser Organisation nicht erreichbar; geplante und wartende Analysen werden nicht ausgeführt.`,
          'Sie können sich weiterhin anmelden und Ihre persönlichen Daten exportieren. Es werden keine Daten gelöscht.',
          contactDe,
        ],
        quote: { label: 'Begründung', text: p.reason },
        action: { label: 'Persönliche Daten exportieren', url: p.exportUrl },
      },
      {
        heading: `Your organization "${p.organizationName}" has been suspended`,
        paragraphs: [
          'Hello,',
          `ERP Preflight operations suspended your organization at ${p.when} (UTC). Until it is reactivated, the organization's projects, analyses, reports and integrations are unavailable and scheduled or queued analyses do not run.`,
          'You can still sign in and export your personal data. No data is deleted.',
          contactEn,
        ],
        quote: { label: 'Reason', text: p.reason },
        action: { label: 'Export my personal data', url: p.exportUrl },
      },
    ],
    OPS_FOOTER
  );
}

export function renderTenantReactivated(p: { organizationName: string; reason: string; when: string; appUrl: string }): RenderedMail {
  return renderSections(
    'TENANT_REACTIVATED',
    `Organisation „${singleLine(p.organizationName, 80)}“ wieder aktiv / Organization "${singleLine(p.organizationName, 80)}" reactivated`,
    [
      {
        heading: `Ihre Organisation „${p.organizationName}“ ist wieder aktiv`,
        paragraphs: [
          'Guten Tag,',
          `die Sperre Ihrer Organisation wurde am ${p.when} (UTC) aufgehoben. Alle Mitglieder haben wieder vollen Zugriff; zurückgestellte Analysen werden jetzt ausgeführt.`,
        ],
        quote: { label: 'Hinweis des Betriebs', text: p.reason },
        action: { label: 'ERP Preflight öffnen', url: p.appUrl },
      },
      {
        heading: `Your organization "${p.organizationName}" is active again`,
        paragraphs: [
          'Hello,',
          `The suspension of your organization was lifted at ${p.when} (UTC). All members have full access again; deferred analyses now run.`,
        ],
        quote: { label: 'Note from operations', text: p.reason },
        action: { label: 'Open ERP Preflight', url: p.appUrl },
      },
    ],
    OPS_FOOTER
  );
}

export function renderTrialExtended(p: {
  organizationName: string;
  days: number;
  trialTier: string;
  endsAtDe: string;
  endsAtEn: string;
  billingUrl: string;
}): RenderedMail {
  return renderSections(
    'TRIAL_EXTENDED',
    `Testphase verlängert / Trial extended: ${singleLine(p.organizationName, 80)}`,
    [
      {
        heading: 'Ihre Testphase wurde verlängert',
        paragraphs: [
          'Guten Tag,',
          `die Testphase der Organisation „${p.organizationName}“ (Tarif ${p.trialTier}) wurde um ${p.days} ${p.days === 1 ? 'Tag' : 'Tage'} verlängert. Sie endet jetzt am ${p.endsAtDe}.`,
          'Den aktuellen Stand Ihres Tarifs und Ihrer Nutzung sehen Sie unter Einstellungen → Abrechnung.',
        ],
        action: { label: 'Abrechnung öffnen', url: p.billingUrl },
      },
      {
        heading: 'Your trial has been extended',
        paragraphs: [
          'Hello,',
          `The trial of the organization "${p.organizationName}" (${p.trialTier} plan) was extended by ${p.days} ${p.days === 1 ? 'day' : 'days'}. It now ends on ${p.endsAtEn}.`,
          'Your current plan and usage are shown under Settings → Billing.',
        ],
        action: { label: 'Open billing', url: p.billingUrl },
      },
    ],
    OPS_FOOTER
  );
}

// -----------------------------------------------------------------------------
// Support ticket e-mails (one language per recipient)
// -----------------------------------------------------------------------------

const STATUS_LABELS: Record<MailLocale, Record<string, string>> = {
  en: {
    OPEN: 'Open',
    IN_PROGRESS: 'In progress',
    WAITING_ON_CUSTOMER: 'Waiting for your reply',
    RESOLVED: 'Resolved',
    CLOSED: 'Closed',
  },
  de: {
    OPEN: 'Offen',
    IN_PROGRESS: 'In Bearbeitung',
    WAITING_ON_CUSTOMER: 'Wartet auf Ihre Antwort',
    RESOLVED: 'Gelöst',
    CLOSED: 'Geschlossen',
  },
};

const CATEGORY_LABELS: Record<MailLocale, Record<string, string>> = {
  en: {
    QUESTION: 'Question',
    INCORRECT_FINDING: 'Incorrect finding',
    BUG: 'Bug',
    BILLING: 'Billing',
    ACCESS: 'Access / login',
  },
  de: {
    QUESTION: 'Frage',
    INCORRECT_FINDING: 'Falscher Befund',
    BUG: 'Fehler',
    BILLING: 'Abrechnung',
    ACCESS: 'Zugang / Anmeldung',
  },
};

export function ticketStatusLabel(locale: MailLocale, status: string): string {
  return STATUS_LABELS[locale][status] ?? status;
}

export interface TicketMailContext {
  locale: MailLocale;
  /** requester = the member who opened the ticket; inbox = SUPPORT_INBOX_EMAIL. */
  audience: 'requester' | 'inbox';
  ticketId: string;
  subject: string;
  category: string;
  organizationName: string;
  requesterEmail: string | null;
  url: string;
}

function ticketRef(ticketId: string): string {
  return ticketId.slice(0, 8).toUpperCase();
}

function supportFooter(locale: MailLocale, audience: TicketMailContext['audience']): string {
  if (audience === 'inbox') {
    return locale === 'de'
      ? `${PRODUCT} Support-Postfach. Antworten Sie in der Support-Konsole (Admin → Support), nicht per E-Mail.`
      : `${PRODUCT} support inbox. Reply in the support console (Admin → Support), not by e-mail.`;
  }
  return locale === 'de'
    ? `${PRODUCT} Support. Bitte antworten Sie über Einstellungen → Support; Antworten auf diese E-Mail werden nicht verarbeitet.`
    : `${PRODUCT} support. Please reply under Settings → Support; replies to this e-mail are not processed.`;
}

export function renderTicketCreated(ctx: TicketMailContext, description: string): RenderedMail {
  const ref = ticketRef(ctx.ticketId);
  const category = CATEGORY_LABELS[ctx.locale][ctx.category] ?? ctx.category;
  const de = ctx.locale === 'de';
  const section: Section =
    ctx.audience === 'requester'
      ? {
          heading: de ? `Ihr Support-Ticket #${ref} ist eingegangen` : `We received your support ticket #${ref}`,
          paragraphs: de
            ? ['Guten Tag,', `vielen Dank für Ihre Anfrage „${ctx.subject}“ (${category}). Wir melden uns per E-Mail, sobald es Neuigkeiten gibt.`]
            : ['Hello,', `Thank you for your request "${ctx.subject}" (${category}). We will e-mail you as soon as there is an update.`],
          quote: { label: de ? 'Ihre Beschreibung' : 'Your description', text: description },
          action: { label: de ? 'Ticket öffnen' : 'Open ticket', url: ctx.url },
        }
      : {
          heading: de ? `Neues Support-Ticket #${ref}: ${ctx.subject}` : `New support ticket #${ref}: ${ctx.subject}`,
          paragraphs: de
            ? [`Organisation: ${ctx.organizationName}`, `Kategorie: ${category}`, `Angelegt von: ${ctx.requesterEmail ?? 'unbekannt'}`]
            : [`Organization: ${ctx.organizationName}`, `Category: ${category}`, `Opened by: ${ctx.requesterEmail ?? 'unknown'}`],
          quote: { label: de ? 'Beschreibung' : 'Description', text: description },
          action: { label: de ? 'In der Support-Konsole öffnen' : 'Open in the support console', url: ctx.url },
        };
  const subject =
    ctx.audience === 'requester'
      ? de
        ? `[Ticket #${ref}] Eingangsbestätigung: ${ctx.subject}`
        : `[Ticket #${ref}] We received your request: ${ctx.subject}`
      : `[Ticket #${ref}] ${de ? 'Neu' : 'New'} (${ctx.organizationName}): ${ctx.subject}`;
  return renderSections('SUPPORT_TICKET_CREATED', subject, [section], supportFooter(ctx.locale, ctx.audience));
}

export function renderTicketReply(
  ctx: TicketMailContext,
  reply: { authorRole: 'CUSTOMER' | 'SUPPORT'; authorEmail: string | null; body: string }
): RenderedMail {
  const ref = ticketRef(ctx.ticketId);
  const de = ctx.locale === 'de';
  const fromSupport = reply.authorRole === 'SUPPORT';
  const author = fromSupport ? (de ? 'ERP Preflight Support' : 'ERP Preflight support') : reply.authorEmail ?? (de ? 'Kunde' : 'Customer');
  const section: Section = {
    heading: de ? `Neue Antwort zu Ticket #${ref}` : `New reply on ticket #${ref}`,
    paragraphs: de
      ? [`Betreff: ${ctx.subject}`, `Organisation: ${ctx.organizationName}`, `Antwort von: ${author}`]
      : [`Subject: ${ctx.subject}`, `Organization: ${ctx.organizationName}`, `Reply from: ${author}`],
    quote: { label: de ? 'Nachricht' : 'Message', text: reply.body },
    action: { label: de ? 'Ticket öffnen' : 'Open ticket', url: ctx.url },
  };
  return renderSections(
    'SUPPORT_TICKET_REPLY',
    `[Ticket #${ref}] ${de ? 'Neue Antwort' : 'New reply'}: ${ctx.subject}`,
    [section],
    supportFooter(ctx.locale, ctx.audience)
  );
}

export function renderTicketStatusChanged(ctx: TicketMailContext, change: { from: string; to: string }): RenderedMail {
  const ref = ticketRef(ctx.ticketId);
  const de = ctx.locale === 'de';
  const from = ticketStatusLabel(ctx.locale, change.from);
  const to = ticketStatusLabel(ctx.locale, change.to);
  const section: Section = {
    heading: de ? `Status von Ticket #${ref}: ${to}` : `Ticket #${ref} is now: ${to}`,
    paragraphs: de
      ? [`Betreff: ${ctx.subject}`, `Organisation: ${ctx.organizationName}`, `Der Status wurde von „${from}“ auf „${to}“ geändert.`]
      : [`Subject: ${ctx.subject}`, `Organization: ${ctx.organizationName}`, `The status changed from "${from}" to "${to}".`],
    action: { label: de ? 'Ticket öffnen' : 'Open ticket', url: ctx.url },
  };
  return renderSections(
    'SUPPORT_TICKET_STATUS_CHANGED',
    `[Ticket #${ref}] ${de ? 'Status' : 'Status'}: ${to} — ${ctx.subject}`,
    [section],
    supportFooter(ctx.locale, ctx.audience)
  );
}
