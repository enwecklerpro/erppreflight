'use client';

import * as React from 'react';
import { useForm, useStore } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { KeyRound, Lock } from 'lucide-react';
import { PASSWORD_MIN_LENGTH, PasswordSchema } from '@erppreflight/schemas';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { accountKeys, changePassword, storeSession } from '@/lib/account-api';
import { useErrorText, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import { Notice, Pending, SettingsSection, buttonClass } from './ui';

const schema = z
  .object({
    currentPassword: z.string().min(1, vmsg('app.validation.currentPasswordRequired')),
    newPassword: PasswordSchema,
    confirm: z.string().min(1, vmsg('app.validation.confirmPasswordRequired')),
  })
  .refine((v) => v.newPassword === v.confirm, { message: vmsg('app.validation.passwordsMismatch'), path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: vmsg('app.apiErrors.newPasswordSame'),
    path: ['newPassword'],
  });

type FieldName = 'currentPassword' | 'newPassword' | 'confirm';

export function ChangePasswordForm() {
  const t = useT();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(false);
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => changePassword(v.currentPassword, v.newPassword),
    onSuccess: (session) => {
      // The server revoked every other session and issued a new one for this browser.
      storeSession(session);
      queryClient.invalidateQueries({ queryKey: accountKeys.sessions });
    },
  });

  const form = useForm({
    defaultValues: { currentPassword: '', newPassword: '', confirm: '' },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setSaved(false);
      await mutation
        .mutateAsync(value)
        .then(() => {
          setSaved(true);
          form.reset();
        })
        .catch(() => undefined);
    },
  });
  const isDirty = useStore(form.store, (s) => s.isDirty);
  useUnsavedChangesGuard({ isDirty, isSubmitting: mutation.isPending });

  const field = (name: FieldName, label: string, autoComplete: string, description?: string) => (
    <form.Field
      name={name}
      children={(f) => (
        <FormField
          id={`cp-${name}`}
          name={f.name}
          label={label}
          description={description}
          required
          error={f.state.meta.isTouched ? (f.state.meta.errors as any) : undefined}
        >
          <FormInput
            type="password"
            autoComplete={autoComplete}
            value={f.state.value}
            onChange={(e) => f.handleChange(e.target.value)}
            onBlur={f.handleBlur}
            leftIcon={<Lock className="size-4" />}
          />
        </FormField>
      )}
    />
  );

  return (
    <SettingsSection
      id="password"
      title={t('app.security.password.title')}
      icon={KeyRound}
      description={t('app.security.password.hint')}
    >
      {saved && <Notice tone="success" title={t('app.security.password.savedTitle')}>{t('app.security.password.savedBody')}</Notice>}
      {mutation.isError && <Notice tone="error" title={t('app.security.password.failed')}>{errText(mutation.error)}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        noValidate
        className="grid gap-4 sm:grid-cols-3"
      >
        {field('currentPassword', t('app.security.password.current'), 'current-password')}
        {field('newPassword', t('app.security.password.new'), 'new-password', t('app.security.password.newHint', { min: PASSWORD_MIN_LENGTH }))}
        {field('confirm', t('app.security.password.confirm'), 'new-password')}
        <div className="sm:col-span-3 flex justify-end">
          <form.Subscribe
            selector={(s) => [s.isSubmitting, s.isDirty] as const}
            children={([isSubmitting, dirty]) => (
              <button type="submit" disabled={!dirty || isSubmitting || mutation.isPending} className={buttonClass.primary}>
                <Pending busy={isSubmitting || mutation.isPending} busyLabel={t('app.security.password.saving')} idle={t('app.security.password.submit')} />
              </button>
            )}
          />
        </div>
      </form>
    </SettingsSection>
  );
}
