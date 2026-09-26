'use client';

import * as React from 'react';
import type { Table } from '@tanstack/react-table';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Eye, Loader2, UserCheck, X } from 'lucide-react';
import type { Finding } from '@erppreflight/schemas';
import { useT } from '@/i18n/client';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { errorMessage } from '@/components/commercial/states';
import { queryKeys } from '@/lib/query/query-keys';
import {
  bulkFindingAction,
  fetchOrganizationMembers,
  findingLifecycleKeys,
  type BulkResult,
} from '@/lib/api/findings-lifecycle';

type Pending = 'ACKNOWLEDGE' | 'ASSIGN' | null;

/**
 * Bulk acknowledge / assign for the selected findings (Part 14.29). Every bulk
 * change goes through an explicit confirmation step; per-finding failures (e.g. an
 * invalid transition) are reported, never silently dropped.
 */
export function FindingsBulkActions({ table }: { table: Table<Finding> }) {
  const t = useT();
  const queryClient = useQueryClient();
  const selected = table.getFilteredSelectedRowModel().rows.map((r) => r.original);
  const [pending, setPending] = React.useState<Pending>(null);
  const [assigneeId, setAssigneeId] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const [reason, setReason] = React.useState('');
  const [result, setResult] = React.useState<BulkResult | null>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const members = useQuery({
    queryKey: findingLifecycleKeys.members,
    queryFn: fetchOrganizationMembers,
    enabled: pending === 'ASSIGN',
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: () =>
      bulkFindingAction({
        findingIds: selected.map((f) => f.id),
        action: pending as 'ACKNOWLEDGE' | 'ASSIGN',
        ...(pending === 'ASSIGN' ? { assigneeId: assigneeId || null, dueDate: dueDate || null } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      }),
    onSuccess: (res) => {
      setResult(res);
      setPending(null);
      setReason('');
      queryClient.invalidateQueries({ queryKey: queryKeys.findings.all });
      queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.all });
      if (res.failed === 0) table.resetRowSelection();
    },
  });

  React.useEffect(() => {
    if (pending) dialogRef.current?.querySelector<HTMLElement>('select, input, button')?.focus();
  }, [pending]);

  const count = selected.length;
  const failureDetail = result
    ? result.results
        .filter((r) => !r.ok)
        .slice(0, 3)
        .map((r) => (typeof r.error === 'string' ? r.error : Array.isArray(r.error) ? r.error.join(', ') : 'error'))
        .join('; ')
    : '';

  return (
    <div
      className="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-2xl border border-border/80 bg-card/95 px-4 py-3 shadow-2xl backdrop-blur-md"
      data-testid="findings-bulk-actions"
    >
      {!pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{t('findingLifecycle.table.selected', { count })}</span>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setPending('ACKNOWLEDGE');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <Eye className="size-3.5" aria-hidden="true" />
            {t('findingLifecycle.table.bulkAcknowledge')}
          </button>
          <button
            type="button"
            onClick={() => {
              setResult(null);
              setPending('ASSIGN');
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <UserCheck className="size-3.5" aria-hidden="true" />
            {t('findingLifecycle.table.bulkAssign')}
          </button>
          {result && (
            <span role="status" className="inline-flex items-center gap-1 text-xs text-foreground">
              <CheckCircle2 className="size-3.5" aria-hidden="true" />
              {t('findingLifecycle.table.bulkResult', { succeeded: result.succeeded, requested: result.requested })}
              {result.failed > 0 && (
                <span className="text-destructive">
                  {' '}
                  — {t('findingLifecycle.table.bulkFailures', { failed: result.failed, detail: failureDetail })}
                </span>
              )}
            </span>
          )}
          <button
            type="button"
            onClick={() => table.resetRowSelection()}
            className="ml-auto rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={t('findingLifecycle.table.clearSelection')}
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="bulk-confirm-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPending(null);
          }}
          className="space-y-2"
        >
          <p id="bulk-confirm-title" className="text-sm font-semibold text-foreground">
            {pending === 'ACKNOWLEDGE'
              ? t('findingLifecycle.table.bulkConfirmAcknowledge', { count })
              : t('findingLifecycle.table.bulkConfirmAssign', { count })}
          </p>
          {pending === 'ASSIGN' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <FormField id="bulk-assignee" label={t('findingLifecycle.assignment.assignee')}>
                <FormSelect
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                  disabled={members.isLoading}
                  options={[
                    { value: '', label: t('findingLifecycle.assignment.unassigned') },
                    ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName ? `${m.fullName} (${m.email})` : m.email })),
                  ]}
                />
              </FormField>
              <FormField id="bulk-due" label={t('findingLifecycle.assignment.dueDate')}>
                <FormInput type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </FormField>
            </div>
          )}
          <FormField id="bulk-reason" label={t('findingLifecycle.table.bulkReason')}>
            <FormInput value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} />
          </FormField>
          {members.isError && <p role="alert" className="text-xs text-destructive">{t('findingLifecycle.assignment.membersError')}</p>}
          {mutation.isError && <p role="alert" className="text-xs text-destructive">{errorMessage(mutation.error)}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {t('findingLifecycle.table.bulkCancel')}
            </button>
            <button
              type="button"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {mutation.isPending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {t('findingLifecycle.table.bulkConfirm')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
