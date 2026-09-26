'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { CheckCircle2, Loader2, MapPin, Save } from 'lucide-react';
import {
  DeploymentTypeEnum,
  SourceErpEnum,
  TargetProductEnum,
  TargetReleaseEnum,
  type ProjectContextUpdate,
} from '@erppreflight/schemas';
import { FormField, FormInput, FormSelect } from '@/components/form';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { updateProjectContext } from '@/lib/api/analysis-orchestration';
import { errorMessage } from '@/components/commercial/states';
import type { ProjectRecord } from '@/lib/api-client';

type ContextValues = {
  sourceErp: string;
  sourceVersion: string;
  targetProduct: string;
  targetEdition: string;
  targetRelease: string;
  deploymentType: string;
  countries: string;
  modules: string;
};

const splitList = (v: string) =>
  v
    .split(/[,;\s]+/)
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);

/** Converts form values to the validated API payload (throws ZodError on invalid lists). */
export function toContextPayload(v: ContextValues): ProjectContextUpdate {
  return {
    sourceErp: v.sourceErp ? (v.sourceErp as ProjectContextUpdate['sourceErp']) : null,
    sourceVersion: v.sourceVersion.trim() || null,
    targetProduct: v.targetProduct ? (v.targetProduct as ProjectContextUpdate['targetProduct']) : null,
    targetEdition: v.targetEdition.trim() || null,
    targetRelease: v.targetRelease as ProjectContextUpdate['targetRelease'],
    deploymentType: v.deploymentType ? (v.deploymentType as ProjectContextUpdate['deploymentType']) : null,
    countries: splitList(v.countries),
    modules: splitList(v.modules),
  };
}

function DirtyGuard({ isDirty, isSubmitting, message, children }: { isDirty: boolean; isSubmitting: boolean; message: string; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting, message });
  return <>{children}</>;
}

/** Project mode context (Part 01 §1.5) — TanStack Form + Zod, dirty tracking, server errors. */
/**
 * The workspace remounts this form when the refetched project arrives (key = updatedAt), which
 * would drop the confirmation right after a save; remember recent saves per project instead.
 */
const recentSaves = new Map<string, number>();
const SAVED_NOTICE_MS = 8000;

export function ProjectContextForm({ project }: { project: ProjectRecord }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [saved, setSaved] = React.useState(() => Date.now() - (recentSaves.get(project.id) ?? 0) < SAVED_NOTICE_MS);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const ctx = ((project as { context?: Record<string, unknown> }).context ?? {}) as Record<string, any>;

  const schema = React.useMemo(
    () =>
      z.object({
        sourceErp: z.union([z.literal(''), SourceErpEnum]),
        sourceVersion: z.string().max(80),
        targetProduct: z.union([z.literal(''), TargetProductEnum]),
        targetEdition: z.string().max(80),
        targetRelease: TargetReleaseEnum,
        deploymentType: z.union([z.literal(''), DeploymentTypeEnum]),
        countries: z
          .string()
          .refine((v) => splitList(v).every((c) => /^[A-Z]{2}$/.test(c)), t('projectContext.countriesHelp')),
        modules: z
          .string()
          .refine((v) => splitList(v).every((m) => /^[A-Z][A-Z0-9_-]{0,19}$/.test(m)), t('projectContext.modulesHelp')),
      }),
    [t]
  );

  const defaults: ContextValues = {
    sourceErp: ctx.sourceErp ?? '',
    sourceVersion: ctx.sourceVersion ?? '',
    targetProduct: ctx.targetProduct ?? '',
    targetEdition: ctx.targetEdition ?? '',
    targetRelease: (project.targetRelease as string) || 'S4H_2023',
    deploymentType: ctx.deploymentType ?? '',
    countries: Array.isArray(ctx.countries) ? ctx.countries.join(', ') : '',
    modules: Array.isArray(ctx.modules) ? ctx.modules.join(', ') : '',
  };

  const mutation = useMutation({
    mutationFn: (v: ContextValues) => updateProjectContext(project.id, toContextPayload(v)),
    onSuccess: (_res, v) => {
      recentSaves.set(project.id, Date.now());
      setSaved(true);
      form.reset(v);
      void queryClient.invalidateQueries({ queryKey: ['project', project.id] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (err) => setServerError(t('projectContext.saveFailed', { message: errorMessage(err) })),
  });

  const form = useForm({
    defaultValues: defaults,
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      recentSaves.delete(project.id);
      setSaved(false);
      setServerError(null);
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  const option = (v: string) => ({ value: v, label: t(`projectContext.options.${v}` as MessageKey) });
  const notSet = { value: '', label: t('projectContext.notSet') };

  const textField = (name: 'sourceVersion' | 'targetEdition' | 'countries' | 'modules', label: string, placeholder: string, description?: string) => (
    <form.Field
      name={name}
      children={(field) => (
        <FormField id={`ctx-${name}`} name={field.name} label={label} description={description} error={field.state.meta.errors as any}>
          <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} placeholder={placeholder} />
        </FormField>
      )}
    />
  );

  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <DirtyGuard isDirty={isDirty} isSubmitting={isSubmitting} message={t('projectContext.unsavedWarning')}>
          <form
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm"
            aria-labelledby="ctx-title"
            data-testid="project-context-form"
          >
            <div>
              <h2 id="ctx-title" className="flex items-center gap-2 text-base font-bold text-foreground">
                <MapPin className="size-5 text-primary" aria-hidden="true" /> {t('projectContext.title')}
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">{t('projectContext.description')}</p>
            </div>
            {serverError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {serverError}
              </p>
            )}
            {saved && !isDirty && (
              <p role="status" className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <CheckCircle2 className="size-3.5" aria-hidden="true" /> {t('projectContext.saved')}
              </p>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              <form.Field
                name="sourceErp"
                children={(field) => (
                  <FormField id="ctx-sourceErp" name={field.name} label={t('projectContext.sourceErp')}>
                    <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={[notSet, ...SourceErpEnum.options.map(option)]} />
                  </FormField>
                )}
              />
              {textField('sourceVersion', t('projectContext.sourceVersion'), t('projectContext.sourceVersionPlaceholder'))}
              <form.Field
                name="targetProduct"
                children={(field) => (
                  <FormField id="ctx-targetProduct" name={field.name} label={t('projectContext.targetProduct')}>
                    <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={[notSet, ...TargetProductEnum.options.map(option)]} />
                  </FormField>
                )}
              />
              {textField('targetEdition', t('projectContext.targetEdition'), t('projectContext.targetEditionPlaceholder'))}
              <form.Field
                name="targetRelease"
                children={(field) => (
                  <FormField id="ctx-targetRelease" name={field.name} label={t('projectContext.targetRelease')}>
                    <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={TargetReleaseEnum.options.map((r) => ({ value: r, label: r }))} />
                  </FormField>
                )}
              />
              <form.Field
                name="deploymentType"
                children={(field) => (
                  <FormField id="ctx-deploymentType" name={field.name} label={t('projectContext.deploymentType')}>
                    <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={[notSet, ...DeploymentTypeEnum.options.map(option)]} />
                  </FormField>
                )}
              />
              {textField('countries', t('projectContext.countries'), t('projectContext.countriesPlaceholder'), t('projectContext.countriesHelp'))}
              {textField('modules', t('projectContext.modules'), t('projectContext.modulesPlaceholder'), t('projectContext.modulesHelp'))}
            </div>
            <div className="flex justify-end border-t border-border pt-3">
              <button
                type="submit"
                disabled={!canSubmit || !isDirty || isSubmitting || mutation.isPending}
                data-testid="project-context-save"
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {mutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                {mutation.isPending ? t('projectContext.saving') : t('projectContext.save')}
              </button>
            </div>
          </form>
        </DirtyGuard>
      )}
    />
  );
}
