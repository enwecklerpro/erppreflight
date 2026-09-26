'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  BookOpen,
  CalendarClock,
  Check,
  FlaskConical,
  History,
  Loader2,
  MessageSquare,
  Paperclip,
  Pencil,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import {
  FINDING_RISK_ROLES,
  FINDING_WRITE_ROLES,
  FINDING_COMMENT_ROLES,
  REASON_REQUIRED_STATUSES,
  RISK_STATUSES,
  SuppressionModeEnum,
  type FindingStatus,
  type SuppressionMode,
} from '@erppreflight/schemas';
import { useFormatter, useT } from '@/i18n/client';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { ErrorState, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ApiError } from '@/lib/api/custom-instance';
import { queryKeys } from '@/lib/query/query-keys';
import {
  addFindingComment,
  assignFinding,
  attachArtifactToFinding,
  deleteFindingComment,
  detachFindingAttachment,
  editFindingComment,
  fetchCleanProjectArtifacts,
  fetchCurrentUserRole,
  fetchLifecycleView,
  fetchOrganizationMembers,
  findingLifecycleKeys,
  generateRegressionTest,
  transitionFinding,
  type FindingWithLifecycle,
  type LifecycleView,
} from '@/lib/api/findings-lifecycle';
import { FindingStatusBadge } from './finding-status-badge';

const TODAY = () => new Date().toISOString().slice(0, 10);

function Guard({ dirty, submitting }: { dirty: boolean; submitting: boolean }) {
  useUnsavedChangesGuard({ isDirty: dirty, isSubmitting: submitting });
  return null;
}

function useFormatDate() {
  const format = useFormatter();
  return React.useCallback(
    (iso: string | null | undefined, withTime = true) => {
      if (!iso) return '—';
      const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
      if (Number.isNaN(d.getTime())) return iso;
      return withTime
        ? format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' })
        : format.dateTime(d, { dateStyle: 'medium' });
    },
    [format]
  );
}

function SectionTitle({ icon: Icon, children, id }: { icon: React.ComponentType<{ className?: string }>; children: React.ReactNode; id?: string }) {
  return (
    <h5 id={id} className="flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider text-foreground">
      <Icon className="size-3.5 text-primary" aria-hidden="true" />
      {children}
    </h5>
  );
}

// ---------------------------------------------------------------------------
// Evidence-first summary (Part 01 §1.8)
// ---------------------------------------------------------------------------

export function FindingEvidenceSummary({ finding }: { finding: FindingWithLifecycle }) {
  const t = useT();
  const fmt = useFormatDate();
  const lc = finding.lifecycle;
  const sources = (finding.evidence ?? []).filter((e) => e.sourceUrl || e.sourceTitle);
  const provenance = Array.from(new Set((finding.evidence ?? []).map((e) => e.provenance).filter(Boolean)));
  const na = t('findingLifecycle.evidenceCard.notRecorded');
  const facts: Array<[string, React.ReactNode]> = [
    [t('findingLifecycle.evidenceCard.targetRelease'), finding.targetRelease ?? na],
    [t('findingLifecycle.evidenceCard.firstDetected'), fmt(lc?.firstDetectedAt)],
    [t('findingLifecycle.evidenceCard.lastEvaluated'), fmt(lc?.lastEvaluatedAt)],
    [t('findingLifecycle.evidenceCard.detections'), String(lc?.detectionCount ?? 1)],
    [t('findingLifecycle.evidenceCard.engineVersion'), finding.engineVersion ?? na],
    [t('findingLifecycle.evidenceCard.ruleVersion'), finding.ruleVersion ?? na],
    [
      t('findingLifecycle.evidenceCard.knowledgeSnapshot'),
      finding.knowledgeSnapshotSeq != null
        ? t('findingLifecycle.evidenceCard.snapshotSeq', { seq: finding.knowledgeSnapshotSeq })
        : na,
    ],
    [t('findingLifecycle.evidenceCard.sourceArtifact'), finding.sourceFileName ?? na],
  ];
  return (
    <section aria-label={t('findingLifecycle.evidenceCard.whyItMatters')} className="rounded-lg border border-border bg-muted/10 p-3 space-y-3">
      <div>
        <SectionTitle icon={BookOpen}>{t('findingLifecycle.evidenceCard.whyItMatters')}</SectionTitle>
        <p className="mt-1.5 text-xs leading-relaxed text-foreground">{finding.description}</p>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4 text-[11px]">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="font-mono font-semibold text-foreground truncate" title={typeof value === 'string' ? value : undefined}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      <div className="text-[11px]">
        <p className="text-muted-foreground">{t('findingLifecycle.evidenceCard.provenance')}</p>
        {sources.length > 0 ? (
          <ul className="mt-1 space-y-0.5">
            {sources.map((s, i) => (
              <li key={i}>
                {s.sourceUrl ? (
                  <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
                    {s.sourceTitle ?? s.sourceUrl}
                  </a>
                ) : (
                  <span className="text-foreground">{s.sourceTitle}</span>
                )}{' '}
                <span className="text-muted-foreground">({s.provenance})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-foreground">
            {t('findingLifecycle.evidenceCard.noOfficialSource')}
            {provenance.length > 0 && <span className="text-muted-foreground"> ({provenance.join(', ')})</span>}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lifecycle panel
// ---------------------------------------------------------------------------

export function FindingLifecyclePanel({ finding }: { finding: FindingWithLifecycle }) {
  const t = useT();
  const queryClient = useQueryClient();
  const view = useQuery({
    queryKey: findingLifecycleKeys.view(finding.id),
    queryFn: () => fetchLifecycleView(finding.id),
    retry: 1,
    staleTime: 15_000,
  });
  const me = useQuery({ queryKey: findingLifecycleKeys.currentUser, queryFn: fetchCurrentUserRole, staleTime: 5 * 60_000, retry: 1 });

  const applyView = React.useCallback(
    (next: LifecycleView) => {
      queryClient.setQueryData(findingLifecycleKeys.view(finding.id), next);
      queryClient.invalidateQueries({ queryKey: queryKeys.findings.all });
    },
    [queryClient, finding.id]
  );

  if (view.isLoading) {
    return (
      <div className="space-y-2" role="status" aria-label={t('findingLifecycle.panel.loading')}>
        <SkeletonBlock className="h-10 w-full" />
        <SkeletonBlock className="h-24 w-full" />
      </div>
    );
  }
  if (view.isError || !view.data) {
    return <ErrorState title={t('findingLifecycle.panel.error')} error={view.error} onRetry={() => view.refetch()} />;
  }

  const role = me.data?.role ?? null;
  const isSuper = me.data?.systemRole === 'SUPER_ADMIN';
  const can = (roles: readonly string[]) => isSuper || (role !== null && roles.includes(role));

  return (
    <div className="space-y-4" data-testid="finding-lifecycle-panel">
      <StatusSection
        findingId={finding.id}
        view={view.data}
        canWrite={can(FINDING_WRITE_ROLES)}
        canRisk={can(FINDING_RISK_ROLES)}
        onApplied={applyView}
        onConflict={() => view.refetch()}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AssignmentSection findingId={finding.id} view={view.data} canWrite={can(FINDING_WRITE_ROLES)} onApplied={applyView} />
        <RegressionTestSection finding={finding} view={view.data} canWrite={can(FINDING_WRITE_ROLES)} onCreated={() => view.refetch()} />
      </div>
      <CommentsSection
        findingId={finding.id}
        view={view.data}
        canComment={can(FINDING_COMMENT_ROLES)}
        currentUserId={me.data?.id ?? null}
        onApplied={applyView}
      />
      <AttachmentsSection finding={finding} view={view.data} canWrite={can(FINDING_WRITE_ROLES)} onApplied={applyView} />
      <HistoryTimeline view={view.data} />
    </div>
  );
}

// --------------------------------------------------------------------------- status

const TransitionSchema = z
  .object({
    status: z.string(),
    reason: z.string().trim().max(2000),
    mode: SuppressionModeEnum,
    until: z.string(),
    release: z.string().trim().max(50),
  });

function StatusSection({
  findingId,
  view,
  canWrite,
  canRisk,
  onApplied,
  onConflict,
}: {
  findingId: string;
  view: LifecycleView;
  canWrite: boolean;
  canRisk: boolean;
  onApplied: (v: LifecycleView) => void;
  onConflict: () => void;
}) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const fmt = useFormatDate();
  const lc = view.lifecycle;
  const [target, setTarget] = React.useState<FindingStatus | null>(null);
  const [conflict, setConflict] = React.useState(false);
  const mutation = useMutation({
    mutationFn: (input: Parameters<typeof transitionFinding>[1]) => transitionFinding(findingId, input),
    onSuccess: (next) => {
      onApplied(next);
      setTarget(null);
      form.reset();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.statusCode === 409) {
        setConflict(true);
        onConflict();
      }
    },
  });
  const form = useForm({
    defaultValues: { status: '', reason: '', mode: 'PERMANENT' as SuppressionMode, until: '', release: lc.lastTargetRelease ?? '' },
    validators: {
      onSubmit: TransitionSchema.superRefine((v, ctx) => {
        if (REASON_REQUIRED_STATUSES.includes(v.status as FindingStatus) && v.reason.length < 10) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: t('findingLifecycle.actions.reasonTooShort') });
        }
        if (v.status === 'SUPPRESSED' && v.mode === 'UNTIL_DATE' && !v.until) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['until'], message: t('findingLifecycle.actions.dateRequired') });
        }
      }),
    },
    onSubmit: async ({ value }) => {
      setConflict(false);
      const status = value.status as FindingStatus;
      await mutation.mutateAsync({
        status,
        ...(value.reason ? { reason: value.reason } : {}),
        expectedRevision: lc.revision,
        ...(status === 'SUPPRESSED'
          ? {
              suppression: {
                mode: value.mode,
                ...(value.mode === 'UNTIL_DATE' ? { until: value.until } : {}),
                ...(value.mode === 'UNTIL_RELEASE' && value.release ? { release: value.release } : {}),
              },
            }
          : {}),
      });
    },
  });

  const open = (s: FindingStatus) => {
    setTarget(s);
    setConflict(false);
    mutation.reset();
    form.reset();
    form.setFieldValue('status', s);
  };

  const suppressionText = lc.suppression
    ? lc.suppression.mode === 'UNTIL_DATE' && lc.suppression.until
      ? t('findingLifecycle.suppression.activeUntil', { date: fmt(lc.suppression.until, false) })
      : lc.suppression.mode === 'UNTIL_RELEASE' && lc.suppression.release
      ? t('findingLifecycle.suppression.activeRelease', { release: lc.suppression.release })
      : t('findingLifecycle.suppression.active', {
          mode: t(`findingLifecycle.suppression.${lc.suppression.mode as SuppressionMode}`),
        })
    : null;

  return (
    <section aria-labelledby={`status-${findingId}`} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle icon={Check} id={`status-${findingId}`}>
          {t('findingLifecycle.actions.heading')}
        </SectionTitle>
        <FindingStatusBadge status={lc.status} />
      </div>
      {(lc.statusReason || suppressionText) && (
        <p className="text-[11px] text-muted-foreground">
          {suppressionText && <span className="font-semibold text-foreground">{suppressionText}. </span>}
          {lc.statusReason}
        </p>
      )}
      {conflict && (
        <p role="alert" className="text-[11px] font-medium text-amber-700 dark:text-amber-300">
          {t('findingLifecycle.actions.conflict')}
        </p>
      )}
      {!target && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('findingLifecycle.actions.heading')}>
          {lc.allowedTransitions.length === 0 && (
            <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.actions.noTransitions')}</p>
          )}
          {lc.allowedTransitions.map((s) => {
            const allowed = RISK_STATUSES.includes(s) ? canRisk : canWrite;
            return (
              <button
                key={s}
                type="button"
                disabled={!allowed}
                onClick={() => open(s)}
                data-transition={s}
                title={!allowed ? t('findingLifecycle.actions.roleHint') : undefined}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t(`findingLifecycle.actions.${s as Exclude<FindingStatus, 'REGRESSION_TEST_CREATED'>}`)}
              </button>
            );
          })}
        </div>
      )}
      {!canRisk && lc.allowedTransitions.some((s) => RISK_STATUSES.includes(s)) && !target && (
        <p className="text-[10px] text-muted-foreground">{t('findingLifecycle.actions.roleHint')}</p>
      )}
      {target && (
        <form.Subscribe
          selector={(s) => ({ dirty: s.isDirty, submitting: s.isSubmitting, mode: s.values.mode })}
          children={({ dirty, submitting, mode }) => (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setTarget(null);
              }}
              className="space-y-2 rounded-lg border border-border bg-background p-3"
              aria-label={t('findingLifecycle.actions.confirm', { status: t(`findingLifecycle.status.${target}`) })}
            >
              <Guard dirty={dirty} submitting={submitting} />
              <form.Field
                name="reason"
                children={(field) => (
                  <FormField
                    id={`reason-${findingId}`}
                    name={field.name}
                    label={t('findingLifecycle.actions.reasonLabel')}
                    required={REASON_REQUIRED_STATUSES.includes(target)}
                    description={
                      REASON_REQUIRED_STATUSES.includes(target)
                        ? t('findingLifecycle.actions.reasonRequired')
                        : t('findingLifecycle.actions.reasonOptional')
                    }
                    error={field.state.meta.errors as never}
                  >
                    <FormTextarea
                      rows={2}
                      autoFocus
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormField>
                )}
              />
              {target === 'SUPPRESSED' && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <form.Field
                    name="mode"
                    children={(field) => (
                      <FormField id={`mode-${findingId}`} name={field.name} label={t('findingLifecycle.suppression.modeLabel')} required>
                        <FormSelect
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value as SuppressionMode)}
                          options={SuppressionModeEnum.options.map((m) => ({ value: m, label: t(`findingLifecycle.suppression.${m}`) }))}
                        />
                      </FormField>
                    )}
                  />
                  {mode === 'UNTIL_DATE' && (
                    <form.Field
                      name="until"
                      children={(field) => (
                        <FormField id={`until-${findingId}`} name={field.name} label={t('findingLifecycle.suppression.untilLabel')} required error={field.state.meta.errors as never}>
                          <FormInput type="date" min={TODAY()} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                        </FormField>
                      )}
                    />
                  )}
                  {mode === 'UNTIL_RELEASE' && (
                    <form.Field
                      name="release"
                      children={(field) => (
                        <FormField id={`release-${findingId}`} name={field.name} label={t('findingLifecycle.suppression.releaseLabel')}>
                          <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} isMono />
                        </FormField>
                      )}
                    />
                  )}
                </div>
              )}
              {mutation.isError && !(mutation.error instanceof ApiError && mutation.error.statusCode === 409) && (
                <p role="alert" className="text-[11px] font-medium text-destructive">
                  {errorMessage(mutation.error)}
                </p>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setTarget(null)}
                  className="rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {t('findingLifecycle.actions.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Check className="size-3" aria-hidden="true" />}
                  {submitting
                    ? t('findingLifecycle.actions.saving')
                    : t('findingLifecycle.actions.confirm', { status: t(`findingLifecycle.status.${target}`) })}
                </button>
              </div>
            </form>
          )}
        />
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- assignment

function AssignmentSection({
  findingId,
  view,
  canWrite,
  onApplied,
}: {
  findingId: string;
  view: LifecycleView;
  canWrite: boolean;
  onApplied: (v: LifecycleView) => void;
}) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const fmt = useFormatDate();
  const members = useQuery({ queryKey: findingLifecycleKeys.members, queryFn: fetchOrganizationMembers, staleTime: 60_000, retry: 1 });
  const lc = view.lifecycle;
  const mutation = useMutation({
    mutationFn: (v: { assigneeId: string; dueDate: string }) =>
      assignFinding(findingId, { assigneeId: v.assigneeId || null, dueDate: v.dueDate || null }),
    onSuccess: (next) => {
      onApplied(next);
      form.reset({ assigneeId: next.lifecycle.assigneeId ?? '', dueDate: next.lifecycle.dueDate ?? '' });
    },
  });
  const form = useForm({
    defaultValues: { assigneeId: lc.assigneeId ?? '', dueDate: lc.dueDate ?? '' },
    validators: { onSubmit: z.object({ assigneeId: z.string(), dueDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/) }) },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value);
    },
  });
  const overdue =
    lc.dueDate && lc.dueDate < TODAY() && !['RESOLVED', 'FALSE_POSITIVE', 'ACCEPTED_RISK', 'SUPPRESSED'].includes(lc.status);

  return (
    <section aria-labelledby={`assign-${findingId}`} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <SectionTitle icon={UserCheck} id={`assign-${findingId}`}>
        {t('findingLifecycle.assignment.heading')}
      </SectionTitle>
      <p className="text-[11px] text-foreground">
        {lc.assignee ? lc.assignee.fullName || lc.assignee.email : t('findingLifecycle.assignment.unassigned')}
        {' · '}
        {lc.dueDate ? fmt(lc.dueDate, false) : t('findingLifecycle.assignment.noDueDate')}
        {overdue && (
          <span className="ml-1.5 inline-flex items-center gap-0.5 font-semibold text-destructive">
            <CalendarClock className="size-3" aria-hidden="true" />
            {t('findingLifecycle.assignment.overdue')}
          </span>
        )}
      </p>
      {members.isError && <p role="alert" className="text-[11px] text-destructive">{t('findingLifecycle.assignment.membersError')}</p>}
      {canWrite && (
        <form.Subscribe
          selector={(s) => ({ dirty: s.isDirty, submitting: s.isSubmitting })}
          children={({ dirty, submitting }) => (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Guard dirty={dirty} submitting={submitting} />
              <form.Field
                name="assigneeId"
                children={(field) => (
                  <FormField id={`assignee-${findingId}`} name={field.name} label={t('findingLifecycle.assignment.assignee')}>
                    <FormSelect
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={members.isLoading}
                      options={[
                        { value: '', label: t('findingLifecycle.assignment.unassigned') },
                        ...(members.data ?? []).map((m) => ({ value: m.userId, label: m.fullName ? `${m.fullName} (${m.email})` : m.email })),
                      ]}
                    />
                  </FormField>
                )}
              />
              <form.Field
                name="dueDate"
                children={(field) => (
                  <FormField id={`due-${findingId}`} name={field.name} label={t('findingLifecycle.assignment.dueDate')} error={field.state.meta.errors as never}>
                    <FormInput type="date" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
                  </FormField>
                )}
              />
              {mutation.isError && (
                <p role="alert" className="sm:col-span-2 text-[11px] font-medium text-destructive">
                  {errorMessage(mutation.error)}
                </p>
              )}
              <div className="sm:col-span-2 flex items-center justify-end gap-2">
                {mutation.isSuccess && !dirty && (
                  <span role="status" className="text-[11px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1">
                    <Check className="size-3" aria-hidden="true" />
                    {t('findingLifecycle.assignment.saved')}
                  </span>
                )}
                <button
                  type="submit"
                  disabled={!dirty || submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting && <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                  {t('findingLifecycle.assignment.save')}
                </button>
              </div>
            </form>
          )}
        />
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- comments

function CommentsSection({
  findingId,
  view,
  canComment,
  currentUserId,
  onApplied,
}: {
  findingId: string;
  view: LifecycleView;
  canComment: boolean;
  currentUserId: string | null;
  onApplied: (v: LifecycleView) => void;
}) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const fmt = useFormatDate();
  const [editing, setEditing] = React.useState<{ id: string; body: string } | null>(null);
  const bodySchema = z
    .string()
    .trim()
    .min(1, t('findingLifecycle.comments.required'))
    .max(5000, t('findingLifecycle.comments.tooLong'));
  const add = useMutation({
    mutationFn: (body: string) => addFindingComment(findingId, body),
    onSuccess: (next) => {
      onApplied(next);
      form.reset();
    },
  });
  const edit = useMutation({
    mutationFn: (v: { id: string; body: string }) => editFindingComment(findingId, v.id, v.body),
    onSuccess: (next) => {
      onApplied(next);
      setEditing(null);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFindingComment(findingId, id),
    onSuccess: onApplied,
  });
  const form = useForm({
    defaultValues: { body: '' },
    validators: { onSubmit: z.object({ body: bodySchema }) },
    onSubmit: async ({ value }) => {
      await add.mutateAsync(value.body.trim());
    },
  });

  return (
    <section aria-labelledby={`comments-${findingId}`} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <SectionTitle icon={MessageSquare} id={`comments-${findingId}`}>
        {t('findingLifecycle.comments.heading')} ({view.comments.filter((c) => !c.deleted).length})
      </SectionTitle>
      {view.comments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.comments.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {view.comments.map((c) => (
            <li key={c.id} className="rounded-md border border-border/70 bg-background p-2 text-xs" data-comment-id={c.id}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
                <span>
                  <span className="font-semibold text-foreground">{c.author?.fullName || c.author?.email || '—'}</span> · {fmt(c.createdAt)}
                  {c.editedAt && !c.deleted && ` · ${t('findingLifecycle.comments.edited')}`}
                </span>
                {!c.deleted && c.author?.id === currentUserId && editing?.id !== c.id && (
                  <span className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setEditing({ id: c.id, body: c.body ?? '' })}
                      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <Pencil className="size-3" aria-hidden="true" />
                      {t('findingLifecycle.comments.edit')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(t('findingLifecycle.comments.deleteConfirm'))) remove.mutate(c.id);
                      }}
                      className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 hover:bg-muted hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                    >
                      <Trash2 className="size-3" aria-hidden="true" />
                      {t('findingLifecycle.comments.delete')}
                    </button>
                  </span>
                )}
              </div>
              {c.deleted ? (
                <p className="mt-1 italic text-muted-foreground">{t('findingLifecycle.comments.deleted')}</p>
              ) : editing?.id === c.id ? (
                <div className="mt-1 space-y-1.5">
                  <FormTextarea
                    aria-label={t('findingLifecycle.comments.edit')}
                    rows={2}
                    value={editing.body}
                    onChange={(e) => setEditing({ id: c.id, body: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setEditing(null);
                    }}
                  />
                  <Guard dirty={editing.body !== c.body} submitting={edit.isPending} />
                  {edit.isError && <p role="alert" className="text-[11px] text-destructive">{errorMessage(edit.error)}</p>}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setEditing(null)} className="text-[11px] text-muted-foreground hover:text-foreground">
                      {t('findingLifecycle.comments.cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={!bodySchema.safeParse(editing.body).success || edit.isPending}
                      onClick={() => edit.mutate({ id: c.id, body: editing.body.trim() })}
                      className="rounded-md bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground disabled:opacity-50"
                    >
                      {t('findingLifecycle.comments.save')}
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 whitespace-pre-wrap break-words text-foreground">{c.body}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {remove.isError && <p role="alert" className="text-[11px] text-destructive">{errorMessage(remove.error)}</p>}
      {canComment && (
        <form.Subscribe
          selector={(s) => ({ dirty: s.isDirty, submitting: s.isSubmitting })}
          children={({ dirty, submitting }) => (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                form.handleSubmit();
              }}
              className="space-y-1.5"
            >
              <Guard dirty={dirty} submitting={submitting} />
              <form.Field
                name="body"
                children={(field) => (
                  <FormField id={`comment-${findingId}`} name={field.name} label={t('findingLifecycle.comments.label')} error={field.state.meta.errors as never}>
                    <FormTextarea
                      rows={2}
                      placeholder={t('findingLifecycle.comments.placeholder')}
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                    />
                  </FormField>
                )}
              />
              {add.isError && <p role="alert" className="text-[11px] text-destructive">{errorMessage(add.error)}</p>}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {submitting ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <MessageSquare className="size-3" aria-hidden="true" />}
                  {t('findingLifecycle.comments.submit')}
                </button>
              </div>
            </form>
          )}
        />
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- attachments

function AttachmentsSection({
  finding,
  view,
  canWrite,
  onApplied,
}: {
  finding: FindingWithLifecycle;
  view: LifecycleView;
  canWrite: boolean;
  onApplied: (v: LifecycleView) => void;
}) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const projectId = finding.projectId ?? view.lifecycle.projectId;
  const [fileId, setFileId] = React.useState('');
  const files = useQuery({
    queryKey: findingLifecycleKeys.projectFiles(projectId),
    queryFn: () => fetchCleanProjectArtifacts(projectId),
    enabled: canWrite && Boolean(projectId),
    staleTime: 30_000,
  });
  const attach = useMutation({
    mutationFn: () => attachArtifactToFinding(finding.id, fileId),
    onSuccess: (next) => {
      onApplied(next);
      setFileId('');
    },
  });
  const detach = useMutation({
    mutationFn: (id: string) => detachFindingAttachment(finding.id, id),
    onSuccess: onApplied,
  });
  const attachedIds = new Set(view.attachments.map((a) => a.fileId));
  const options = (files.data ?? []).filter((f) => !attachedIds.has(f.id));

  return (
    <section aria-labelledby={`attach-${finding.id}`} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <SectionTitle icon={Paperclip} id={`attach-${finding.id}`}>
        {t('findingLifecycle.attachments.heading')} ({view.attachments.length})
      </SectionTitle>
      {view.attachments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.attachments.empty')}</p>
      ) : (
        <ul className="divide-y divide-border/60 rounded-md border border-border bg-background text-[11px]">
          {view.attachments.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
              <span className="min-w-0">
                <span className="font-mono font-semibold text-foreground">{a.fileName}</span>{' '}
                <span className="text-muted-foreground">SHA-256 {a.checksumSha256.slice(0, 12)}… · {a.quarantineStatus}</span>
              </span>
              {canWrite && (
                <button
                  type="button"
                  onClick={() => detach.mutate(a.id)}
                  className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <X className="size-3" aria-hidden="true" />
                  {t('findingLifecycle.attachments.remove')}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="space-y-1">
          <p className="text-[10px] text-muted-foreground">{t('findingLifecycle.attachments.explain')}</p>
          {files.isSuccess && files.data.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.attachments.none')}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1">
                <FormField id={`attach-file-${finding.id}`} label={t('findingLifecycle.attachments.select')}>
                  <FormSelect
                    value={fileId}
                    onChange={(e) => setFileId(e.target.value)}
                    disabled={files.isLoading}
                    options={[{ value: '', label: t('findingLifecycle.attachments.choose') }, ...options.map((f) => ({ value: f.id, label: f.fileName }))]}
                  />
                </FormField>
              </div>
              <button
                type="button"
                disabled={!fileId || attach.isPending}
                onClick={() => attach.mutate()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-[11px] font-semibold hover:bg-muted disabled:opacity-50"
              >
                <Paperclip className="size-3" aria-hidden="true" />
                {t('findingLifecycle.attachments.attach')}
              </button>
            </div>
          )}
          {(attach.isError || detach.isError) && (
            <p role="alert" className="text-[11px] text-destructive">
              {errorMessage(attach.error ?? detach.error)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- regression tests

function RegressionTestSection({
  finding,
  view,
  canWrite,
  onCreated,
}: {
  finding: FindingWithLifecycle;
  view: LifecycleView;
  canWrite: boolean;
  onCreated: () => void;
}) {
  // Localized API error text (codes → EN/DE dictionary).
  const errorMessage = useCommercialErrorText();
  const t = useT();
  const queryClient = useQueryClient();
  const projectId = finding.projectId ?? view.lifecycle.projectId;
  const [expected, setExpected] = React.useState<'FINDING_ABSENT' | 'FINDING_PRESENT'>('FINDING_ABSENT');
  const create = useMutation({
    mutationFn: () => generateRegressionTest({ findingId: finding.id, expectedOutcome: expected }),
    onSuccess: () => {
      onCreated();
      queryClient.invalidateQueries({ queryKey: queryKeys.findings.all });
      queryClient.invalidateQueries({ queryKey: findingLifecycleKeys.regressionTests(projectId) });
    },
  });
  return (
    <section aria-labelledby={`tests-${finding.id}`} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <SectionTitle icon={FlaskConical} id={`tests-${finding.id}`}>
        {t('findingLifecycle.tests.heading')} ({view.regressionTests.length})
      </SectionTitle>
      {view.regressionTests.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.tests.empty')}</p>
      ) : (
        <ul className="space-y-1 text-[11px]">
          {view.regressionTests.map((rt) => (
            <li key={rt.id} className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-foreground">{rt.title}</span>
              <span className="text-muted-foreground">
                v{rt.fixtureVersion} · {rt.lastRunStatus ?? '—'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canWrite && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[200px] flex-1">
            <FormField id={`expected-${finding.id}`} label={t('findingLifecycle.tests.expectedLabel')}>
              <FormSelect
                value={expected}
                onChange={(e) => setExpected(e.target.value as typeof expected)}
                options={[
                  { value: 'FINDING_ABSENT', label: t('findingLifecycle.tests.FINDING_ABSENT') },
                  { value: 'FINDING_PRESENT', label: t('findingLifecycle.tests.FINDING_PRESENT') },
                ]}
              />
            </FormField>
          </div>
          <button
            type="button"
            disabled={create.isPending}
            onClick={() => create.mutate()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {create.isPending ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FlaskConical className="size-3" aria-hidden="true" />}
            {t('findingLifecycle.tests.generate')}
          </button>
        </div>
      )}
      {create.isError && <p role="alert" className="text-[11px] text-destructive">{errorMessage(create.error)}</p>}
      {create.isSuccess && (
        <p role="status" className="text-[11px] text-emerald-700 dark:text-emerald-300">
          {t('findingLifecycle.tests.created')}{' '}
          <Link href={`/projects/${projectId}/lab`} className="font-semibold underline underline-offset-2">
            {t('findingLifecycle.tests.openLab')}
          </Link>
        </p>
      )}
    </section>
  );
}

// --------------------------------------------------------------------------- history

function HistoryTimeline({ view }: { view: LifecycleView }) {
  const t = useT();
  const fmt = useFormatDate();
  const label = (s: string | null) =>
    s && s in FINDING_STATUS_LABEL_KEYS ? t(FINDING_STATUS_LABEL_KEYS[s as FindingStatus]) : s ?? '—';
  return (
    <section aria-label={t('findingLifecycle.history.heading')} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
      <SectionTitle icon={History}>{t('findingLifecycle.history.heading')}</SectionTitle>
      {view.history.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{t('findingLifecycle.history.empty')}</p>
      ) : (
        <ol className="relative space-y-2 border-l border-border pl-4 text-[11px]" data-testid="finding-history">
          {view.history.map((h) => (
            <li key={h.id} className="relative" data-history-event={h.event}>
              <span className="absolute -left-[21px] top-1 size-2 rounded-full border border-background bg-primary" aria-hidden="true" />
              <p className="text-foreground">
                <span className="font-semibold">
                  {h.event in HISTORY_EVENT_KEYS ? t(HISTORY_EVENT_KEYS[h.event as keyof typeof HISTORY_EVENT_KEYS]) : h.event}
                </span>
                {' · '}
                {h.fromStatus && h.fromStatus !== h.toStatus
                  ? t('findingLifecycle.history.transition', { from: label(h.fromStatus), to: label(h.toStatus) })
                  : label(h.toStatus)}
              </p>
              <p className="text-muted-foreground">
                {fmt(h.createdAt)} · {h.actorKind === 'SYSTEM' ? t('findingLifecycle.history.system') : h.actor?.fullName || h.actor?.email || '—'}
              </p>
              {h.reason && <p className="text-foreground/90 break-words">{h.reason}</p>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const FINDING_STATUS_LABEL_KEYS = {
  OPEN: 'findingLifecycle.status.OPEN',
  ACKNOWLEDGED: 'findingLifecycle.status.ACKNOWLEDGED',
  ACCEPTED_RISK: 'findingLifecycle.status.ACCEPTED_RISK',
  FALSE_POSITIVE: 'findingLifecycle.status.FALSE_POSITIVE',
  RESOLVED: 'findingLifecycle.status.RESOLVED',
  REGRESSION_TEST_CREATED: 'findingLifecycle.status.REGRESSION_TEST_CREATED',
  SUPPRESSED: 'findingLifecycle.status.SUPPRESSED',
} as const;

const HISTORY_EVENT_KEYS = {
  DETECTED: 'findingLifecycle.history.events.DETECTED',
  STATUS_CHANGED: 'findingLifecycle.history.events.STATUS_CHANGED',
  CARRIED_OVER: 'findingLifecycle.history.events.CARRIED_OVER',
  REOPENED: 'findingLifecycle.history.events.REOPENED',
  SUPPRESSION_LAPSED: 'findingLifecycle.history.events.SUPPRESSION_LAPSED',
  DECISION_LAPSED: 'findingLifecycle.history.events.DECISION_LAPSED',
  AUTO_RESOLVED: 'findingLifecycle.history.events.AUTO_RESOLVED',
  RESOLVED_BY_TEST: 'findingLifecycle.history.events.RESOLVED_BY_TEST',
  REGRESSION_TEST_CREATED: 'findingLifecycle.history.events.REGRESSION_TEST_CREATED',
} as const;
