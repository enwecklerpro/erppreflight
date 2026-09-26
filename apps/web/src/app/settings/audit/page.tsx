'use client';

import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { ChevronLeft, ChevronRight, Filter, ShieldCheck, ShieldX, X } from 'lucide-react';
import { SettingsNav } from '@/components/settings/settings-nav';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { ErrorState, InlineSpinner, SkeletonBlock } from '@/components/commercial/states';
import { fetchAuditLog, verifyAuditLedger, type AuditLogItem } from '@/lib/api/commercial';
import { useFmt, useRichT, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const PAGE_SIZE = 25;

const ACTION_GROUPS = [
  { value: '', key: 'all' },
  { value: 'auth.', key: 'auth' },
  { value: 'project.', key: 'project' },
  { value: 'artifact.', key: 'artifact' },
  { value: 'analysis.', key: 'analysis' },
  { value: 'report.', key: 'report' },
  { value: 'billing.', key: 'billing' },
  { value: 'api_key.', key: 'apiKey' },
  { value: 'webhook.', key: 'webhook' },
  { value: 'retention.', key: 'retention' },
  { value: 'support.', key: 'support' },
  { value: 'admin.', key: 'admin' },
  { value: 'organization.', key: 'organization' },
] as const;

const dateField = z
  .string()
  .regex(/^(\d{4}-\d{2}-\d{2})?$/, vmsg('app.validation.dateFormat'));

const FilterSchema = z
  .object({
    action: z.string().max(100).regex(/^[a-z0-9_.-]*$/i, vmsg('app.validation.actionFormat')),
    from: dateField,
    to: dateField,
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: vmsg('app.validation.dateRange'), path: ['to'] });

type Filters = z.infer<typeof FilterSchema>;

function isSecurityAction(action: string) {
  return action.startsWith('auth.') || action.startsWith('api_key.') || action.startsWith('webhook.') ||
    action.startsWith('admin.') || action.startsWith('support.') || action.includes('quarantined') ||
    action.includes('failed') || action.includes('denied');
}

function AuditLogInner() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const actionOptions = ACTION_GROUPS.map((g) => ({ value: g.value, label: t(`app.audit.groups.${g.key}`) }));
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters: Filters = {
    action: searchParams.get('action') ?? '',
    from: searchParams.get('from') ?? '',
    to: searchParams.get('to') ?? '',
  };
  // Keyset pagination: stack of cursors for the pages already visited.
  const [cursors, setCursors] = React.useState<Array<number | undefined>>([undefined]);
  const cursor = cursors[cursors.length - 1];
  React.useEffect(() => setCursors([undefined]), [filters.action, filters.from, filters.to]);

  const query = useQuery({
    queryKey: ['audit-log', filters, cursor],
    queryFn: () =>
      fetchAuditLog({
        action: filters.action || undefined,
        from: filters.from ? new Date(`${filters.from}T00:00:00Z`).toISOString() : undefined,
        to: filters.to ? new Date(`${filters.to}T23:59:59.999Z`).toISOString() : undefined,
        cursor,
        limit: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  const verify = useMutation({ mutationFn: verifyAuditLedger });

  const form = useForm({
    defaultValues: filters,
    validators: { onChange: FilterSchema, onSubmit: FilterSchema },
    onSubmit: ({ value }) => {
      const qs = new URLSearchParams();
      if (value.action) qs.set('action', value.action);
      if (value.from) qs.set('from', value.from);
      if (value.to) qs.set('to', value.to);
      router.replace(`${pathname}${qs.toString() ? `?${qs}` : ''}`, { scroll: false });
    },
  });

  const [expanded, setExpanded] = React.useState<string | null>(null);

  return (
    <div className="text-foreground">
      <div className="max-w-6xl mx-auto">
        <SettingsNav />
        <header className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('app.audit.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">{t('app.audit.subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => verify.mutate()}
            disabled={verify.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            {verify.isPending ? t('app.audit.verifying') : t('app.audit.verify')}
          </button>
        </header>

        <div aria-live="polite" className="mb-4">
          {verify.isError && <ErrorState title={t('app.audit.verifyFailed')} error={verify.error} onRetry={() => verify.mutate()} />}
          {verify.data &&
            (verify.data.isValid ? (
              <div role="status" data-testid="verify-result" className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm flex items-start gap-3">
                <ShieldCheck className="size-5 shrink-0" aria-hidden="true" />
                <p>
                  {rt('app.audit.intactRich', {
                    count: verify.data.totalEventsVerified,
                    date: fmt.dateTime(verify.data.verifiedAt),
                    b: (c) => <strong>{c}</strong>,
                  })}
                </p>
              </div>
            ) : (
              <div role="alert" data-testid="verify-result" className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
                <p className="font-semibold inline-flex items-center gap-2">
                  <ShieldX className="size-5" aria-hidden="true" /> {t('app.audit.anomalies', { count: verify.data.anomalies.length })}
                </p>
                <ul className="mt-2 space-y-1 text-xs font-mono break-all">
                  {verify.data.anomalies.slice(0, 20).map((a, i) => (
                    <li key={i}>
                      {t('app.audit.anomaly', {
                        type: a.anomalyType,
                        index: a.eventIndex,
                        id: a.eventId,
                        expected: String(a.expectedValue),
                        actual: String(a.actualValue),
                      })}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          noValidate
          className="rounded-xl border border-border bg-card p-4 mb-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] items-end"
          aria-label={t('app.audit.filterLabel')}
        >
          <form.Field
            name="action"
            children={(field) => (
              <FormField id="audit-action" name={field.name} label={t('app.audit.action')} error={field.state.meta.errors as any}>
                <FormSelect
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  options={actionOptions.some((g) => g.value === field.state.value)
                    ? actionOptions
                    : [...actionOptions, { value: field.state.value, label: field.state.value }]}
                />
              </FormField>
            )}
          />
          <form.Field
            name="from"
            children={(field) => (
              <FormField id="audit-from" name={field.name} label={t('app.audit.from')} error={field.state.meta.errors as any}>
                <FormInput type="date" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
              </FormField>
            )}
          />
          <form.Field
            name="to"
            children={(field) => (
              <FormField id="audit-to" name={field.name} label={t('app.audit.to')} error={field.state.meta.errors as any}>
                <FormInput type="date" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
              </FormField>
            )}
          />
          <div className="flex gap-2">
            <form.Subscribe
              selector={(s) => s.canSubmit}
              children={(canSubmit) => (
                <button
                  type="submit"
                  disabled={!canSubmit}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  <Filter className="size-4" aria-hidden="true" /> {t('app.audit.apply')}
                </button>
              )}
            />
            {(filters.action || filters.from || filters.to) && (
              <button
                type="button"
                onClick={() => {
                  form.reset({ action: '', from: '', to: '' });
                  router.replace(pathname, { scroll: false });
                }}
                className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted"
              >
                <X className="size-4" aria-hidden="true" /> {t('app.audit.clear')}
              </button>
            )}
          </div>
        </form>

        <section aria-labelledby="audit-table-heading" className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 id="audit-table-heading" className="text-sm font-semibold">
              {query.data ? t('app.audit.matching', { count: query.data.total }) : t('app.audit.events')}
            </h2>
            {query.isFetching && !query.isLoading && <InlineSpinner label={t('app.audit.refreshing')} />}
          </div>
          {query.isLoading ? (
            <div className="p-4 space-y-2" aria-busy="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-9" />
              ))}
            </div>
          ) : query.isError ? (
            <div className="p-4">
              <ErrorState title={t('app.audit.loadFailed')} error={query.error} onRetry={() => query.refetch()} />
            </div>
          ) : query.data && query.data.items.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {t('app.audit.empty')}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="audit-table">
                <thead>
                  <tr className="text-left text-muted-foreground border-b border-border">
                    <th scope="col" className="px-4 py-2 font-medium">#</th>
                    <th scope="col" className="px-4 py-2 font-medium">{t('app.audit.colTime')}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{t('app.audit.colAction')}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{t('app.audit.colActor')}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{t('app.audit.colTarget')}</th>
                    <th scope="col" className="px-4 py-2 font-medium">{t('app.audit.colDetails')}</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data?.items.map((item) => (
                    <AuditRow key={item.id} item={item} expanded={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <nav className="flex items-center justify-between px-4 py-3 border-t border-border" aria-label={t('app.audit.pagesLabel')}>
            <button
              type="button"
              onClick={() => setCursors((c) => c.slice(0, -1))}
              disabled={cursors.length <= 1}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              <ChevronLeft className="size-4" aria-hidden="true" /> {t('app.audit.newer')}
            </button>
            <span className="text-xs text-muted-foreground">{t('app.audit.page', { page: cursors.length })}</span>
            <button
              type="button"
              onClick={() => query.data?.nextCursor && setCursors((c) => [...c, query.data!.nextCursor!])}
              disabled={!query.data?.nextCursor}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            >
              {t('app.audit.older')} <ChevronRight className="size-4" aria-hidden="true" />
            </button>
          </nav>
        </section>
      </div>
    </div>
  );
}

function AuditRow({ item, expanded, onToggle }: { item: AuditLogItem; expanded: boolean; onToggle: () => void }) {
  const t = useT();
  const fmt = useFmt();
  const security = isSecurityAction(item.action);
  const outcome = typeof item.payload.outcome === 'string' ? item.payload.outcome : null;
  return (
    <>
      <tr className="border-b border-border/60 align-top">
        <td className="px-4 py-2 tabular-nums text-muted-foreground">{item.sequenceNum}</td>
        <td className="px-4 py-2 whitespace-nowrap">{fmt.dateTime(item.createdAt)}</td>
        <td className="px-4 py-2">
          <span className="font-mono text-xs">{item.action}</span>
          {security && (
            <span className="ml-2 inline-flex items-center gap-0.5 rounded border border-amber-500/50 px-1 text-[11px] font-semibold uppercase">
              <ShieldCheck className="size-3" aria-hidden="true" /> {t('app.audit.security')}
            </span>
          )}
          {outcome === 'FAILURE' && (
            <span className="ml-2 inline-flex items-center gap-0.5 rounded border border-destructive/50 px-1 text-[11px] font-semibold uppercase text-destructive">
              <ShieldX className="size-3" aria-hidden="true" /> {t('app.audit.failure')}
            </span>
          )}
        </td>
        <td className="px-4 py-2 text-xs">
          {item.actorEmail ?? item.actorType}
          {item.clientIp && <span className="block text-muted-foreground">{item.clientIp}</span>}
        </td>
        <td className="px-4 py-2 text-xs">
          {item.resourceType}
          {item.resourceId && <span className="block font-mono text-muted-foreground">{item.resourceId.slice(0, 8)}…</span>}
        </td>
        <td className="px-4 py-2">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded"
          >
            {expanded ? t('app.audit.hide') : t('app.audit.show')}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/60 bg-muted/30">
          <td colSpan={6} className="px-4 py-3">
            <pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(item.payload, null, 2)}</pre>
            <p className="mt-2 text-xs font-mono text-muted-foreground break-all">
              {t('app.audit.hashes', { hash: item.currentHash, prev: item.prevHash ?? '—' })}
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

export default function AuditLogPage() {
  return (
    <React.Suspense fallback={<div className="p-8"><SkeletonBlock className="h-40 max-w-6xl mx-auto" /></div>}>
      <AuditLogInner />
    </React.Suspense>
  );
}
