'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowRight, Mail, MailCheck } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSummaryErrors } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, buttonClass } from '@/components/account/ui';
import { requestMagicLink } from '@/lib/account-api';
import { useErrorText, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const schema = z.object({
  email: z.string().trim().min(1, vmsg('app.validation.emailRequired')).email(vmsg('app.validation.emailInvalid')),
});

/**
 * "Send me a sign-in link" (spec 10.2). The API answers identically for known and
 * unknown addresses, so the confirmation never reveals whether an account exists.
 */
export function MagicLinkRequest({
  initialEmail = '',
  next,
  onUsePassword,
}: {
  initialEmail?: string;
  next?: string | null;
  onUsePassword: () => void;
}) {
  const t = useT();
  const errText = useErrorText();
  const [sent, setSent] = React.useState<{ email: string; minutes: number } | null>(null);
  const [serverError, setServerError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (email: string) => requestMagicLink(email, next),
    onSuccess: (res, email) => setSent({ email, minutes: res.expiresInMinutes }),
    onError: (err) => setServerError(errText(err, t('app.magicLink.requestFailed'))),
  });

  const form = useForm({
    defaultValues: { email: initialEmail },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      await mutation.mutateAsync(value.email.trim()).catch(() => undefined);
    },
  });

  if (sent) {
    return (
      <AuthCard title={t('app.magicLink.sentTitle')} icon={MailCheck}>
        <div data-testid="magic-link-sent">
          <Notice tone="success">{t('app.magicLink.sentBody', { email: sent.email, minutes: sent.minutes })}</Notice>
        </div>
        <div className="mt-6 flex flex-col sm:flex-row gap-2 justify-between">
          <button
            type="button"
            className={buttonClass.secondary}
            onClick={() => {
              setSent(null);
              mutation.reset();
            }}
          >
            {t('app.magicLink.sendAnother')}
          </button>
          <button type="button" className={buttonClass.secondary} onClick={onUsePassword}>
            {t('app.magicLink.usePassword')}
          </button>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t('app.magicLink.requestTitle')} subtitle={t('app.magicLink.requestSubtitle')} icon={Mail}>
      {serverError && (
        <Notice tone="error" title={t('app.auth.login.errorTitle')} className="mb-6">
          {serverError}
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
        data-testid="magic-link-form"
      >
        <form.Field
          name="email"
          children={(field) => (
            <FormField id="magic-email" name={field.name} label={t('app.auth.workEmail')} required error={field.state.meta.errors as any}>
              <FormInput
                type="email"
                autoComplete="email"
                autoFocus
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
          selector={(s) => ({ errors: s.fieldMeta.email?.errors, isSubmitting: s.isSubmitting })}
          children={({ errors, isSubmitting }) => {
            const busy = isSubmitting || mutation.isPending;
            return (
              <div className="space-y-4 pt-1">
                {errors?.length ? (
                  <FormSummaryErrors errors={[{ fieldId: 'magic-email', label: t('app.auth.workEmail'), error: errors }] as any} />
                ) : null}
                <button type="submit" disabled={busy} className={`${buttonClass.primary} w-full`}>
                  <Pending
                    busy={busy}
                    busyLabel={t('app.magicLink.sending')}
                    idle={<>{t('app.magicLink.send')}<ArrowRight className="size-3.5" aria-hidden="true" /></>}
                  />
                </button>
              </div>
            );
          }}
        />
      </form>
      <div className="mt-6 pt-5 border-t border-border text-center text-xs">
        <button
          type="button"
          onClick={onUsePassword}
          className="font-semibold text-primary hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs"
        >
          {t('app.magicLink.usePassword')}
        </button>
      </div>
    </AuthCard>
  );
}
