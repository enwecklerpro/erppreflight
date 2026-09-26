'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { CheckCircle2, Network, Plus, ShieldAlert, ShieldOff, Trash2 } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { Dialog } from '@/components/dialog';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from '@/components/account/ui';
import { accountKeys, fetchMe } from '@/lib/account-api';
import { ApiError } from '@/lib/api/custom-instance';
import {
  IP_ALLOWLIST_MAX_ENTRIES,
  clearIpAllowlist,
  fetchIpAllowlist,
  saveIpAllowlist,
  tenantAccessKeys,
  type IpAllowlistView,
} from '@/lib/api/tenant-access';
import { useErrorText, useFmt, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const ADMIN_ROLES = new Set(['ORGANIZATION_OWNER', 'SECURITY_ADMIN']);

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^(?=.*:)[0-9a-fA-F:.]{2,45}$/;

/**
 * Plausibility check before the request; the API validates exactly (host bits,
 * canonical form, IPv4-mapped ranges) and answers 400 IP_ALLOWLIST_INVALID.
 */
export function isPlausibleCidr(value: string): boolean {
  const v = value.trim();
  const [ip, prefix, extra] = v.split('/');
  if (extra !== undefined || !ip) return false;
  const v4 = IPV4.test(ip);
  const v6 = !v4 && IPV6.test(ip) && (ip.match(/::/g) ?? []).length <= 1;
  if (!v4 && !v6) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const n = Number(prefix);
  return n >= 1 && n <= (v4 ? 32 : 128);
}

const EntrySchema = z.object({
  cidr: z.string().trim().min(1, vmsg('app.validation.required')).refine(isPlausibleCidr, vmsg('app.tenantAccess.ipAllowlist.invalidCidr')),
  label: z.string().trim().max(100, vmsg('app.validation.maxChars', { max: 100 })),
});

export const AllowlistFormSchema = z.object({
  entries: z
    .array(EntrySchema)
    .max(IP_ALLOWLIST_MAX_ENTRIES, vmsg('app.tenantAccess.ipAllowlist.limit', { max: IP_ALLOWLIST_MAX_ENTRIES }))
    .superRefine((entries, ctx) => {
      const seen = new Set<string>();
      entries.forEach((e, i) => {
        const key = e.cidr.trim().toLowerCase();
        if (!key) return;
        if (seen.has(key)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [i, 'cidr'], message: vmsg('app.tenantAccess.ipAllowlist.duplicate') });
        seen.add(key);
      });
    }),
});
type AllowlistForm = z.infer<typeof AllowlistFormSchema>;

function toForm(view: IpAllowlistView | undefined): AllowlistForm {
  return { entries: (view?.entries ?? []).map((e) => ({ cidr: e.cidr, label: e.label ?? '' })) };
}

/** Organization IP allowlist (spec 10.2, Enterprise): owners and security admins. */
export function IpAllowlistPanel() {
  const t = useT();
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const allowed = !!me.data && (ADMIN_ROLES.has(me.data.role || '') || me.data.systemRole === 'SUPER_ADMIN');
  const view = useQuery({ queryKey: tenantAccessKeys.ipAllowlist, queryFn: fetchIpAllowlist, enabled: allowed, retry: false });
  // Kept outside the editor, which remounts with fresh defaults after every save.
  const [done, setDone] = React.useState<Outcome>(null);

  if (me.data && !allowed) return null;

  return (
    <SettingsSection id="ip-allowlist" title={t('app.tenantAccess.ipAllowlist.title')} icon={Network} description={t('app.tenantAccess.ipAllowlist.hint')}>
      {me.isPending || view.isPending ? (
        <SectionSkeleton rows={3} label={t('app.tenantAccess.ipAllowlist.loading')} />
      ) : view.isError ? (
        <ViewError error={view.error} onRetry={() => view.refetch()} />
      ) : (
        <AllowlistEditor key={view.dataUpdatedAt} view={view.data} done={done} setDone={setDone} />
      )}
    </SettingsSection>
  );
}

function ViewError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const errText = useErrorText();
  return (
    <div className="space-y-2">
      <Notice tone="error" title={t('app.tenantAccess.ipAllowlist.loadFailed')}>
        {errText(error)}
      </Notice>
      <button type="button" className={buttonClass.secondary} onClick={onRetry}>
        {t('app.commercial.retry')}
      </button>
    </div>
  );
}

type Outcome = 'saved' | 'cleared' | null;

function AllowlistEditor({ view, done, setDone }: { view: IpAllowlistView; done: Outcome; setDone: (v: Outcome) => void }) {
  const t = useT();
  const fmt = useFmt();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [lockout, setLockout] = React.useState<AllowlistForm | null>(null);
  const [confirmClear, setConfirmClear] = React.useState(false);

  const refresh = (next?: IpAllowlistView) => {
    if (next) queryClient.setQueryData(tenantAccessKeys.ipAllowlist, next);
    else void queryClient.invalidateQueries({ queryKey: tenantAccessKeys.ipAllowlist });
    void queryClient.invalidateQueries({ queryKey: tenantAccessKeys.status });
  };

  const save = useMutation({
    mutationFn: (input: { value: AllowlistForm; confirmLockout: boolean }) =>
      saveIpAllowlist({
        entries: input.value.entries.map((e) => ({ cidr: e.cidr.trim(), ...(e.label.trim() ? { label: e.label.trim() } : {}) })),
        confirmLockout: input.confirmLockout,
      }),
    onSuccess: (next) => {
      setLockout(null);
      setDone('saved');
      refresh(next);
    },
    onError: (err, input) => {
      if (err instanceof ApiError && err.code === 'IP_ALLOWLIST_LOCKOUT' && !input.confirmLockout) setLockout(input.value);
    },
  });
  const clear = useMutation({
    mutationFn: clearIpAllowlist,
    onSuccess: () => {
      setConfirmClear(false);
      setDone('cleared');
      refresh();
    },
  });

  const form = useForm({
    defaultValues: toForm(view),
    validators: { onChange: AllowlistFormSchema, onSubmit: AllowlistFormSchema },
    onSubmit: async ({ value }) => {
      setDone(null);
      await save.mutateAsync({ value, confirmLockout: false }).catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty, isSubmitting: save.isPending });
  const entryCount = useStore(form.store, (s) => s.values.entries.length);

  const lockoutError = save.error instanceof ApiError && save.error.code === 'IP_ALLOWLIST_LOCKOUT';
  const canEdit = view.featureAvailable;

  return (
    <div className="space-y-4">
      {!view.featureAvailable && (
        <Notice tone="info" title={t('app.tenantAccess.ipAllowlist.enterpriseTitle')}>
          {t('app.tenantAccess.ipAllowlist.enterpriseBody')}{' '}
          <Link href="/settings/billing" className="font-semibold underline">
            {t('app.tenantAccess.ipAllowlist.toBilling')}
          </Link>
        </Notice>
      )}
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="ip-allowlist-status">
        <p className="inline-flex items-center gap-1.5 font-medium">
          {view.enforced ? <ShieldAlert className="size-4" aria-hidden="true" /> : <ShieldOff className="size-4" aria-hidden="true" />}
          {view.enforced ? t('app.tenantAccess.ipAllowlist.statusEnforced', { count: view.entries.length }) : t('app.tenantAccess.ipAllowlist.statusOff')}
        </p>
        <p className="inline-flex items-center gap-1.5 text-muted-foreground">
          {view.clientIp ? t('app.tenantAccess.ipAllowlist.yourIp', { ip: view.clientIp }) : t('app.tenantAccess.ipAllowlist.yourIpUnknown')}
          {view.enforced && (
            <span className="inline-flex items-center gap-1 font-semibold text-foreground">
              · {view.clientIpAllowed ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <ShieldAlert className="size-3.5" aria-hidden="true" />}
              {view.clientIpAllowed ? t('app.tenantAccess.ipAllowlist.yourIpAllowed') : t('app.tenantAccess.ipAllowlist.yourIpBlocked')}
            </span>
          )}
        </p>
      </div>

      {done === 'saved' && <Notice tone="success">{t('app.tenantAccess.ipAllowlist.saved')}</Notice>}
      {done === 'cleared' && <Notice tone="success">{t('app.tenantAccess.ipAllowlist.cleared')}</Notice>}
      {save.isError && !lockoutError && (
        <Notice tone="error" title={t('app.tenantAccess.ipAllowlist.saveFailed')}>
          {errText(save.error)}
        </Notice>
      )}
      {clear.isError && <Notice tone="error">{errText(clear.error)}</Notice>}

      {!canEdit && view.entries.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {view.entries.map((e) => (
            <li key={e.id} className="px-3 py-2 flex flex-wrap justify-between gap-2">
              <span className="font-mono">{e.cidr}</span>
              <span className="text-muted-foreground">{e.label ?? ''}</span>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          className="space-y-3"
          aria-label={t('app.tenantAccess.ipAllowlist.title')}
        >
          <form.Field
            name="entries"
            mode="array"
            children={(entries) => (
              <div className="space-y-3">
                {entries.state.value.length === 0 && <p className="text-sm text-muted-foreground">{t('app.tenantAccess.ipAllowlist.empty')}</p>}
                {entries.state.value.map((_, i) => {
                  const current = entries.state.value[i]?.cidr.trim().toLowerCase();
                  const saved = view.entries.find((e) => e.cidr.toLowerCase() === current);
                  return (
                    <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start rounded-lg border border-border p-3" data-testid="ip-allowlist-row">
                      <form.Field
                        name={`entries[${i}].cidr`}
                        children={(f) => (
                          <FormField
                            id={`ipal-cidr-${i}`}
                            name={f.name}
                            label={t('app.tenantAccess.ipAllowlist.cidr')}
                            description={i === 0 ? t('app.tenantAccess.ipAllowlist.cidrHint') : undefined}
                            required
                            error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}
                          >
                            <FormInput
                              value={f.state.value}
                              onChange={(e) => f.handleChange(e.target.value)}
                              onBlur={f.handleBlur}
                              autoComplete="off"
                              spellCheck={false}
                              className="font-mono"
                            />
                          </FormField>
                        )}
                      />
                      <form.Field
                        name={`entries[${i}].label`}
                        children={(f) => (
                          <FormField
                            id={`ipal-label-${i}`}
                            name={f.name}
                            label={t('app.tenantAccess.ipAllowlist.label')}
                            description={
                              saved?.createdByEmail
                                ? t('app.tenantAccess.ipAllowlist.createdBy', { email: saved.createdByEmail, date: fmt.date(saved.createdAt) })
                                : undefined
                            }
                            error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}
                          >
                            <FormInput
                              value={f.state.value}
                              placeholder={t('app.tenantAccess.ipAllowlist.labelPlaceholder')}
                              onChange={(e) => f.handleChange(e.target.value)}
                              onBlur={f.handleBlur}
                            />
                          </FormField>
                        )}
                      />
                      <button
                        type="button"
                        className={`${buttonClass.secondary} sm:mt-6`}
                        aria-label={t('app.tenantAccess.ipAllowlist.remove', { index: i + 1 })}
                        title={t('app.tenantAccess.ipAllowlist.remove', { index: i + 1 })}
                        onClick={() => entries.removeValue(i)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={buttonClass.secondary}
                    disabled={entryCount >= IP_ALLOWLIST_MAX_ENTRIES}
                    onClick={() => entries.pushValue({ cidr: '', label: '' })}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t('app.tenantAccess.ipAllowlist.add')}
                  </button>
                  {view.clientIp && (
                    <button
                      type="button"
                      className={buttonClass.secondary}
                      disabled={entryCount >= IP_ALLOWLIST_MAX_ENTRIES || entries.state.value.some((e) => e.cidr.trim() === view.clientIp)}
                      onClick={() => entries.pushValue({ cidr: view.clientIp!, label: '' })}
                    >
                      <Plus className="size-4" aria-hidden="true" />
                      {t('app.tenantAccess.ipAllowlist.addCurrent')}
                    </button>
                  )}
                  <span className="self-center text-xs text-muted-foreground">{t('app.tenantAccess.ipAllowlist.limit', { max: IP_ALLOWLIST_MAX_ENTRIES })}</span>
                </div>
              </div>
            )}
          />
          <div className="flex flex-wrap justify-end gap-2">
            {view.enforced && (
              <button type="button" className={buttonClass.danger} onClick={() => setConfirmClear(true)} disabled={clear.isPending}>
                <Pending busy={clear.isPending} busyLabel={t('app.tenantAccess.ipAllowlist.clearing')} idle={t('app.tenantAccess.ipAllowlist.clear')} />
              </button>
            )}
            <form.Subscribe
              selector={(s) => [s.isSubmitting, s.isDirty] as const}
              children={([isSubmitting, dirty]) => (
                <button type="submit" disabled={!dirty || isSubmitting || save.isPending} className={buttonClass.primary}>
                  <Pending busy={isSubmitting || save.isPending} busyLabel={t('app.tenantAccess.ipAllowlist.saving')} idle={t('app.tenantAccess.ipAllowlist.save')} />
                </button>
              )}
            />
          </div>
        </form>
      )}

      {!canEdit && view.enforced && (
        <div className="flex justify-end">
          <button type="button" className={buttonClass.danger} onClick={() => setConfirmClear(true)} disabled={clear.isPending}>
            <Pending busy={clear.isPending} busyLabel={t('app.tenantAccess.ipAllowlist.clearing')} idle={t('app.tenantAccess.ipAllowlist.clear')} />
          </button>
        </div>
      )}

      {lockout && (
        <Dialog labelledBy="ipal-lockout-title" describedBy="ipal-lockout-body" onClose={() => setLockout(null)}>
          <h2 id="ipal-lockout-title" className="flex items-center gap-2 text-lg font-semibold">
            <ShieldAlert className="size-5 text-destructive" aria-hidden="true" />
            {t('app.tenantAccess.ipAllowlist.lockoutTitle')}
          </h2>
          <p id="ipal-lockout-body" className="text-sm">
            {t('app.tenantAccess.ipAllowlist.lockoutBody', { ip: view.clientIp ?? t('app.tenantAccess.suspendedPage.unknownIp') })}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setLockout(null)}>
              {t('app.tenantAccess.ipAllowlist.cancel')}
            </button>
            <button type="button" className={buttonClass.danger} disabled={save.isPending} onClick={() => save.mutate({ value: lockout, confirmLockout: true })}>
              <Pending busy={save.isPending} busyLabel={t('app.tenantAccess.ipAllowlist.saving')} idle={t('app.tenantAccess.ipAllowlist.lockoutConfirm')} />
            </button>
          </div>
        </Dialog>
      )}

      {confirmClear && (
        <Dialog labelledBy="ipal-clear-title" describedBy="ipal-clear-body" onClose={() => setConfirmClear(false)}>
          <h2 id="ipal-clear-title" className="text-lg font-semibold">
            {t('app.tenantAccess.ipAllowlist.clearConfirmTitle')}
          </h2>
          <p id="ipal-clear-body" className="text-sm">
            {t('app.tenantAccess.ipAllowlist.clearConfirmBody')}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={buttonClass.secondary} onClick={() => setConfirmClear(false)}>
              {t('app.tenantAccess.ipAllowlist.cancel')}
            </button>
            <button type="button" className={buttonClass.danger} disabled={clear.isPending} onClick={() => clear.mutate()}>
              <Pending busy={clear.isPending} busyLabel={t('app.tenantAccess.ipAllowlist.clearing')} idle={t('app.tenantAccess.ipAllowlist.clear')} />
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
