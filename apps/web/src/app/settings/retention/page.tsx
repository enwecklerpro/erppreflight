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
import { useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';
import type { TFunction } from '@/i18n/translate';

/** Select values: 'keep' = no automatic deletion, 'custom' = free number of days. */
const ARTIFACT_OPTIONS = [{ value: 'keep' }, { value: '0' }, { value: '1' }, { value: '7' }, { value: '30' }, { value: 'custom' }];
const REPORT_OPTIONS = [{ value: 'keep' }, { value: '30' }, { value: '90' }, { value: '365' }, { value: 'custom' }];

const optionKey = (value: string) => (value === 'keep' || value === 'custom' ? value : `d${value}`);
function artifactOptions(t: TFunction) {
  return ARTIFACT_OPTIONS.map((o) => ({ value: o.value, label: t(`app.retention.artifactOptions.${optionKey(o.value)}` as 'app.retention.artifactOptions.keep') }));
}
function reportOptions(t: TFunction) {
  return REPORT_OPTIONS.map((o) => ({ value: o.value, label: t(`app.retention.reportOptions.${optionKey(o.value)}` as 'app.retention.reportOptions.keep') }));
}

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
      message: vmsg('app.retention.daysRange', { min, max: cap }),
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
          ctx.addIssue({ code: 'custom', path: [path], message: vmsg('app.retention.planMax', { max: cap }) });
        }
      };
      check(v.artifactChoice, v.artifactCustom, 'artifactCustom', 0, maxArtifact);
      check(v.reportChoice, v.reportCustom, 'reportCustom', 1, maxReport);
    });
}

function RetentionForm({ settings }: { settings: RetentionResponse }) {
  const t = useT();
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
                <Trash2 className="size-4" aria-hidden="true" /> {t('app.retention.heading')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                {t('app.retention.intro')}
                {settings.planMaximums &&
                  ` ${t('app.retention.planLimits', {
                    tier: settings.planMaximums.tier,
                    artifactDays: settings.planMaximums.maxArtifactRetentionDays,
                    reportDays: settings.planMaximums.maxReportRetentionDays,
                  })}`}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <form.Field
                  name="artifactChoice"
                  children={(field) => (
                    <FormField id="artifact-retention" name={field.name} label={t('app.retention.artifacts')}>
                      <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={artifactOptions(t)} />
                    </FormField>
                  )}
                />
                {values.artifactChoice === 'custom' && (
                  <form.Field
                    name="artifactCustom"
                    children={(field) => (
                      <FormField id="artifact-custom" name={field.name} label={t('app.retention.artifactCustom')} required error={field.state.meta.errors as any}>
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
                    <FormField id="report-retention" name={field.name} label={t('app.retention.reports')}>
                      <FormSelect value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} options={reportOptions(t)} />
                    </FormField>
                  )}
                />
                {values.reportChoice === 'custom' && (
                  <form.Field
                    name="reportCustom"
                    children={(field) => (
                      <FormField id="report-custom" name={field.name} label={t('app.retention.reportCustom')} required error={field.state.meta.errors as any}>
                        <FormInput inputMode="numeric" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                      </FormField>
                    )}
                  />
                )}
              </div>
            </div>
            {values.artifactChoice === '0' && (
              <Notice tone="warning" title={t('app.retention.immediateTitle')}>
                {t('app.retention.immediateBody')}
              </Notice>
            )}
            {save.isError && <ErrorState title={t('app.retention.saveFailed')} error={save.error} />}
            {save.isSuccess && !isDirty && <Notice tone="success" title={t('app.retention.saved')} />}
            <div className="flex items-center gap-3">
              <button
                type="submit"
                disabled={!isDirty || !canSubmit || isSubmitting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                <Save className="size-4" aria-hidden="true" /> {isSubmitting ? t('app.retention.saving') : t('app.retention.save')}
              </button>
              {isDirty && <span className="text-xs text-muted-foreground">{t('app.retention.unsaved')}</span>}
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
  const t = useT();
  const query = useQuery({ queryKey: ['retention', 'settings'], queryFn: fetchRetentionSettings });
  return (
    <div className="text-foreground">
      <div className="max-w-4xl mx-auto">
        <SettingsNav />
        <header className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">{t('app.retention.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('app.retention.subtitle')}</p>
        </header>
        <div className="space-y-6">
          {query.isLoading ? (
            <SkeletonBlock className="h-64" />
          ) : query.isError ? (
            <ErrorState title={t('app.retention.loadFailed')} error={query.error} onRetry={() => query.refetch()} />
          ) : query.data ? (
            <RetentionForm settings={query.data} />
          ) : null}
          <ReportBrandingCard />
        </div>
      </div>
    </div>
  );
}

