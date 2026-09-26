'use client';

import * as React from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { LifeBuoy, MessageSquare, Send, UserRound } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { Notice, Pending, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { TICKET_STATUSES } from '@/lib/api/admin-ops';
import {
  adminReplyToTicket,
  fetchAdminTicketThread,
  fetchTicketMessages,
  replyToTicket,
  tenantAccessKeys,
  type TicketMessage,
} from '@/lib/api/tenant-access';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

export const TicketReplyFormSchema = z.object({
  body: z.string().trim().min(1, vmsg('app.validation.required')).max(10_000, vmsg('app.validation.maxChars', { max: 10_000 })),
  status: z.string(),
});

function MessageList({ messages, audience }: { messages: TicketMessage[]; audience: 'customer' | 'support' }) {
  const t = useT();
  const fmt = useFmt();
  if (messages.length === 0) {
    return <p className="text-sm text-muted-foreground">{audience === 'customer' ? t('app.tenantAccess.thread.empty') : t('app.tenantAccess.thread.emptyAdmin')}</p>;
  }
  return (
    <ol className="space-y-2" data-testid="ticket-messages">
      {messages.map((m) => {
        const fromSupport = m.authorRole === 'SUPPORT';
        const author = fromSupport ? t('app.tenantAccess.thread.support') : m.authorEmail ?? t('app.tenantAccess.thread.customer');
        return (
          <li key={m.id} className={`rounded-lg border p-3 text-sm ${fromSupport ? 'border-primary/30 bg-primary/5' : 'border-border bg-card'}`}>
            <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              {fromSupport ? <LifeBuoy className="size-3.5" aria-hidden="true" /> : <UserRound className="size-3.5" aria-hidden="true" />}
              <span className="font-semibold text-foreground break-all">{author}</span>
              <span>· {fmt.dateTime(m.createdAt)}</span>
            </p>
            <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
          </li>
        );
      })}
    </ol>
  );
}

function ReplyForm({
  idPrefix,
  withStatus,
  currentStatus,
  onSend,
  pending,
  error,
  sent,
}: {
  idPrefix: string;
  withStatus: boolean;
  currentStatus?: string;
  onSend: (value: { body: string; status: string }) => Promise<unknown>;
  pending: boolean;
  error: unknown;
  sent: boolean;
}) {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const form = useForm({
    defaultValues: { body: '', status: '' },
    validators: { onChange: TicketReplyFormSchema, onSubmit: TicketReplyFormSchema },
    onSubmit: async ({ value }) => {
      await onSend(value)
        .then(() => form.reset())
        .catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty, isSubmitting: pending });

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-2"
    >
      {sent && <Notice tone="success">{t('app.tenantAccess.thread.sent')}</Notice>}
      {!!error && (
        <Notice tone="error" title={t('app.tenantAccess.thread.sendFailed')}>
          {errText(error)}
        </Notice>
      )}
      <form.Field
        name="body"
        children={(f) => (
          <FormField id={`${idPrefix}-body`} name={f.name} label={t('app.tenantAccess.thread.reply')} required error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}>
            <FormTextarea
              rows={3}
              value={f.state.value}
              placeholder={t('app.tenantAccess.thread.replyPlaceholder')}
              onChange={(e) => f.handleChange(e.target.value)}
              onBlur={f.handleBlur}
            />
          </FormField>
        )}
      />
      <div className="flex flex-wrap items-end justify-end gap-2">
        {withStatus && (
          <form.Field
            name="status"
            children={(f) => (
              <FormField id={`${idPrefix}-status`} name={f.name} label={t('app.tenantAccess.thread.statusChange')}>
                <FormSelect
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value)}
                  options={[
                    { value: '', label: t('app.tenantAccess.thread.keepStatus') },
                    ...TICKET_STATUSES.filter((s) => s !== currentStatus).map((s) => ({ value: s, label: label('app.support.ticketStatus', s) })),
                  ]}
                />
              </FormField>
            )}
          />
        )}
        <form.Subscribe
          selector={(s) => [s.isSubmitting, s.isDirty] as const}
          children={([isSubmitting, dirty]) => (
            <button type="submit" className={buttonClass.primary} disabled={!dirty || isSubmitting || pending}>
              <Send className="size-3.5" aria-hidden="true" />
              <Pending busy={isSubmitting || pending} busyLabel={t('app.tenantAccess.thread.sending')} idle={t('app.tenantAccess.thread.send')} />
            </button>
          )}
        />
      </div>
    </form>
  );
}

function Toggle({ open, onToggle, controls }: { open: boolean; onToggle: () => void; controls: string }) {
  const t = useT();
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={controls} className={buttonClass.secondary}>
      <MessageSquare className="size-3.5" aria-hidden="true" />
      {open ? t('app.tenantAccess.thread.hide') : t('app.tenantAccess.thread.show')}
    </button>
  );
}

/** Customer side (Settings → Support): conversation of one ticket of the own organization. */
export function CustomerTicketThread({ ticketId }: { ticketId: string }) {
  const t = useT();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const panelId = `ticket-thread-${ticketId}`;
  const messages = useQuery({ queryKey: tenantAccessKeys.ticketMessages(ticketId), queryFn: () => fetchTicketMessages(ticketId), enabled: open });
  const reply = useMutation({
    mutationFn: (body: string) => replyToTicket(ticketId, body),
    onSuccess: () => {
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: tenantAccessKeys.ticketMessages(ticketId) });
      void queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
    },
  });
  return (
    <div className="mt-2 space-y-2">
      <Toggle open={open} onToggle={() => setOpen((v) => !v)} controls={panelId} />
      {open && (
        <div id={panelId} className="space-y-3 rounded-lg border border-border p-3" aria-label={t('app.tenantAccess.thread.title')} role="region">
          {messages.isPending ? (
            <SectionSkeleton rows={2} label={t('app.tenantAccess.thread.loading')} />
          ) : messages.isError ? (
            <Notice tone="error" title={t('app.tenantAccess.thread.loadFailed')}>
              {errText(messages.error)}
            </Notice>
          ) : (
            <MessageList messages={messages.data} audience="customer" />
          )}
          <ReplyForm
            idPrefix={`reply-${ticketId}`}
            withStatus={false}
            pending={reply.isPending}
            error={reply.error}
            sent={sent && !reply.isPending}
            onSend={(v) => {
              setSent(false);
              return reply.mutateAsync(v.body);
            }}
          />
        </div>
      )}
    </div>
  );
}

/** Operator side (Admin → Support): conversation, reply and optional status change. */
export function AdminTicketThread({ ticketId }: { ticketId: string }) {
  const t = useT();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const panelId = `admin-ticket-thread-${ticketId}`;
  const thread = useQuery({ queryKey: tenantAccessKeys.adminTicket(ticketId), queryFn: () => fetchAdminTicketThread(ticketId), enabled: open });
  const reply = useMutation({
    mutationFn: (v: { body: string; status: string }) => adminReplyToTicket(ticketId, v.body, v.status || undefined),
    onSuccess: () => {
      setSent(true);
      void queryClient.invalidateQueries({ queryKey: tenantAccessKeys.adminTicket(ticketId) });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'tickets'] });
    },
  });
  return (
    <div className="mt-1 space-y-2 basis-full">
      <Toggle open={open} onToggle={() => setOpen((v) => !v)} controls={panelId} />
      {open && (
        <div id={panelId} className="space-y-3 rounded-lg border border-border p-3" aria-label={t('app.tenantAccess.thread.title')} role="region">
          {thread.isPending ? (
            <SectionSkeleton rows={2} label={t('app.tenantAccess.thread.loading')} />
          ) : thread.isError ? (
            <Notice tone="error" title={t('app.tenantAccess.thread.loadFailed')}>
              {errText(thread.error)}
            </Notice>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">
                {t('app.tenantAccess.thread.requester', { email: thread.data.ticket.requesterEmail ?? '—' })} ·{' '}
                {t('app.tenantAccess.thread.language', {
                  language: thread.data.ticket.locale === 'de' ? t('app.tenantAccess.thread.languages.de') : t('app.tenantAccess.thread.languages.en'),
                })}
              </p>
              <MessageList messages={thread.data.messages} audience="support" />
              <ReplyForm
                idPrefix={`admin-reply-${ticketId}`}
                withStatus
                currentStatus={thread.data.ticket.status}
                pending={reply.isPending}
                error={reply.error}
                sent={sent && !reply.isPending}
                onSend={(v) => {
                  setSent(false);
                  return reply.mutateAsync(v);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
