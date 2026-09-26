'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Save, Trash2 } from 'lucide-react';
import { SettingsNav } from '@/components/settings/settings-nav';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect } from '@/components/form/form-inputs';
import { ErrorState, Notice, SkeletonBlock } from '@/components/commercial/states';
import { fetchRetentionSettings, updateRetentionSettings, type RetentionResponse } from '@/lib/api/commercial';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { ReportBrandingCard } from '@/components/commercial/report-branding-card';

/** Select values: 'keep' = no automatic deletion, 'custom' = free number of days. */
const ARTIFACT_OPTIONS = [
  { value: 'keep', label: 'Keep until the project is deleted' },
  { value: '0', label: 'Delete immediately after analysis' },
  { value: '1', label: '24 hours' },
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: 'custom', label: 'Custom (enterprise)' },
];
const REPORT_OPTIONS = [
  { value: 'keep', label: 'Keep until deleted' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'custom', label: 'Custom' },
];

function toChoice(days: number | null, options: Array<{ value: string }>) {
  if (days === null) return { choice: 'keep', custom: '' };
  return options.some((o) => o.value === String(days)) ? { choice: String(days), custom: '' } : { choice: 'custom', custom: String(days) };
}

function fromChoice(choice: string, custom: string): number | null {
  if (choice === 'keep') return null;
  if (choice === 'custom') return Number(custom);
  return Number(choice);
}

function buildSchema(max: RetentionResponse['planMaximums']) {
  const maxArtifact = max?.maxArtifactRetentionDays ?? 3650;
  const maxReport = max?.maxReportRetentionDays ?? 3650;
  const days = (min: number, cap: number) =>
    z.string().refine((v) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= cap, {
      message: `Enter whole days between ${min} and ${cap} (plan maximum)`,
    });
  return z
    .object({
      artifactChoice: z.string(),
      artifactCustom: z.string(),
      reportChoice: z.string(),
      reportCustom: z.string(),
    })
    .superRefine((v, ctx) => {
      const check = (choice: string, custom: string, path: 'artifactCustom' | 'reportCustom', min: number, cap: number) => {
        if (choice === 'custom') {
          const r = days(min, cap).safeParse(custom);
          if (!r.success) ctx.addIssue({ code: 'custom', path: [path], message: r.error.issues[0].message });
        } else if (choice !== 'keep' && Number(choice) > cap) {
          ctx.addIssue({ code: 'custom', path: [path], message: `Your plan allows at most ${cap} days` });
        }
      };
      check(v.artifactChoice, v.artifactCustom, 'artifactCustom', 0, maxArtifact);
      check(v.reportChoice, v.reportCustom, 'reportCustom', 1, maxReport);
    });
}

function RetentionForm({ settings }: { settings: RetentionResponse }) {
  const queryClient = useQueryClient();
  const a = toChoice(settings.artifactRetentionDays, ARTIFACT_OPTIONS);
  const r = toChoice(settings.reportRetentionDays, REPORT_OPTIONS);
  const schema = React.useMemo(() => buildSchema(settings.planMaximums), [settings.planMaximums]);

  const save = useMutation({
    mutationFn: updateRetentionSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(['retention', 'settings'], data);
      const na = toChoice(data.artifactRetentionDays, ARTIFACT_OPTIONS);
      const nr = toChoice(data.reportRetentionDays, REPORT_OPTIONS);
      form.reset({ artifactChoice: na.choice, artifactCustom: na.custom, reportChoice: nr.choice, reportCustom: nr.custom });
    },
  });

  const form = useForm({
    defaultValues: { artifactChoice: a.choice, artifactCustom: a.custom, reportChoice: r.choice, reportCustom: r.custom },
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({
        artifactRetentionDays: fromChoice(value.artifactChoice, value.artifactCustom),
        reportRetentionDays: fromChoice(value.reportChoice, value.reportCustom),
      });
    },
  });

  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit, values: s.values })}
      children={({ isDirty, isSubmitting, canSubmit, values }) => (
        <DirtyGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="rounded-xl border border-border bg-card p-5 space-y-5"
            aria-labelledby="retention-heading"
          >
            <div>
              <h2 id="retention-heading" className="text-base font-semibold inline-flex items-center gap-2">
                <Trash2 className="size-4" aria-hidden="true" /> File retention
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Expired artifacts and reports are deleted from object storage and the database by an hourly job; every deletion is
                written to the audit log. Findings and evidence hashes remain for traceability.
                {settings.planMaximums && ` Your ${settings.planMaximums.tier} plan allows up to ${settings.planMaximums.maxArtifactRetentionDays} days for artifacts and ${settings.planMaximums.maxReportRetentionDays} days for reports.`}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <form.Field
                  name="artifactChoice"
                  children={(field) => (
                    <FormField id="artifact-retention" name={field.name} label="Uploaded artifacts">
                      <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={ARTIFACT_OPTIONS} />
                    </FormField>
                  )}
                />
                {values.artifactChoice === 'custom' && (
                  <form.Field
                    name="artifactCustom"
                    children={(field) => (
                      <FormField id="artifact-custom" name={field.name} label="Artifact retention (days)" required error={field.state.meta.errors as any}>
                        <FormInput inputMode="numeric" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                      </FormField>
                    )}
                  />
                )}
              </div>
              <div className="space-y-3">
                <form.Field
                  name="reportChoice"
                  children={(field) => (
                    <FormField id="report-retention" name={field.name} label="Generated reports">
                      <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={REPORT_OPTIONS} />
                    </FormField>
                  )}
                />
                {values.reportChoice === 'custom' && (
                  <form.Field
                    name="reportCustom"
                    children={(field) => (
                      <FormField id="report-custom" name={field.name} label="Report retention (days)" required error={field.state.meta.errors as any}>
                        <FormInput inputMode="numeric" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                      </FormField>
                    )}
                  />
                )}
              </div>
            </div>
            {values.artifactChoice === '0' && (
              <Notice tone="warning" title="Artifacts will be deleted right after each analysis">
                You will need to upload the files again to re-run an analysis. Unanalysed uploads are removed after 24 hours.
              </Notice>
            )}
            {save.isError && <ErrorState title="Retention settings were not saved" error={save.error} />}
            {save.isSuccess && !isDirty && <Notice tone="success" title="Retention settings saved" />}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!isDirty || !canSubmit || isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="size-4" aria-hidden="true" /> {isSubmitting ? 'Saving…' : 'Save retention policy'}
              </button>
              {isDirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
            </div>
          </form>
        </DirtyGuard>
      )}
    />
  );
}

function DirtyGuard({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return <>{children}</>;
}

export default function RetentionSettingsPage() {
  const query = useQuery({ queryKey: ['retention', 'settings'], queryFn: fetchRetentionSettings });
  return (
    <div className="min-h-screen bg-background text-foreground py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <SettingsNav />
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Data retention &amp; reports</h1>
          <p className="text-sm text-muted-foreground mt-1">Control how long customer artifacts and generated reports are stored.</p>
        </header>
        <div className="space-y-6">
          {query.isLoading ? (
            <SkeletonBlock className="h-64" />
          ) : query.isError ? (
            <ErrorState title="Could not load retention settings" error={query.error} onRetry={() => query.refetch()} />
          ) : query.data ? (
            <RetentionForm key={`${query.data.artifactRetentionDays}-${query.data.reportRetentionDays}`} settings={query.data} />
          ) : null}
          <ReportBrandingCard />
        </div>
      </div>
    </div>
  );
}

