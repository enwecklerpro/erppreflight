'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Ban, CalendarPlus, CheckCircle2, Eye, KeyRound, Network, PlayCircle, ShieldAlert, Timer, UserRound, X } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { Notice, Pending, SectionSkeleton, buttonClass } from '@/components/account/ui';
import { useRoleLabel } from '@/components/account/role-label';
import {
  breakGlassClearIpAllowlist,
  endAdminImpersonation,
  extendTenantTrial,
  fetchTenantAccessOverview,
  startImpersonation,
  suspendTenant,
  tenantAccessKeys,
  unsuspendTenant,
  type TenantAccessOverview,
} from '@/lib/api/tenant-access';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const REASON_MIN = 10;
const ReasonSchema = z
  .string()
  .trim()
  .min(REASON_MIN, vmsg('app.validation.minChars', { min: REASON_MIN }))
  .max(1000, vmsg('app.validation.maxChars', { max: 1000 }));

export const TenantActionSchema = z.object({ reason: ReasonSchema });
export const ExtendTrialFormSchema = z.object({
  reason: ReasonSchema,
  days: z
    .string()
    .trim()
    .regex(/^\d{1,2}$/, vmsg('app.validation.invalidValue'))
    .refine((v) => Number(v) >= 1 && Number(v) <= 90, vmsg('app.validation.invalidValue')),
});
export const ImpersonateFormSchema = z.object({
  reason: ReasonSchema,
  durationMinutes: z.enum(['5', '15', '30']),
  mode: z.enum(['READ_ONLY', 'READ_WRITE']),
});

type Member = TenantAccessOverview['members'][number];
type Action =
  | { kind: 'suspend' }
  | { kind: 'unsuspend' }
  | { kind: 'extend' }
  | { kind: 'clear' }
  | { kind: 'impersonate'; member: Member };

/** "Access" button in the admin tenants table; opens the access administration dialog. */
export function TenantAccessButton({ tenant }: { tenant: { id: string; name: string } }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('app.tenantAccess.admin.manageLabel', { name: tenant.name })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        <KeyRound className="size-3.5" aria-hidden="true" />
        {t('app.tenantAccess.admin.manage')}
      </button>
      {open && <TenantAccessDialog tenant={tenant} onClose={() => setOpen(false)} />}
    </>
  );
}

function StatusBadge({ suspended }: { suspended: boolean }) {
  const t = useT();
  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-bold ${
        suspended ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' : 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
      }`}
      data-testid="tenant-access-status"
    >
      {suspended ? <Ban className="size-3" aria-hidden="true" /> : <CheckCircle2 className="size-3" aria-hidden="true" />}
      {suspended ? t('app.tenantAccess.admin.statusSuspended') : t('app.tenantAccess.admin.statusActive')}
    </span>
  );
}

/** Super-admin access administration of one tenant (spec 10.7 / 10.8). */
export function TenantAccessDialog({ tenant, onClose }: { tenant: { id: string; name: string }; onClose: () => void }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const roleLabel = useRoleLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [action, setAction] = React.useState<Action | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const overview = useQuery({ queryKey: tenantAccessKeys.adminAccess(tenant.id), queryFn: () => fetchTenantAccessOverview(tenant.id) });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: tenantAccessKeys.adminAccess(tenant.id) });
    void queryClient.invalidateQueries({ queryKey: ['admin', 'tenants'] });
  };
  const endSession = useMutation({
    mutationFn: endAdminImpersonation,
    onSuccess: () => {
      setMessage(t('app.tenantAccess.admin.sessionEnded'));
      refresh();
    },
  });

  const data = overview.data;
  const headingId = 'tenant-access-title';

  return (
    <Dialog labelledBy={headingId} onClose={onClose} className="max-w-3xl">
      <div className="flex items-start justify-between gap-3">
        <h2 id={headingId} className="text-lg font-semibold break-words">
          {t('app.tenantAccess.admin.dialogTitle', { name: tenant.name })}
        </h2>
        <button type="button" onClick={onClose} className={buttonClass.secondary} aria-label={t('app.tenantAccess.admin.close')} title={t('app.tenantAccess.admin.close')}>
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>

      {overview.isPending ? (
        <SectionSkeleton rows={5} label={t('app.tenantAccess.admin.loading')} />
      ) : overview.isError ? (
        <div className="space-y-2">
          <Notice tone="error" title={t('app.tenantAccess.admin.loadFailed')}>
            {errText(overview.error)}
          </Notice>
          <button type="button" className={buttonClass.secondary} onClick={() => overview.refetch()}>
            {t('app.commercial.retry')}
          </button>
        </div>
      ) : action ? (
        <ActionForm
          overview={data!}
          action={action}
          onCancel={() => setAction(null)}
          onDone={(msg) => {
            setAction(null);
            setMessage(msg);
            refresh();
          }}
        />
      ) : (
        <div className="space-y-5 text-sm">
          {message && <Notice tone="success">{message}</Notice>}
          {endSession.isError && <Notice tone="error">{errText(endSession.error)}</Notice>}

          <section aria-labelledby="ta-status" className="space-y-2">
            <h3 id="ta-status" className="font-semibold">{t('app.tenantAccess.admin.statusTitle')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge suspended={data!.organization.status === 'SUSPENDED'} />
              {data!.organization.suspendedAt && (
                <span className="text-muted-foreground">{t('app.tenantAccess.admin.suspendedSince', { date: fmt.dateTime(data!.organization.suspendedAt) })}</span>
              )}
            </div>
            {data!.organization.suspensionReason && (
              <blockquote className="border-l-4 border-destructive/50 pl-3 whitespace-pre-wrap break-words">{data!.organization.suspensionReason}</blockquote>
            )}
            {data!.organization.status === 'SUSPENDED' ? (
              <button type="button" className={buttonClass.primary} onClick={() => setAction({ kind: 'unsuspend' })}>
                <PlayCircle className="size-4" aria-hidden="true" />
                {t('app.tenantAccess.admin.unsuspend')}
              </button>
            ) : (
              <button type="button" className={buttonClass.danger} onClick={() => setAction({ kind: 'suspend' })}>
                <Ban className="size-4" aria-hidden="true" />
                {t('app.tenantAccess.admin.suspend')}
              </button>
            )}
          </section>

          <section aria-labelledby="ta-trial" className="space-y-2">
            <h3 id="ta-trial" className="font-semibold">{t('app.tenantAccess.admin.trialTitle')}</h3>
            {data!.trial.endsAt && data!.trial.tier ? (
              <>
                <p>{t('app.tenantAccess.admin.trialEnds', { tier: data!.trial.tier, date: fmt.dateTime(data!.trial.endsAt) })}</p>
                <p className="text-muted-foreground">
                  {t('app.tenantAccess.admin.trialOriginal', {
                    date: fmt.date(data!.trial.originalEndsAt),
                    days: data!.trial.extendedDays,
                    max: fmt.date(data!.trial.maxEndsAt),
                  })}
                </p>
                {data!.trial.effectiveTier && <p className="text-muted-foreground">{t('app.tenantAccess.admin.trialEffective', { tier: data!.trial.effectiveTier })}</p>}
              </>
            ) : (
              <p className="text-muted-foreground">{t('app.tenantAccess.admin.trialNone')}</p>
            )}
            {data!.trial.extendable && (
              <button type="button" className={buttonClass.secondary} onClick={() => setAction({ kind: 'extend' })}>
                <CalendarPlus className="size-4" aria-hidden="true" />
                {t('app.tenantAccess.admin.extendTrial')}
              </button>
            )}
          </section>

          <section aria-labelledby="ta-allowlist" className="space-y-2">
            <h3 id="ta-allowlist" className="font-semibold flex items-center gap-2">
              <Network className="size-4" aria-hidden="true" />
              {t('app.tenantAccess.admin.allowlistTitle')}
            </h3>
            {data!.ipAllowlist.length === 0 ? (
              <p className="text-muted-foreground">{t('app.tenantAccess.admin.allowlistNone')}</p>
            ) : (
              <>
                <p className="break-words">
                  {t('app.tenantAccess.admin.allowlistEntries', { count: data!.ipAllowlist.length, list: data!.ipAllowlist.map((e) => e.cidr).join(', ') })}
                </p>
                <button type="button" className={buttonClass.danger} onClick={() => setAction({ kind: 'clear' })}>
                  <ShieldAlert className="size-4" aria-hidden="true" />
                  {t('app.tenantAccess.admin.clearAllowlist')}
                </button>
              </>
            )}
          </section>

          <section aria-labelledby="ta-members" className="space-y-2">
            <h3 id="ta-members" className="font-semibold">{t('app.tenantAccess.admin.membersTitle')}</h3>
            {data!.members.length === 0 ? (
              <p className="text-muted-foreground">{t('app.tenantAccess.admin.membersEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {data!.members.map((m) => (
                  <li key={m.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 font-medium break-all">
                        <UserRound className="size-3.5 shrink-0" aria-hidden="true" />
                        {m.email}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {roleLabel(m.role)} · {label('app.projects.status', m.status)}
                      </span>
                    </span>
                    {m.impersonable ? (
                      <button
                        type="button"
                        className={buttonClass.secondary}
                        aria-label={t('app.tenantAccess.admin.impersonateLabel', { email: m.email })}
                        onClick={() => setAction({ kind: 'impersonate', member: m })}
                      >
                        <Eye className="size-4" aria-hidden="true" />
                        {t('app.tenantAccess.admin.impersonate')}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t('app.tenantAccess.admin.notImpersonable')}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="ta-history" className="space-y-2">
            <h3 id="ta-history" className="font-semibold">{t('app.tenantAccess.admin.historyTitle')}</h3>
            {data!.impersonations.length === 0 ? (
              <p className="text-muted-foreground">{t('app.tenantAccess.admin.historyEmpty')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border text-xs" data-testid="impersonation-history">
                {data!.impersonations.map((s) => (
                  <li key={s.id} className="px-3 py-2 flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 space-y-0.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 font-bold">
                          {s.status === 'ACTIVE' ? <Timer className="size-3" aria-hidden="true" /> : <CheckCircle2 className="size-3" aria-hidden="true" />}
                          {t(`app.tenantAccess.admin.sessionStatus.${s.status}`)}
                        </span>
                        <span className="font-semibold">{t(`app.tenantAccess.admin.mode.${s.mode}`)}</span>
                      </span>
                      <span className="block break-all">
                        {t('app.tenantAccess.admin.historyItem', {
                          impersonator: s.impersonatorEmail,
                          target: s.targetEmail,
                          date: fmt.dateTime(s.createdAt),
                          count: s.requestCount,
                        })}
                      </span>
                      <span className="block text-muted-foreground break-words">{s.reason}</span>
                    </span>
                    {s.status === 'ACTIVE' && (
                      <button type="button" className={buttonClass.secondary} disabled={endSession.isPending} onClick={() => endSession.mutate(s.id)}>
                        {t('app.tenantAccess.admin.endSession')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

function ReasonField({ form, hint }: { form: any; hint: string }) {
  const t = useT();
  return (
    <form.Field
      name="reason"
      children={(f: any) => (
        <FormField id="ta-reason" name={f.name} label={t('app.tenantAccess.admin.reason')} description={hint} required error={f.state.meta.isTouched ? f.state.meta.errors : undefined}>
          <FormTextarea rows={3} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
        </FormField>
      )}
    />
  );
}

function ActionForm({
  overview,
  action,
  onCancel,
  onDone,
}: {
  overview: TenantAccessOverview;
  action: Action;
  onCancel: () => void;
  onDone: (message: string) => void;
}) {
  const t = useT();
  const fmt = useFmt();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const org = overview.organization;
  const name = org.name;

  const mutation = useMutation({
    mutationFn: async (value: { reason: string; days?: string; durationMinutes?: string; mode?: 'READ_ONLY' | 'READ_WRITE' }) => {
      switch (action.kind) {
        case 'suspend': {
          const r = await suspendTenant(org.id, value.reason);
          return t('app.tenantAccess.admin.suspended', { count: r.ownersNotified });
        }
        case 'unsuspend': {
          const r = await unsuspendTenant(org.id, value.reason);
          return t('app.tenantAccess.admin.reactivated', { count: r.ownersNotified });
        }
        case 'extend': {
          const r = await extendTenantTrial(org.id, Number(value.days), value.reason);
          return t('app.tenantAccess.admin.extended', { date: fmt.dateTime(r.trialEndsAt) });
        }
        case 'clear': {
          const r = await breakGlassClearIpAllowlist(org.id, value.reason);
          return t('app.tenantAccess.admin.allowlistCleared', { count: r.removed });
        }
        case 'impersonate': {
          const r = await startImpersonation({
            organizationId: org.id,
            userId: action.member.id,
            reason: value.reason,
            durationMinutes: Number(value.durationMinutes ?? '15'),
            mode: value.mode ?? 'READ_ONLY',
          });
          // The browser now acts as the member (HttpOnly impersonation cookie): drop every
          // cached query of the operator before entering the tenant.
          await queryClient.cancelQueries();
          queryClient.clear();
          window.location.assign(r.returnTo || '/dashboard');
          return t('app.tenantAccess.admin.starting');
        }
      }
    },
    onSuccess: (msg) => {
      if (action.kind !== 'impersonate') onDone(msg);
    },
  });

  const schema = action.kind === 'extend' ? ExtendTrialFormSchema : action.kind === 'impersonate' ? ImpersonateFormSchema : TenantActionSchema;
  const form = useForm({
    defaultValues: { reason: '', days: '14', durationMinutes: '15', mode: 'READ_ONLY' } as {
      reason: string;
      days: string;
      durationMinutes: '5' | '15' | '30';
      mode: 'READ_ONLY' | 'READ_WRITE';
    },
    validators: { onChange: schema as any, onSubmit: schema as any },
    onSubmit: async ({ value }) => {
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  const titles: Record<Action['kind'], string> = {
    suspend: t('app.tenantAccess.admin.suspendTitle', { name }),
    unsuspend: t('app.tenantAccess.admin.unsuspendTitle', { name }),
    extend: t('app.tenantAccess.admin.extendTitle', { name }),
    clear: t('app.tenantAccess.admin.clearTitle', { name }),
    impersonate: action.kind === 'impersonate' ? t('app.tenantAccess.admin.impersonateTitle', { email: action.member.email }) : '',
  };
  const bodies: Record<Action['kind'], string> = {
    suspend: t('app.tenantAccess.admin.suspendBody'),
    unsuspend: t('app.tenantAccess.admin.unsuspendBody'),
    extend: t('app.tenantAccess.admin.extendBody', { max: fmt.date(overview.trial.maxEndsAt) }),
    clear: t('app.tenantAccess.admin.clearBody'),
    impersonate: t('app.tenantAccess.admin.impersonateBody', { name }),
  };
  const danger = action.kind === 'suspend' || action.kind === 'clear';

  return (
    <form
      noValidate
      aria-labelledby="ta-action-title"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-4 text-sm"
      data-testid={`tenant-action-${action.kind}`}
    >
      <h3 id="ta-action-title" className="text-base font-semibold break-words">{titles[action.kind]}</h3>
      <p className="text-muted-foreground">{bodies[action.kind]}</p>
      {mutation.isError && (
        <Notice tone="error" title={t('app.tenantAccess.admin.actionFailed')}>
          {errText(mutation.error)}
        </Notice>
      )}
      {action.kind === 'extend' && (
        <form.Field
          name="days"
          children={(f) => (
            <FormField id="ta-days" name={f.name} label={t('app.tenantAccess.admin.days')} required error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}>
              <FormInput type="number" inputMode="numeric" min={1} max={90} value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} />
            </FormField>
          )}
        />
      )}
      {action.kind === 'impersonate' && (
        <div className="grid gap-3 sm:grid-cols-2">
          <form.Field
            name="durationMinutes"
            children={(f) => (
              <FormField id="ta-duration" name={f.name} label={t('app.tenantAccess.admin.duration')} required>
                <FormSelect
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value as '5' | '15' | '30')}
                  options={(['5', '15', '30'] as const).map((m) => ({ value: m, label: t('app.tenantAccess.admin.minutes', { count: Number(m) }) }))}
                />
              </FormField>
            )}
          />
          <form.Field
            name="mode"
            children={(f) => (
              <FormField
                id="ta-mode"
                name={f.name}
                label={t('app.tenantAccess.admin.modeLabel')}
                description={f.state.value === 'READ_ONLY' ? t('app.tenantAccess.admin.modeReadOnlyHint') : t('app.tenantAccess.admin.modeReadWriteHint')}
                required
              >
                <FormSelect
                  value={f.state.value}
                  onChange={(e) => f.handleChange(e.target.value as 'READ_ONLY' | 'READ_WRITE')}
                  options={[
                    { value: 'READ_ONLY', label: t('app.tenantAccess.admin.mode.READ_ONLY') },
                    { value: 'READ_WRITE', label: t('app.tenantAccess.admin.mode.READ_WRITE') },
                  ]}
                />
              </FormField>
            )}
          />
        </div>
      )}
      <ReasonField
        form={form}
        hint={action.kind === 'impersonate' ? t('app.tenantAccess.admin.reasonImpersonationHint') : t('app.tenantAccess.admin.reasonHint')}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={buttonClass.secondary} onClick={onCancel} disabled={mutation.isPending}>
          {t('app.tenantAccess.ipAllowlist.cancel')}
        </button>
        <form.Subscribe
          selector={(s) => s.isSubmitting}
          children={(isSubmitting) => (
            <button type="submit" className={danger ? buttonClass.danger : buttonClass.primary} disabled={isSubmitting || mutation.isPending}>
              <Pending busy={isSubmitting || mutation.isPending} busyLabel={t('app.tenantAccess.admin.working')} idle={t('app.tenantAccess.admin.confirm')} />
            </button>
          )}
        />
      </div>
    </form>
  );
}
