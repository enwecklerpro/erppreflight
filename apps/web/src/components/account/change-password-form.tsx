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
import { accountKeys, changePassword, errorMessage, storeSession } from '@/lib/account-api';
import { Notice, Pending, SettingsSection, buttonClass } from './ui';

const schema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password'),
    newPassword: PasswordSchema,
    confirm: z.string().min(1, 'Please confirm the new password'),
  })
  .refine((v) => v.newPassword === v.confirm, { message: 'Passwords do not match', path: ['confirm'] })
  .refine((v) => v.newPassword !== v.currentPassword, {
    message: 'The new password must differ from the current password',
    path: ['newPassword'],
  });

type FieldName = 'currentPassword' | 'newPassword' | 'confirm';

export function ChangePasswordForm() {
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
      title="Password"
      icon={KeyRound}
      description="Changing your password signs out every other session."
    >
      {saved && <Notice tone="success" title="Password changed">Other sessions were signed out.</Notice>}
      {mutation.isError && <Notice tone="error" title="Password not changed">{errorMessage(mutation.error)}</Notice>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        noValidate
        className="grid gap-4 sm:grid-cols-3"
      >
        {field('currentPassword', 'Current password', 'current-password')}
        {field('newPassword', 'New password', 'new-password', `Min. ${PASSWORD_MIN_LENGTH} characters, 3 character types`)}
        {field('confirm', 'Confirm new password', 'new-password')}
        <div className="sm:col-span-3 flex justify-end">
          <form.Subscribe
            selector={(s) => [s.isSubmitting, s.isDirty] as const}
            children={([isSubmitting, dirty]) => (
              <button type="submit" disabled={!dirty || isSubmitting || mutation.isPending} className={buttonClass.primary}>
                <Pending busy={isSubmitting || mutation.isPending} busyLabel="Saving..." idle="Change password" />
              </button>
            )}
          />
        </div>
      </form>
    </SettingsSection>
  );
}
