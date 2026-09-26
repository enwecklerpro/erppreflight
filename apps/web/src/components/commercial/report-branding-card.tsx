'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Palette, Save } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormTextarea } from '@/components/form/form-inputs';
import { ErrorState, Notice, SkeletonBlock } from '@/components/commercial/states';
import { fetchBillingOverview, fetchPlanCatalog, fetchReportBranding, updateReportBranding } from '@/lib/api/commercial';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const BrandingFormSchema = z.object({
  companyName: z.string().trim().max(120, vmsg('app.validation.maxChars', { max: 120 })),
  primaryColor: z.string().regex(/^(#[0-9A-Fa-f]{6})?$/, vmsg('app.validation.hexColor')),
  customDisclaimer: z.string().trim().max(1000, vmsg('app.validation.maxChars', { max: 1000 })),
});

/** Tenant report branding; editable only on plans with the reportBranding feature. */
export function ReportBrandingCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const branding = useQuery({ queryKey: ['reports', 'branding'], queryFn: fetchReportBranding });
  const overview = useQuery({ queryKey: ['billing', 'overview'], queryFn: fetchBillingOverview });
  const catalog = useQuery({ queryKey: ['billing', 'plans'], queryFn: fetchPlanCatalog, staleTime: 5 * 60_000 });
  const effective = catalog.data?.plans.find((p) => p.tier === overview.data?.effectiveTier);
  const allowed = effective?.features.reportBranding ?? false;

  if (branding.isLoading || overview.isLoading || catalog.isLoading) return <SkeletonBlock className="h-56" />;
  if (branding.isError) return <ErrorState title={t('app.retention.branding.loadFailed')} error={branding.error} onRetry={() => branding.refetch()} />;

  return (
    <BrandingForm
      key={JSON.stringify(branding.data)}
      initial={{
        companyName: branding.data?.companyName ?? '',
        primaryColor: branding.data?.primaryColor ?? '',
        customDisclaimer: branding.data?.customDisclaimer ?? '',
      }}
      allowed={allowed}
      onSaved={(data) => queryClient.setQueryData(['reports', 'branding'], data)}
    />
  );
}

function BrandingForm({
  initial,
  allowed,
  onSaved,
}: {
  initial: z.infer<typeof BrandingFormSchema>;
  allowed: boolean;
  onSaved: (data: unknown) => void;
}) {
  const t = useT();
  const save = useMutation({ mutationFn: updateReportBranding, onSuccess: onSaved });
  const form = useForm({
    defaultValues: initial,
    validators: { onChange: BrandingFormSchema, onSubmit: BrandingFormSchema },
    onSubmit: async ({ value }) => {
      await save.mutateAsync({
        ...(value.companyName ? { companyName: value.companyName } : {}),
        ...(value.primaryColor ? { primaryColor: value.primaryColor } : {}),
        ...(value.customDisclaimer ? { customDisclaimer: value.customDisclaimer } : {}),
      });
    },
  });

  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <Guarded isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
            noValidate
            className="rounded-xl border border-border bg-card p-5 space-y-4"
            aria-labelledby="branding-heading"
          >
            <div>
              <h2 id="branding-heading" className="text-base font-semibold inline-flex items-center gap-2">
                <Palette className="size-4" aria-hidden="true" /> {t('app.retention.branding.title')}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">{t('app.retention.branding.intro')}</p>
            </div>
            {!allowed && (
              <Notice tone="info" title={t('app.retention.branding.upgradeTitle')}>
                {t('app.retention.branding.upgradeBody')}
              </Notice>
            )}
            <fieldset disabled={!allowed} className="grid gap-4 sm:grid-cols-2 disabled:opacity-60">
              <form.Field
                name="companyName"
                children={(field) => (
                  <FormField id="brand-company" name={field.name} label={t('app.retention.branding.company')} error={field.state.meta.errors as any}>
                    <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                  </FormField>
                )}
              />
              <form.Field
                name="primaryColor"
                children={(field) => (
                  <FormField id="brand-color" name={field.name} label={t('app.retention.branding.color')} error={field.state.meta.errors as any}>
                    <FormInput placeholder="#0F2027" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                  </FormField>
                )}
              />
              <form.Field
                name="customDisclaimer"
                children={(field) => (
                  <FormField id="brand-disclaimer" name={field.name} label={t('app.retention.branding.disclaimer')} className="sm:col-span-2" error={field.state.meta.errors as any}>
                    <FormTextarea rows={3} value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
                  </FormField>
                )}
              />
            </fieldset>
            {save.isError && <ErrorState title={t('app.retention.branding.saveFailed')} error={save.error} />}
            {save.isSuccess && !isDirty && <Notice tone="success" title={t('app.retention.branding.saved')} />}
            <button
              type="submit"
              disabled={!allowed || !isDirty || !canSubmit || isSubmitting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              <Save className="size-4" aria-hidden="true" /> {isSubmitting ? t('app.retention.branding.saving') : t('app.retention.branding.save')}
            </button>
          </form>
        </Guarded>
      )}
    />
  );
}

function Guarded({ isDirty, isSubmitting, children }: { isDirty: boolean; isSubmitting: boolean; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, isSubmitting });
  return <>{children}</>;
}

export default ReportBrandingCard;
