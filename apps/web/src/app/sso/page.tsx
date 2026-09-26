'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { AlertCircle, KeyRound, Mail } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { discoverSso } from '@/lib/api/integrations';
import { resolveApiUrl } from '@/lib/api/custom-instance';
import { useErrorText, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const Schema = z.object({ email: z.string().trim().email(vmsg('app.auth.sso.emailInvalid')) });

const ERROR_KEYS: Record<string, 'app.auth.sso.notAvailable' | 'app.auth.sso.loginFailed'> = {
  SSO_NOT_AVAILABLE: 'app.auth.sso.notAvailable',
  SSO_LOGIN_FAILED: 'app.auth.sso.loginFailed',
};

function SsoStart() {
  const t = useT();
  const errText = useErrorText();
  const params = useSearchParams();
  const ssoError = params.get('sso_error');
  const [message, setMessage] = React.useState<string | null>(
    ssoError ? t(ERROR_KEYS[ssoError] ?? 'app.auth.sso.failed') : null,
  );
  const discover = useMutation({
    mutationFn: (email: string) => discoverSso(email),
    onSuccess: (r, email) => {
      if (!r.ssoAvailable || !r.loginUrl) {
        setMessage(t('app.auth.sso.notAvailable'));
        return;
      }
      // Full-page navigation: the API sets the PKCE state cookie and redirects to the IdP.
      window.location.assign(resolveApiUrl(`/sso/login?email=${encodeURIComponent(email)}`));
    },
    onError: (e) => setMessage(errText(e, t('app.auth.sso.lookupFailed'))),
  });
  const form = useForm({
    defaultValues: { email: '' },
    validators: { onSubmit: Schema },
    onSubmit: async ({ value }) => {
      setMessage(null);
      await discover.mutateAsync(value.email.trim().toLowerCase());
    },
  });
  return (
    <div className="max-w-md mx-auto py-10 space-y-5">
      <div className="text-center">
        <KeyRound className="mx-auto size-8 text-primary" aria-hidden="true" />
        <h1 className="mt-2 text-xl font-bold text-foreground">{t('app.auth.sso.title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('app.auth.sso.intro')}</p>
      </div>
      {message && (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex gap-2">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" /> {message}
        </div>
      )}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="rounded-2xl border border-border bg-card p-6 space-y-4"
      >
        <form.Field name="email" children={(f) => (
          <FormField id="sso-email" name="email" label={t('app.auth.sso.email')} required error={f.state.meta.errors as any}>
            <FormInput type="email" autoComplete="email" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Mail className="size-4" />} />
          </FormField>
        )} />
        <form.Subscribe selector={(s) => s.isSubmitting} children={(busy) => (
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
            {busy ? t('app.auth.sso.redirecting') : t('app.auth.sso.submit')}
          </button>
        )} />
      </form>
      <p className="text-center text-sm text-muted-foreground">
        {t('app.auth.sso.notUsing')} <Link href="/login" className="text-primary hover:underline">{t('app.auth.sso.passwordLink')}</Link>
      </p>
    </div>
  );
}

export default function SsoPage() {
  return (
    <React.Suspense fallback={null}>
      <SsoStart />
    </React.Suspense>
  );
}
