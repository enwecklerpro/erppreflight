'use client';

import * as React from 'react';
import { useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { KeyRound, LifeBuoy, Send, ShieldOff } from 'lucide-react';
import { SettingsNav } from '@/components/settings/settings-nav';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { ErrorState, Notice, SkeletonBlock, errorMessage } from '@/components/commercial/states';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { TICKET_CATEGORIES, createGrant, createTicket, fetchGrants, fetchMyTickets, revokeGrant, type TicketCategory } from '@/lib/api/support';

const CATEGORY_LABELS: Record<TicketCategory, string> = {
  QUESTION: 'Question',
  INCORRECT_FINDING: 'Report an incorrect finding',
  BUG: 'Bug',
  BILLING: 'Billing',
  ACCESS: 'Access / login',
};

const optionalUuid = z.string().trim().refine((v) => v === '' || /^[0-9a-f-]{36}$/i.test(v), 'Must be a UUID');

const TicketSchema = z
  .object({
    subject: z.string().trim().min(5, 'At least 5 characters').max(200),
    description: z.string().trim().min(10, 'At least 10 characters').max(10_000),
    category: z.enum(TICKET_CATEGORIES),
    findingId: optionalUuid,
    analysisId: optionalUuid,
    correlationId: z.string().trim().max(100).regex(/^[A-Za-z0-9_.:-]*$/, 'Letters, digits and . _ : - only'),
  })
  .refine((v) => v.category !== 'INCORRECT_FINDING' || v.findingId !== '', {
    message: 'Enter the finding id you believe is incorrect',
    path: ['findingId'],
  });

const GrantSchema = z.object({
  reason: z.string().trim().min(5, 'At least 5 characters').max(1000),
  hours: z.enum(['2', '8', '24', '72', '168']),
});

function Guard({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return <>{children}</>;
}

function TicketForm() {
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createTicket,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support', 'tickets'] });
      form.reset();
    },
  });
  const form = useForm({
    defaultValues: {
      subject: '',
      description: '',
      category: (params.get('findingId') ? 'INCORRECT_FINDING' : 'QUESTION') as TicketCategory,
      findingId: params.get('findingId') ?? '',
      analysisId: params.get('analysisId') ?? '',
      correlationId: params.get('correlationId') ?? '',
    },
    validators: { onChange: TicketSchema, onSubmit: TicketSchema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync({
        subject: value.subject,
        description: value.description,
        category: value.category,
        ...(value.findingId ? { findingId: value.findingId } : {}),
        ...(value.analysisId ? { analysisId: value.analysisId } : {}),
        ...(value.correlationId ? { correlationId: value.correlationId } : {}),
      });
    },
  });
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <Guard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="rounded-xl border border-border bg-card p-5 space-y-4"
            aria-labelledby="ticket-heading"
          >
            <h2 id="ticket-heading" className="text-base font-semibold inline-flex items-center gap-2">
              <LifeBuoy className="size-4" aria-hidden="true" /> Contact support
            </h2>
            <p className="text-sm text-muted-foreground">
              Tickets carry a sanitized diagnostic (ids, statuses, engine and rule identifiers) — never your artifact contents.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="category" children={(field) => (
                <FormField id="ticket-category" name={field.name} label="Category">
                  <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value as TicketCategory)} options={TICKET_CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABELS[c] }))} />
                </FormField>
              )} />
              <form.Field name="subject" children={(field) => (
                <FormField id="ticket-subject" name={field.name} label="Subject" required error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="description" children={(field) => (
                <FormField id="ticket-description" name={field.name} label="Description" required className="sm:col-span-2" error={field.state.meta.errors as any}>
                  <FormTextarea rows={4} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="findingId" children={(field) => (
                <FormField id="ticket-finding" name={field.name} label="Finding id (optional)" error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="analysisId" children={(field) => (
                <FormField id="ticket-analysis" name={field.name} label="Analysis id (optional)" error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
              <form.Field name="correlationId" children={(field) => (
                <FormField id="ticket-correlation" name={field.name} label="Error correlation id (optional)" description="Shown on error messages; helps us find the request." error={field.state.meta.errors as any}>
                  <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                </FormField>
              )} />
            </div>
            {create.isError && <ErrorState title="Ticket was not created" error={create.error} />}
            {create.isSuccess && !isDirty && <Notice tone="success" title="Ticket submitted">We will reply by e-mail. The ticket is listed below.</Notice>}
            <button type="submit" disabled={!canSubmit || isSubmitting} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              <Send className="size-4" aria-hidden="true" /> {isSubmitting ? 'Sending…' : 'Submit ticket'}
            </button>
          </form>
        </Guard>
      )}
    />
  );
}

function GrantsCard() {
  const queryClient = useQueryClient();
  const grants = useQuery({ queryKey: ['support', 'grants'], queryFn: fetchGrants, retry: false });
  const create = useMutation({
    mutationFn: createGrant,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support', 'grants'] });
      form.reset();
    },
  });
  const revoke = useMutation({ mutationFn: revokeGrant, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['support', 'grants'] }) });
  const form = useForm({
    defaultValues: { reason: '', hours: '24' as z.infer<typeof GrantSchema>['hours'] },
    validators: { onChange: GrantSchema, onSubmit: GrantSchema },
    onSubmit: async ({ value }) => {
      await create.mutateAsync({ reason: value.reason, hours: Number(value.hours) });
    },
  });

  return (
    <section className="rounded-xl border border-border bg-card p-5 space-y-4" aria-labelledby="grants-heading">
      <h2 id="grants-heading" className="text-base font-semibold inline-flex items-center gap-2">
        <KeyRound className="size-4" aria-hidden="true" /> Temporary support access
      </h2>
      <p className="text-sm text-muted-foreground">
        Allow ERP Preflight support to view this organization&apos;s metadata (projects, runs, usage, audit tail — not file contents) for a limited
        time. Every support look-up is written to your audit log. You can revoke access at any time.
      </p>
      {grants.isError ? (
        <ErrorState title="Support access is managed by owners and security admins" error={grants.error} />
      ) : (
        <>
          <form.Subscribe
            selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
            children={({ isDirty, isSubmitting, canSubmit }) => (
              <Guard isDirty={isDirty} isSubmitting={isSubmitting}>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    form.handleSubmit();
                  }}
                  noValidate
                  className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] items-end"
                >
                  <form.Field name="reason" children={(field) => (
                    <FormField id="grant-reason" name={field.name} label="Reason" required error={field.state.meta.errors as any}>
                      <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                    </FormField>
                  )} />
                  <form.Field name="hours" children={(field) => (
                    <FormField id="grant-hours" name={field.name} label="Duration">
                      <FormSelect
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value as any)}
                        options={[
                          { value: '2', label: '2 hours' },
                          { value: '8', label: '8 hours' },
                          { value: '24', label: '24 hours' },
                          { value: '72', label: '3 days' },
                          { value: '168', label: '7 days (maximum)' },
                        ]}
                      />
                    </FormField>
                  )} />
                  <button type="submit" disabled={!canSubmit || isSubmitting} className="h-9 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">
                    {isSubmitting ? 'Granting…' : 'Grant access'}
                  </button>
                </form>
              </Guard>
            )}
          />
          {create.isError && <ErrorState title="Access was not granted" error={create.error} />}
          {grants.isLoading ? (
            <SkeletonBlock className="h-16" />
          ) : grants.data && grants.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">No support access has been granted.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {grants.data?.map((g) => (
                <li key={g.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    <strong>{g.active ? 'Active' : g.revokedAt ? 'Revoked' : 'Expired'}</strong>
                    <span className="text-muted-foreground">
                      {' '}
                      · {g.reason} · until {new Date(g.expiresAt).toLocaleString()} · by {g.grantedByEmail ?? '—'}
                    </span>
                  </span>
                  {g.active && (
                    <button type="button" onClick={() => revoke.mutate(g.id)} disabled={revoke.isPending} className="inline-flex items-center gap-1 rounded border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                      <ShieldOff className="size-3.5" aria-hidden="true" /> Revoke
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {revoke.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(revoke.error)}</p>}
        </>
      )}
    </section>
  );
}

function SupportInner() {
  const tickets = useQuery({ queryKey: ['support', 'tickets'], queryFn: fetchMyTickets });
  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <SettingsNav />
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Support</h1>
        </header>
        <div className="space-y-6">
          <TicketForm />
          <section className="rounded-xl border border-border bg-card p-5" aria-labelledby="my-tickets">
            <h2 id="my-tickets" className="text-base font-semibold mb-3">Your organization&apos;s tickets</h2>
            {tickets.isLoading ? (
              <SkeletonBlock className="h-16" />
            ) : tickets.isError ? (
              <ErrorState title="Could not load tickets" error={tickets.error} onRetry={() => tickets.refetch()} />
            ) : tickets.data!.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tickets yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {tickets.data!.map((t) => (
                  <li key={t.id} className="py-2">
                    <strong>{t.subject}</strong>{' '}
                    <span className="text-muted-foreground">· {CATEGORY_LABELS[t.category as TicketCategory] ?? t.category} · {t.status} · {new Date(t.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <GrantsCard />
        </div>
      </div>
    </div>
  );
}

export default function SupportSettingsPage() {
  return (
    <React.Suspense fallback={<div className="p-8"><SkeletonBlock className="h-40 max-w-4xl mx-auto" /></div>}>
      <SupportInner />
    </React.Suspense>
  );
}
