'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ArrowRight, KeyRound, Smartphone } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { AuthCard, Notice, Pending, buttonClass } from '@/components/account/ui';
import { completeSecondFactor, type MfaChallenge, type SessionResponse } from '@/lib/account-api';
import { useErrorText, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

/** Accepts a 6-digit TOTP code or a recovery code (the API checks which one it is). */
const secondFactorSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^(\d{6}|[A-Za-z0-9]{5}-?[A-Za-z0-9]{5})$/, vmsg('app.validation.totpOrRecovery')),
});

/**
 * TOTP / recovery-code step after the first factor (password or magic link).
 * Completes POST /auth/login/2fa; the session arrives as the HttpOnly cookie.
 */
export function SecondFactorStep({
  challenge,
  onSuccess,
  onCancel,
}: {
  challenge: MfaChallenge;
  onSuccess: (session: SessionResponse) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const errText = useErrorText();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [useRecovery, setUseRecovery] = React.useState(false);

  const mutation = useMutation({
    mutationFn: (code: string) =>
      completeSecondFactor(challenge.challengeToken, useRecovery ? { recoveryCode: code.trim() } : { code: code.trim() }),
    onSuccess,
    onError: (err) => setServerError(errText(err, t('app.auth.login.invalidCode'))),
  });

  const codeForm = useForm({
    defaultValues: { code: '' },
    validators: { onSubmit: secondFactorSchema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      await mutation.mutateAsync(value.code).catch(() => undefined);
    },
  });

  return (
    <AuthCard
      title={t('app.auth.login.mfaTitle')}
      subtitle={useRecovery ? t('app.auth.login.mfaRecoverySubtitle') : t('app.auth.login.mfaSubtitle')}
      icon={Smartphone}
    >
      {serverError && <Notice tone="error" title={t('app.auth.login.mfaFailed')} className="mb-5">{serverError}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          codeForm.handleSubmit();
        }}
        noValidate
        className="space-y-5"
      >
        <codeForm.Field
          name="code"
          children={(field) => (
            <FormField
              id="login-code"
              name={field.name}
              label={useRecovery ? t('app.auth.login.recoveryCode') : t('app.auth.login.authCode')}
              required
              error={field.state.meta.errors as any}
            >
              <FormInput
                autoFocus
                inputMode={useRecovery ? 'text' : 'numeric'}
                autoComplete="one-time-code"
                placeholder={useRecovery ? 'abcde-12345' : '123456'}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                leftIcon={<KeyRound className="size-4" />}
              />
            </FormField>
          )}
        />
        <codeForm.Subscribe
          selector={(s) => s.isSubmitting}
          children={(isSubmitting) => (
            <button type="submit" disabled={isSubmitting || mutation.isPending} className={`${buttonClass.primary} w-full`}>
              <Pending
                busy={isSubmitting || mutation.isPending}
                busyLabel={t('app.auth.login.verifying')}
                idle={<>{t('app.auth.login.verify')}<ArrowRight className="size-3.5" aria-hidden="true" /></>}
              />
            </button>
          )}
        />
      </form>
      <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-between text-xs">
        <button
          type="button"
          className="text-primary font-semibold hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs text-left"
          onClick={() => {
            setUseRecovery((v) => !v);
            setServerError(null);
            codeForm.reset();
          }}
        >
          {useRecovery ? t('app.auth.login.useApp') : t('app.auth.login.useRecovery')}
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground hover:underline focus:outline-none focus-visible:ring-1 focus-visible:ring-primary rounded-xs text-left"
          onClick={onCancel}
        >
          {t('app.auth.backToSignIn')}
        </button>
      </div>
    </AuthCard>
  );
}
