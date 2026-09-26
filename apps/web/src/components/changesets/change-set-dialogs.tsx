'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { AlertCircle, GitBranch, Loader2, ShieldCheck } from 'lucide-react';
import { Dialog } from '@/components/dialog';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { approveChangeSet, createChangeSet, type ChangeSetItem } from '@/lib/api-client';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

/** Must stay aligned with the change types accepted by the change set API. */
export const CHANGE_TYPES = [
  'REMOVE_CUSTOM_FIELD',
  'MODIFY_OPD_RULE',
  'MIGRATE_API_VERSION',
  'SPLIT_TRANSPORT',
  'CUSTOM_CODE_REFACTOR',
] as const;
export const ENVIRONMENTS = ['DEV', 'QA', 'PROD'] as const;

const createSchema = z.object({
  name: z.string().trim().min(3, vmsg('app.validation.minChars', { min: 3 })).max(200, vmsg('app.validation.maxChars', { max: 200 })),
  description: z.string().trim().max(1000, vmsg('app.validation.maxChars', { max: 1000 })),
  changeType: z.enum(CHANGE_TYPES),
  targetObject: z.string().trim().min(1, vmsg('app.validation.targetObjectRequired')).max(200, vmsg('app.validation.maxChars', { max: 200 })),
  targetEnvironment: z.enum(ENVIRONMENTS),
});

const approveSchema = z.object({
  reason: z.string().trim().min(10, vmsg('app.validation.minChars', { min: 10 })).max(2000, vmsg('app.validation.maxChars', { max: 2000 })),
});

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

const cancelClass = 'rounded-lg border border-border px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted disabled:opacity-50';
const submitClass =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

export function CreateChangeSetDialog({
  projectId,
  targetRelease,
  onClose,
  onCreated,
}: {
  projectId: string;
  targetRelease?: string | null;
  onClose: () => void;
  onCreated: (created: ChangeSetItem) => void;
}) {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const [formError, setFormError] = React.useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (values: z.infer<typeof createSchema>) =>
      createChangeSet(projectId, {
        name: values.name,
        description: values.description || undefined,
        targetEnvironment: values.targetEnvironment,
        targetRelease: targetRelease ?? undefined,
        proposedChanges: [{ type: values.changeType, targetObject: values.targetObject, details: {} }],
      }),
    onSuccess: (created) => onCreated(created),
    onError: (err) => setFormError(errText(err, t('app.changesets.create.failed'))),
  });

  const form = useForm({
    defaultValues: {
      name: '',
      description: '',
      changeType: CHANGE_TYPES[0] as (typeof CHANGE_TYPES)[number],
      targetObject: '',
      targetEnvironment: 'QA' as (typeof ENVIRONMENTS)[number],
    },
    validators: { onSubmit: createSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await mutation
        .mutateAsync({
          ...value,
          name: value.name.trim(),
          description: value.description.trim(),
          targetObject: value.targetObject.trim(),
        })
        .catch(() => undefined);
    },
  });

  const requestClose = () => {
    if (mutation.isPending) return;
    if (form.state.isDirty && !window.confirm(t('app.changesets.create.discardConfirm'))) return;
    onClose();
  };

  return (
    <Dialog labelledBy="changeset-create-title" onClose={requestClose}>
      <h2 id="changeset-create-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <GitBranch className="size-5 text-primary" aria-hidden="true" />
        {t('app.changesets.create.title')}
      </h2>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <FormError message={formError} />
        <form.Field
          name="name"
          children={(field) => (
            <FormField id="changeset-name" name={field.name} label={t('app.changesets.create.name')} required error={field.state.meta.errors as any}>
              <FormInput
                placeholder={t('app.changesets.create.namePlaceholder')}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        />
        <form.Field
          name="description"
          children={(field) => (
            <FormField id="changeset-description" name={field.name} label={t('app.changesets.create.description')} error={field.state.meta.errors as any}>
              <FormTextarea
                rows={2}
                placeholder={t('app.changesets.create.descriptionPlaceholder')}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <form.Field
            name="changeType"
            children={(field) => (
              <FormField id="changeset-type" name={field.name} label={t('app.changesets.create.changeType')} required error={field.state.meta.errors as any}>
                <FormSelect
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as (typeof CHANGE_TYPES)[number])}
                  onBlur={field.handleBlur}
                  options={CHANGE_TYPES.map((type) => ({ value: type, label: label('app.changesets.changeType', type) }))}
                />
              </FormField>
            )}
          />
          <form.Field
            name="targetEnvironment"
            children={(field) => (
              <FormField id="changeset-env" name={field.name} label={t('app.changesets.create.environment')} required error={field.state.meta.errors as any}>
                <FormSelect
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as (typeof ENVIRONMENTS)[number])}
                  onBlur={field.handleBlur}
                  options={ENVIRONMENTS.map((env) => ({ value: env, label: env }))}
                />
              </FormField>
            )}
          />
        </div>
        <form.Field
          name="targetObject"
          children={(field) => (
            <FormField id="changeset-target" name={field.name} label={t('app.changesets.create.targetObject')} required error={field.state.meta.errors as any}>
              <FormInput
                isMono
                placeholder={t('app.changesets.create.targetObjectPlaceholder')}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={requestClose} disabled={mutation.isPending} className={cancelClass}>
            {t('app.ui.cancel')}
          </button>
          <button type="submit" disabled={mutation.isPending} className={`${submitClass} bg-primary text-primary-foreground hover:bg-primary/90`}>
            {mutation.isPending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {mutation.isPending ? t('app.changesets.create.submitting') : t('app.changesets.create.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export interface ChangeEvidencePack {
  auditCertificate?: string;
  approvedAt?: string;
  targetEnvironment?: string;
}

export function ApproveChangeSetDialog({
  projectId,
  changeSetId,
  onClose,
  onApproved,
}: {
  projectId: string;
  changeSetId: string;
  onClose: () => void;
  onApproved: (result: { changeset?: ChangeSetItem; evidencePack?: ChangeEvidencePack }) => void;
}) {
  const t = useT();
  const errText = useErrorText();
  const [formError, setFormError] = React.useState<string | null>(null);
  const mutation = useMutation({
    mutationFn: (reason: string) => approveChangeSet(projectId, changeSetId, reason),
    onSuccess: (res) => onApproved(res ?? {}),
    onError: (err) => setFormError(errText(err, t('app.changesets.approve.failed'))),
  });
  const form = useForm({
    defaultValues: { reason: '' },
    validators: { onSubmit: approveSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await mutation.mutateAsync(value.reason.trim()).catch(() => undefined);
    },
  });

  return (
    <Dialog labelledBy="changeset-approve-title" describedBy="changeset-approve-intro" onClose={() => !mutation.isPending && onClose()}>
      <h2 id="changeset-approve-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ShieldCheck className="size-5 text-emerald-600" aria-hidden="true" />
        {t('app.changesets.approve.title')}
      </h2>
      <p id="changeset-approve-intro" className="text-sm text-muted-foreground">
        {t('app.changesets.approve.intro')}
      </p>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        <FormError message={formError} />
        <form.Field
          name="reason"
          children={(field) => (
            <FormField id="changeset-reason" name={field.name} label={t('app.changesets.approve.reason')} required error={field.state.meta.errors as any}>
              <FormTextarea
                rows={3}
                placeholder={t('app.changesets.approve.reasonPlaceholder')}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        />
        <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={mutation.isPending} className={cancelClass}>
            {t('app.ui.cancel')}
          </button>
          <button type="submit" disabled={mutation.isPending} className={`${submitClass} bg-emerald-600 text-white hover:bg-emerald-700`}>
            {mutation.isPending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            {mutation.isPending ? t('app.changesets.approve.submitting') : t('app.changesets.approve.submit')}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function EvidencePackDialog({ pack, onClose }: { pack: ChangeEvidencePack; onClose: () => void }) {
  const t = useT();
  const fmt = useFmt();
  return (
    <Dialog labelledBy="evidence-pack-title" describedBy="evidence-pack-intro" onClose={onClose}>
      <div className="flex items-center gap-3">
        <ShieldCheck className="size-6 text-emerald-600" aria-hidden="true" />
        <h2 id="evidence-pack-title" className="text-base font-semibold text-foreground">
          {t('app.changesets.pack.title')}
        </h2>
      </div>
      <p id="evidence-pack-intro" className="text-sm text-muted-foreground">
        {t('app.changesets.pack.intro')}
      </p>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs font-semibold uppercase text-muted-foreground">{t('app.changesets.pack.hash')}</dt>
          <dd className="select-all break-all rounded border border-border bg-background p-2 font-mono text-xs text-primary">{pack.auditCertificate ?? '—'}</dd>
        </div>
        <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t('app.changesets.pack.approvedAt')}</dt>
            <dd className="font-medium text-foreground">{pack.approvedAt ? fmt.dateTime(pack.approvedAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t('app.changesets.pack.environment')}</dt>
            <dd className="font-mono font-medium text-foreground">{pack.targetEnvironment ?? '—'}</dd>
          </div>
        </div>
      </dl>
      <div className="flex justify-end pt-2">
        <button type="button" onClick={onClose} className={`${submitClass} bg-primary text-primary-foreground hover:bg-primary/90`}>
          {t('app.ui.close')}
        </button>
      </div>
    </Dialog>
  );
}
