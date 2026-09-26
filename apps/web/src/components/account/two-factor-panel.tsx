'use client';

import * as React from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Copy, Download, KeyRound, Lock, ShieldCheck, ShieldOff, Smartphone } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import {
  accountKeys,
  beginTwoFactorSetup,
  disableTwoFactor,
  enableTwoFactor,
  fetchTwoFactorStatus,
  regenerateRecoveryCodes,
  storeSession,
  type TwoFactorSetup,
} from '@/lib/account-api';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from './ui';
import { useErrorText, useFmt, useRichT, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const FACTOR_RE = /^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/;

/** Splits a code into { code } or { recoveryCode } for the API. */
export function toFactor(value: string): { code?: string; recoveryCode?: string } {
  const v = value.trim();
  return /^\d{6}$/.test(v) ? { code: v } : { recoveryCode: v };
}

/** Groups a base32 secret in blocks of four for manual entry. */
export function groupSecret(secret: string): string {
  return (secret.match(/.{1,4}/g) || []).join(' ');
}

const passwordCodeSchema = z.object({
  password: z.string().min(1, vmsg('app.validation.passwordRequired')),
  code: z.string().trim().regex(FACTOR_RE, vmsg('app.validation.totpOrRecovery')),
});

/** Password + second-factor confirmation form used for sensitive 2FA operations. */
function PasswordAndCodeForm({
  idPrefix,
  submitLabel,
  busyLabel,
  tone,
  onSubmit,
}: {
  idPrefix: string;
  submitLabel: string;
  busyLabel: string;
  tone: 'primary' | 'danger';
  onSubmit: (values: z.infer<typeof passwordCodeSchema>) => Promise<unknown>;
}) {
  const t = useT();
  const form = useForm({
    defaultValues: { password: '', code: '' },
    validators: { onSubmit: passwordCodeSchema },
    onSubmit: async ({ value }) => {
      await onSubmit(value).then(() => form.reset()).catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  const isSubmitting = useStore(form.store, (s) => s.isSubmitting);
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      noValidate
      className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] items-end"
    >
      <form.Field
        name="password"
        children={(f) => (
          <FormField id={`${idPrefix}-password`} name={f.name} label={t('app.security.twoFactor.password')} required error={f.state.meta.errors as any}>
            <FormInput type="password" autoComplete="current-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Lock className="size-4" />} />
          </FormField>
        )}
      />
      <form.Field
        name="code"
        children={(f) => (
          <FormField id={`${idPrefix}-code`} name={f.name} label={t('app.security.twoFactor.code')} required error={f.state.meta.errors as any}>
            <FormInput autoComplete="one-time-code" placeholder="123456" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<KeyRound className="size-4" />} />
          </FormField>
        )}
      />
      <button type="submit" disabled={isSubmitting} className={tone === 'danger' ? buttonClass.danger : buttonClass.primary}>
        <Pending busy={isSubmitting} busyLabel={busyLabel} idle={submitLabel} />
      </button>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const t = useT();
  const [copied, setCopied] = React.useState(false);
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`${t('app.security.twoFactor.fileHeader')}\n\n${text}\n`], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'erppreflight-recovery-codes.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <div className="space-y-3">
      <Notice tone="warning" title={t('app.security.twoFactor.saveCodesTitle')}>
        {t('app.security.twoFactor.saveCodesBody')}
      </Notice>
      <ul aria-label={t('app.security.twoFactor.codesLabel')} className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
        {codes.map((c) => (
          <li key={c} className="rounded-md border border-border bg-muted/50 px-2 py-1.5 text-center select-all">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass.secondary}
          onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))}
        >
          <Copy className="size-3.5" aria-hidden="true" /> {copied ? t('app.security.twoFactor.copied') : t('app.security.twoFactor.copy')}
        </button>
        <button type="button" className={buttonClass.secondary} onClick={download}>
          <Download className="size-3.5" aria-hidden="true" /> {t('app.security.twoFactor.download')}
        </button>
        <button type="button" className={buttonClass.primary} onClick={onDone}>
          {t('app.security.twoFactor.stored')}
        </button>
      </div>
    </div>
  );
}

export function TwoFactorPanel() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const status = useQuery({ queryKey: accountKeys.twoFactor, queryFn: fetchTwoFactorStatus, retry: 1 });
  const [setup, setSetup] = React.useState<TwoFactorSetup | null>(null);
  const [showSetup, setShowSetup] = React.useState(false);
  const [recoveryCodes, setRecoveryCodes] = React.useState<string[] | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: accountKeys.twoFactor });
    queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
    queryClient.invalidateQueries({ queryKey: accountKeys.me });
  };

  const setupMutation = useMutation({ mutationFn: beginTwoFactorSetup, onSuccess: setSetup });
  const enableMutation = useMutation({
    mutationFn: enableTwoFactor,
    onSuccess: (res) => {
      storeSession(res);
      setRecoveryCodes(res.recoveryCodes);
      setSetup(null);
      setShowSetup(false);
      refresh();
    },
  });
  const disableMutation = useMutation({
    mutationFn: (v: { password: string; code: string }) => disableTwoFactor(v.password, toFactor(v.code)),
    onSuccess: (session) => {
      storeSession(session);
      setMessage(t('app.security.twoFactor.disabledMessage'));
      refresh();
    },
  });
  const regenerateMutation = useMutation({
    mutationFn: (v: { password: string; code: string }) => regenerateRecoveryCodes(v.password, toFactor(v.code)),
    onSuccess: (res) => {
      setRecoveryCodes(res.recoveryCodes);
      refresh();
    },
  });

  const passwordForm = useForm({
    defaultValues: { password: '' },
    validators: { onSubmit: z.object({ password: z.string().min(1, vmsg('app.validation.passwordRequired')) }) },
    onSubmit: async ({ value }) => {
      await setupMutation.mutateAsync(value.password).catch(() => undefined);
    },
  });
  const codeForm = useForm({
    defaultValues: { code: '' },
    validators: { onSubmit: z.object({ code: z.string().trim().regex(/^\d{6}$/, vmsg('app.validation.totpCode')) }) },
    onSubmit: async ({ value }) => {
      await enableMutation.mutateAsync(value.code.trim()).catch(() => undefined);
    },
  });

  let body: React.ReactNode;
  if (status.isPending) {
    body = <SectionSkeleton rows={2} label={t('app.security.twoFactor.loading')} />;
  } else if (status.isError) {
    body = (
      <div className="space-y-3">
        <Notice tone="error" title={t('app.security.twoFactor.loadFailed')}>{errText(status.error)}</Notice>
        <button type="button" className={buttonClass.secondary} onClick={() => status.refetch()}>{t('app.ui.retry')}</button>
      </div>
    );
  } else if (recoveryCodes) {
    body = <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />;
  } else if (status.data.enabled) {
    body = (
      <div className="space-y-5">
        <Notice tone="success" title={t('app.security.twoFactor.onTitle')}>
          {t('app.security.twoFactor.onBody', {
            date: status.data.enabledAt ? fmt.dateTime(status.data.enabledAt) : '—',
            count: status.data.recoveryCodesRemaining,
          })}
        </Notice>
        {status.data.recoveryCodesRemaining <= 3 && (
          <Notice tone="warning" title={t('app.security.twoFactor.fewCodesTitle')}>{t('app.security.twoFactor.fewCodesBody')}</Notice>
        )}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{t('app.security.twoFactor.regenerateTitle')}</h3>
          {regenerateMutation.isError && <Notice tone="error">{errText(regenerateMutation.error)}</Notice>}
          <PasswordAndCodeForm idPrefix="regen" submitLabel={t('app.security.twoFactor.regenerate')} busyLabel={t('app.security.twoFactor.regenerating')} tone="primary" onSubmit={(v) => regenerateMutation.mutateAsync(v)} />
        </div>
        <div className="space-y-2 pt-4 border-t border-border">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <ShieldOff className="size-3.5" aria-hidden="true" /> {t('app.security.twoFactor.disableTitle')}
          </h3>
          {disableMutation.isError && <Notice tone="error">{errText(disableMutation.error)}</Notice>}
          <PasswordAndCodeForm idPrefix="disable" submitLabel={t('app.security.twoFactor.disable')} busyLabel={t('app.security.twoFactor.disabling')} tone="danger" onSubmit={(v) => disableMutation.mutateAsync(v)} />
        </div>
      </div>
    );
  } else if (setup) {
    body = (
      <div className="space-y-4">
        <ol className="list-decimal pl-5 space-y-2 text-sm text-muted-foreground">
          <li>
            {rt('app.security.twoFactor.step1Rich', {
              link: (c) => (
                <a className="text-primary font-semibold underline" href={setup.otpauthUri}>
                  {c}
                </a>
              ),
            })}
          </li>
          <li>
            {t('app.security.twoFactor.step2')}
            <code className="mt-1 block w-full break-all rounded-md border border-border bg-muted/50 px-2 py-1.5 font-mono text-sm text-foreground select-all" aria-label={t('app.security.twoFactor.setupKey')}>
              {groupSecret(setup.secret)}
            </code>
          </li>
          <li>{t('app.security.twoFactor.step3', { minutes: setup.expiresInMinutes })}</li>
        </ol>
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">{t('app.security.twoFactor.showUri')}</summary>
          <code className="mt-1 block break-all font-mono text-xs">{setup.otpauthUri}</code>
        </details>
        {enableMutation.isError && <Notice tone="error" title={t('app.security.twoFactor.codeRejected')}>{errText(enableMutation.error)}</Notice>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            codeForm.handleSubmit();
          }}
          noValidate
          className="flex flex-col sm:flex-row gap-3 sm:items-end"
        >
          <codeForm.Field
            name="code"
            children={(f) => (
              <FormField id="enable-code" name={f.name} label={t('app.security.twoFactor.authCode')} required error={f.state.meta.errors as any} className="flex-1">
                <FormInput inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Smartphone className="size-4" />} />
              </FormField>
            )}
          />
          <button type="submit" disabled={enableMutation.isPending} className={buttonClass.primary}>
            <Pending busy={enableMutation.isPending} busyLabel={t('app.security.twoFactor.verifying')} idle={t('app.security.twoFactor.enable')} />
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => { setSetup(null); setShowSetup(false); }}>
            {t('app.ui.cancel')}
          </button>
        </form>
      </div>
    );
  } else if (showSetup) {
    body = (
      <div className="space-y-3">
        {setupMutation.isError && <Notice tone="error">{errText(setupMutation.error)}</Notice>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            passwordForm.handleSubmit();
          }}
          noValidate
          className="flex flex-col sm:flex-row gap-3 sm:items-end"
        >
          <passwordForm.Field
            name="password"
            children={(f) => (
              <FormField id="setup-password" name={f.name} label={t('app.security.twoFactor.confirmPassword')} required error={f.state.meta.errors as any} className="flex-1">
                <FormInput type="password" autoComplete="current-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Lock className="size-4" />} />
              </FormField>
            )}
          />
          <button type="submit" disabled={setupMutation.isPending} className={buttonClass.primary}>
            <Pending busy={setupMutation.isPending} busyLabel={t('app.security.twoFactor.preparing')} idle={t('app.security.twoFactor.continue')} />
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => setShowSetup(false)}>
            {t('app.ui.cancel')}
          </button>
        </form>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Notice tone="warning" title={t('app.security.twoFactor.offTitle')}>
          {t('app.security.twoFactor.offBody')}
        </Notice>
        <button type="button" className={buttonClass.primary} onClick={() => setShowSetup(true)}>
          <Smartphone className="size-3.5" aria-hidden="true" /> {t('app.security.twoFactor.setUp')}
        </button>
      </div>
    );
  }

  return (
    <SettingsSection
      id="two-factor"
      title={t('app.security.twoFactor.title')}
      icon={ShieldCheck}
      description={t('app.security.twoFactor.hint')}
    >
      {message && <Notice tone="success">{message}</Notice>}
      {body}
    </SettingsSection>
  );
}
