import { MailTemplateId } from './mail.types';

export interface RenderedMail {
  template: MailTemplateId;
  subject: string;
  text: string;
  html: string;
}

export function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const PRODUCT = 'ERP Preflight';

function layout(title: string, paragraphs: string[], action?: { label: string; url: string }, footer?: string): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:#2563eb;color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;color:#555">If the button does not work, copy this link into your browser:<br><span style="word-break:break-all">${escapeHtml(action.url)}</span></p>`
    : '';
  const foot = footer ? `<p style="margin:24px 0 0;font-size:12px;color:#666">${escapeHtml(footer)}</p>` : '';
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;color:#111;background:#f6f7f9;padding:24px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:28px">
<h1 style="font-size:18px;margin:0 0 18px">${escapeHtml(title)}</h1>${body}${button}${foot}
<p style="margin:24px 0 0;font-size:11px;color:#888">${PRODUCT} — automated security message. Do not reply.</p>
</div></body></html>`;
}

function text(paragraphs: string[], action?: { label: string; url: string }, footer?: string): string {
  const parts = [...paragraphs];
  if (action) parts.push(`${action.label}: ${action.url}`);
  if (footer) parts.push(footer);
  parts.push(`— ${PRODUCT} (automated security message, do not reply)`);
  return parts.join('\n\n');
}

function render(
  template: MailTemplateId,
  subject: string,
  paragraphs: string[],
  action?: { label: string; url: string },
  footer?: string
): RenderedMail {
  return {
    template,
    subject,
    text: text(paragraphs, action, footer),
    html: layout(subject, paragraphs, action, footer),
  };
}

const greeting = (name?: string | null) => (name && name.trim() ? `Hello ${name.trim()},` : 'Hello,');

export function renderEmailVerification(p: { name?: string | null; url: string; expiresHours: number }): RenderedMail {
  return render(
    'EMAIL_VERIFICATION',
    `Verify your ${PRODUCT} e-mail address`,
    [
      greeting(p.name),
      `Please confirm that this address belongs to you. Until it is verified you can sign in, but analyses and report exports stay locked.`,
    ],
    { label: 'Verify e-mail address', url: p.url },
    `The link expires in ${p.expiresHours} hours and can be used once. If you did not create an account, ignore this message.`
  );
}

export function renderPasswordReset(p: { name?: string | null; url: string; expiresMinutes: number }): RenderedMail {
  return render(
    'PASSWORD_RESET',
    `Reset your ${PRODUCT} password`,
    [greeting(p.name), 'We received a request to reset the password of your account.'],
    { label: 'Choose a new password', url: p.url },
    `The link expires in ${p.expiresMinutes} minutes and can be used once. Resetting signs you out on every device. If you did not request this, ignore this message — your password stays unchanged.`
  );
}

export function renderMagicLink(p: { name?: string | null; url: string; expiresMinutes: number }): RenderedMail {
  return render(
    'MAGIC_LINK',
    `Your ${PRODUCT} sign-in link`,
    [greeting(p.name), 'Use the button below to sign in to your account. No password is needed.'],
    { label: 'Sign in to ERP Preflight', url: p.url },
    `The link expires in ${p.expiresMinutes} minutes and can be used once. If two-factor authentication is enabled, you will still be asked for your code. If you did not request this link, ignore this message — nobody can sign in without it.`
  );
}

export function renderPasswordChanged(p: { name?: string | null; when: string; resetUrl: string }): RenderedMail {
  return render(
    'PASSWORD_CHANGED',
    `Your ${PRODUCT} password was changed`,
    [
      greeting(p.name),
      `The password of your account was changed at ${p.when} (UTC). All other sessions were signed out.`,
      'If this was not you, reset your password immediately and contact your organization administrator.',
    ],
    { label: 'Reset password', url: p.resetUrl }
  );
}

export function renderInvitation(p: {
  organizationName: string;
  inviterName: string;
  role: string;
  url: string;
  expiresDays: number;
}): RenderedMail {
  return render(
    'ORGANIZATION_INVITATION',
    `You have been invited to ${p.organizationName} on ${PRODUCT}`,
    [
      'Hello,',
      `${p.inviterName} invited you to join the organization "${p.organizationName}" as ${p.role.replace(/_/g, ' ').toLowerCase()}.`,
    ],
    { label: 'Accept invitation', url: p.url },
    `The invitation expires in ${p.expiresDays} days and can be used once. If you do not expect this invitation, ignore this message.`
  );
}

export function renderTwoFactorChanged(p: { name?: string | null; enabled: boolean; when: string }): RenderedMail {
  return render(
    p.enabled ? 'TWO_FACTOR_ENABLED' : 'TWO_FACTOR_DISABLED',
    p.enabled
      ? `Two-factor authentication enabled on your ${PRODUCT} account`
      : `Two-factor authentication disabled on your ${PRODUCT} account`,
    [
      greeting(p.name),
      p.enabled
        ? `Two-factor authentication was enabled at ${p.when} (UTC). Store your recovery codes somewhere safe.`
        : `Two-factor authentication was disabled at ${p.when} (UTC).`,
      'All other sessions were signed out. If this was not you, reset your password immediately.',
    ]
  );
}

export function renderAccountDeleted(p: { name?: string | null; when: string; deletedOrganizations: string[] }): RenderedMail {
  const paragraphs = [
    greeting(p.name),
    `Your ${PRODUCT} account was deleted at ${p.when} (UTC). Your personal data has been anonymised and you have been removed from all organizations.`,
  ];
  if (p.deletedOrganizations.length > 0) {
    paragraphs.push(`The following organizations were deleted with all their data: ${p.deletedOrganizations.join(', ')}.`);
  }
  return render('ACCOUNT_DELETED', `Your ${PRODUCT} account was deleted`, paragraphs);
}
