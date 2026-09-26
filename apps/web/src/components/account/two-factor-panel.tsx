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
  errorMessage,
  fetchTwoFactorStatus,
  regenerateRecoveryCodes,
  storeSession,
  type TwoFactorSetup,
} from '@/lib/account-api';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from './ui';

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
  password: z.string().min(1, 'Enter your password'),
  code: z.string().trim().regex(FACTOR_RE, 'Enter a 6-digit code or a recovery code'),
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
          <FormField id={`${idPrefix}-password`} name={f.name} label="Password" required error={f.state.meta.errors as any}>
            <FormInput type="password" autoComplete="current-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Lock className="size-4" />} />
          </FormField>
        )}
      />
      <form.Field
        name="code"
        children={(f) => (
          <FormField id={`${idPrefix}-code`} name={f.name} label="Authenticator or recovery code" required error={f.state.meta.errors as any}>
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
  const [copied, setCopied] = React.useState(false);
  const text = codes.join('\n');
  const download = () => {
    const url = URL.createObjectURL(new Blob([`ERP Preflight recovery codes\n\n${text}\n`], { type: 'text/plain' }));
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
      <Notice tone="warning" title="Save your recovery codes now">
        Each code signs you in once if you lose your authenticator. They will not be shown again.
      </Notice>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 sm:grid-cols-5 gap-2 font-mono text-xs">
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
          <Copy className="size-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button type="button" className={buttonClass.secondary} onClick={download}>
          <Download className="size-3.5" aria-hidden="true" /> Download .txt
        </button>
        <button type="button" className={buttonClass.primary} onClick={onDone}>
          I have stored my codes
        </button>
      </div>
    </div>
  );
}

export function TwoFactorPanel() {
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
      setMessage('Two-factor authentication was disabled. Other sessions were signed out.');
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
    validators: { onSubmit: z.object({ password: z.string().min(1, 'Enter your password') }) },
    onSubmit: async ({ value }) => {
      await setupMutation.mutateAsync(value.password).catch(() => undefined);
    },
  });
  const codeForm = useForm({
    defaultValues: { code: '' },
    validators: { onSubmit: z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') }) },
    onSubmit: async ({ value }) => {
      await enableMutation.mutateAsync(value.code.trim()).catch(() => undefined);
    },
  });

  let body: React.ReactNode;
  if (status.isPending) {
    body = <SectionSkeleton rows={2} label="Loading two-factor status" />;
  } else if (status.isError) {
    body = (
      <div className="space-y-3">
        <Notice tone="error" title="Could not load two-factor status">{errorMessage(status.error)}</Notice>
        <button type="button" className={buttonClass.secondary} onClick={() => status.refetch()}>Retry</button>
      </div>
    );
  } else if (recoveryCodes) {
    body = <RecoveryCodes codes={recoveryCodes} onDone={() => setRecoveryCodes(null)} />;
  } else if (status.data.enabled) {
    body = (
      <div className="space-y-5">
        <Notice tone="success" title="Two-factor authentication is on">
          Enabled {status.data.enabledAt ? new Date(status.data.enabledAt).toLocaleString() : ''} ·{' '}
          {status.data.recoveryCodesRemaining} unused recovery code{status.data.recoveryCodesRemaining === 1 ? '' : 's'}
        </Notice>
        {status.data.recoveryCodesRemaining <= 3 && (
          <Notice tone="warning" title="Few recovery codes left">Generate a new set below.</Notice>
        )}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold">Generate new recovery codes</h3>
          {regenerateMutation.isError && <Notice tone="error">{errorMessage(regenerateMutation.error)}</Notice>}
          <PasswordAndCodeForm idPrefix="regen" submitLabel="Generate codes" busyLabel="Generating..." tone="primary" onSubmit={(v) => regenerateMutation.mutateAsync(v)} />
        </div>
        <div className="space-y-2 pt-4 border-t border-border">
          <h3 className="text-xs font-semibold flex items-center gap-1.5">
            <ShieldOff className="size-3.5" aria-hidden="true" /> Disable two-factor authentication
          </h3>
          {disableMutation.isError && <Notice tone="error">{errorMessage(disableMutation.error)}</Notice>}
          <PasswordAndCodeForm idPrefix="disable" submitLabel="Disable 2FA" busyLabel="Disabling..." tone="danger" onSubmit={(v) => disableMutation.mutateAsync(v)} />
        </div>
      </div>
    );
  } else if (setup) {
    body = (
      <div className="space-y-4">
        <ol className="list-decimal pl-5 space-y-2 text-xs text-muted-foreground">
          <li>
            Open your authenticator app (1Password, Google Authenticator, Authy, Microsoft Authenticator…) and add an account.
            On a phone you can{' '}
            <a className="text-primary font-semibold underline" href={setup.otpauthUri}>
              open the setup link directly
            </a>
            .
          </li>
          <li>
            Or enter this key manually (time-based, SHA-1, 6 digits, 30 s):
            <code className="mt-1 block w-full break-all rounded-md border border-border bg-muted/50 px-2 py-1.5 font-mono text-sm text-foreground select-all" aria-label="Setup key">
              {groupSecret(setup.secret)}
            </code>
          </li>
          <li>Enter the 6-digit code the app shows. The setup expires in {setup.expiresInMinutes} minutes.</li>
        </ol>
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground">Show otpauth URI</summary>
          <code className="mt-1 block break-all font-mono text-[11px]">{setup.otpauthUri}</code>
        </details>
        {enableMutation.isError && <Notice tone="error" title="Code not accepted">{errorMessage(enableMutation.error)}</Notice>}
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
              <FormField id="enable-code" name={f.name} label="Authentication code" required error={f.state.meta.errors as any} className="flex-1">
                <FormInput inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Smartphone className="size-4" />} />
              </FormField>
            )}
          />
          <button type="submit" disabled={enableMutation.isPending} className={buttonClass.primary}>
            <Pending busy={enableMutation.isPending} busyLabel="Verifying..." idle="Enable 2FA" />
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => { setSetup(null); setShowSetup(false); }}>
            Cancel
          </button>
        </form>
      </div>
    );
  } else if (showSetup) {
    body = (
      <div className="space-y-3">
        {setupMutation.isError && <Notice tone="error">{errorMessage(setupMutation.error)}</Notice>}
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
              <FormField id="setup-password" name={f.name} label="Confirm your password" required error={f.state.meta.errors as any} className="flex-1">
                <FormInput type="password" autoComplete="current-password" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Lock className="size-4" />} />
              </FormField>
            )}
          />
          <button type="submit" disabled={setupMutation.isPending} className={buttonClass.primary}>
            <Pending busy={setupMutation.isPending} busyLabel="Preparing..." idle="Continue" />
          </button>
          <button type="button" className={buttonClass.secondary} onClick={() => setShowSetup(false)}>
            Cancel
          </button>
        </form>
      </div>
    );
  } else {
    body = (
      <div className="space-y-3">
        <Notice tone="warning" title="Two-factor authentication is off">
          Protect your account with a time-based one-time code from an authenticator app.
        </Notice>
        <button type="button" className={buttonClass.primary} onClick={() => setShowSetup(true)}>
          <Smartphone className="size-3.5" aria-hidden="true" /> Set up two-factor authentication
        </button>
      </div>
    );
  }

  return (
    <SettingsSection
      id="two-factor"
      title="Two-factor authentication (TOTP)"
      icon={ShieldCheck}
      description="Changing 2FA settings signs out every other session."
    >
      {message && <Notice tone="success">{message}</Notice>}
      {body}
    </SettingsSection>
  );
}
