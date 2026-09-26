'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { KeyRound, Mail, ArrowLeft } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, buttonClass } from '@/components/account/ui';
import { requestPasswordReset } from '@/lib/account-api';
import { useErrorText, useRichT, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const schema = z.object({
  email: z.string().trim().min(1, vmsg('app.validation.emailRequired')).email(vmsg('app.validation.emailInvalid')),
});

export default function ForgotPasswordPage() {
  const t = useT();
  const rt = useRichT();
  const errText = useErrorText();
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const mutation = useMutation({ mutationFn: (email: string) => requestPasswordReset(email) });

  const form = useForm({
    defaultValues: { email: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      const email = value.email.trim();
      await mutation.mutateAsync(email).then(() => setSentTo(email)).catch(() => undefined);
    },
  });

  return (
    <AuthCard
      title={t('app.auth.forgot.title')}
      subtitle={t('app.auth.forgot.subtitle')}
      icon={KeyRound}
    >
      {sentTo ? (
        <div className="space-y-5">
          <Notice tone="success" title={t('app.auth.forgot.sentTitle')}>
            {rt('app.auth.forgot.sentRich', { email: sentTo, b: (c) => <strong>{c}</strong> })}
          </Notice>
          <button
            type="button"
            className={`${buttonClass.secondary} w-full`}
            onClick={() => {
              setSentTo(null);
              form.reset();
            }}
          >
            {t('app.auth.forgot.differentAddress')}
          </button>
        </div>
      ) : (
        <>
          {mutation.isError && (
            <Notice tone="error" title={t('app.auth.forgot.failed')} className="mb-5">
              {errText(mutation.error)}
            </Notice>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="space-y-5"
          >
            <form.Field
              name="email"
              children={(field) => (
                <FormField id="forgot-email" name={field.name} label={t('app.auth.forgot.accountEmail')} required error={field.state.meta.errors as any}>
                  <FormInput
                    type="email"
                    autoComplete="email"
                    placeholder={t('app.auth.emailPlaceholder')}
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    leftIcon={<Mail className="size-4" />}
                  />
                </FormField>
              )}
            />
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(isSubmitting) => (
                <button type="submit" disabled={isSubmitting || mutation.isPending} className={`${buttonClass.primary} w-full`}>
                  <Pending busy={isSubmitting || mutation.isPending} busyLabel={t('app.auth.forgot.sending')} idle={t('app.auth.forgot.submit')} />
                </button>
              )}
            />
          </form>
        </>
      )}
      <div className="mt-6 pt-5 border-t border-border text-center text-xs">
        <Link href="/login" className="inline-flex items-center gap-1 font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs">
          <ArrowLeft className="size-3.5" aria-hidden="true" /> {t('app.auth.backToSignIn')}
        </Link>
      </div>
    </AuthCard>
  );
}
