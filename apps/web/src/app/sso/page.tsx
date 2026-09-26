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
import { resolveApiUrl, ApiError } from '@/lib/api/custom-instance';

const Schema = z.object({ email: z.string().trim().email('Enter your work e-mail address') });

const ERRORS: Record<string, string> = {
  SSO_NOT_AVAILABLE: 'Single sign-on is not configured for this e-mail domain.',
  SSO_LOGIN_FAILED: 'Your identity provider did not complete the sign-in. Contact your administrator if this persists.',
};

function SsoStart() {
  const params = useSearchParams();
  const [message, setMessage] = React.useState<string | null>(params.get('sso_error') ? ERRORS[params.get('sso_error')!] ?? 'Single sign-on failed.' : null);
  const discover = useMutation({
    mutationFn: (email: string) => discoverSso(email),
    onSuccess: (r, email) => {
      if (!r.ssoAvailable || !r.loginUrl) {
        setMessage(ERRORS.SSO_NOT_AVAILABLE);
        return;
      }
      // Full-page navigation: the API sets the PKCE state cookie and redirects to the IdP.
      window.location.assign(resolveApiUrl(`/sso/login?email=${encodeURIComponent(email)}`));
    },
    onError: (e) => setMessage(e instanceof ApiError ? e.message : 'Single sign-on lookup failed.'),
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
        <h1 className="mt-2 text-xl font-bold text-foreground">Sign in with your company account</h1>
        <p className="mt-1 text-xs text-muted-foreground">Enterprise single sign-on (OpenID Connect) for organizations with a verified domain.</p>
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
          <FormField id="sso-email" name="email" label="Work e-mail" required error={f.state.meta.errors as any}>
            <FormInput type="email" autoComplete="email" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} onBlur={f.handleBlur} leftIcon={<Mail className="size-4" />} />
          </FormField>
        )} />
        <form.Subscribe selector={(s) => s.isSubmitting} children={(busy) => (
          <button type="submit" disabled={busy} className="w-full rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-dark disabled:opacity-50">
            {busy ? 'Redirecting…' : 'Continue with SSO'}
          </button>
        )} />
      </form>
      <p className="text-center text-xs text-muted-foreground">
        Not using SSO? <Link href="/login" className="text-primary hover:underline">Sign in with a password</Link>
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
