'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { AlertCircle, Loader2, Plus, RefreshCw, Search, ThumbsUp, X } from 'lucide-react';
import {
  fetchFeedbackItems,
  createFeedbackItem,
  voteOnFeedbackItem,
  type CustomerFeedbackItem,
} from '../../lib/api-client';
import { Dialog } from '@/components/dialog';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { useErrorText, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

const STATUSES = ['ALL', 'UNDER_REVIEW', 'PLANNED', 'IN_PROGRESS', 'SHIPPED'] as const;
const TYPES = ['FEATURE_REQUEST', 'GAP_VOTE', 'ACCURACY_DISPUTE'] as const;
type FeedbackType = (typeof TYPES)[number];

const feedbackSchema = z.object({
  title: z.string().trim().min(3, vmsg('app.validation.minChars', { min: 3 })).max(200, vmsg('app.validation.maxChars', { max: 200 })),
  feedbackType: z.enum(TYPES),
  targetEngine: z.string().trim().max(100, vmsg('app.validation.maxChars', { max: 100 })),
  description: z.string().trim().min(10, vmsg('app.validation.minChars', { min: 10 })).max(5000, vmsg('app.validation.maxChars', { max: 5000 })),
});

const STATUS_TONE: Record<string, string> = {
  SHIPPED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800',
  IN_PROGRESS: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-300 dark:border-blue-800',
  PLANNED: 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300 border-purple-300 dark:border-purple-800',
};

function SubmitDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: createFeedbackItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['feedback'] });
      onClose();
    },
    onError: (err) => setFormError(errText(err, t('app.feedback.submitFailed'))),
  });

  const form = useForm({
    defaultValues: { title: '', feedbackType: 'FEATURE_REQUEST' as FeedbackType, targetEngine: '', description: '' },
    validators: { onSubmit: feedbackSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await createMutation
        .mutateAsync({
          title: value.title.trim(),
          description: value.description.trim(),
          feedbackType: value.feedbackType,
          targetEngine: value.targetEngine.trim() || undefined,
        })
        .catch(() => undefined);
    },
  });

  // Unsaved-changes guard: closing a dirty form asks for confirmation.
  const requestClose = () => {
    if (createMutation.isPending) return;
    if (form.state.isDirty && !window.confirm(t('app.feedback.discardConfirm'))) return;
    onClose();
  };

  return (
    <Dialog labelledBy="feedback-dialog-title" describedBy="feedback-dialog-intro" onClose={requestClose}>
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="feedback-dialog-title" className="text-xl font-bold text-foreground">{t('app.feedback.dialogTitle')}</h2>
          <p id="feedback-dialog-intro" className="text-sm text-muted-foreground">{t('app.feedback.dialogIntro')}</p>
        </div>
        <button
          type="button"
          onClick={requestClose}
          aria-label={t('app.ui.close')}
          className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        {formError && (
          <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}
        <form.Field
          name="title"
          children={(field) => (
            <FormField id="feedback-title" name={field.name} label={t('app.feedback.fieldTitle')} required error={field.state.meta.errors as any}>
              <FormInput
                type="text"
                placeholder={t('app.feedback.fieldTitlePlaceholder')}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        />
        <form.Field
          name="feedbackType"
          children={(field) => (
            <FormField id="feedback-type" name={field.name} label={t('app.feedback.fieldType')} required error={field.state.meta.errors as any}>
              <FormSelect
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value as FeedbackType)}
                onBlur={field.handleBlur}
                options={TYPES.map((type) => ({ value: type, label: label('app.feedback.type', type) }))}
              />
            </FormField>
          )}
        />
        <form.Field
          name="targetEngine"
          children={(field) => (
            <FormField id="feedback-engine" name={field.name} label={t('app.feedback.fieldEngine')} error={field.state.meta.errors as any}>
              <FormInput
                type="text"
                className="font-mono"
                placeholder={t('app.feedback.fieldEnginePlaceholder')}
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
            <FormField id="feedback-description" name={field.name} label={t('app.feedback.fieldDescription')} required error={field.state.meta.errors as any}>
              <FormTextarea
                rows={4}
                placeholder={t('app.feedback.fieldDescriptionPlaceholder')}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
              />
            </FormField>
          )}
        />
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={requestClose}
            disabled={createMutation.isPending}
            className="rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground hover:bg-muted"
          >
            {t('app.ui.cancel')}
          </button>
          <form.Subscribe
            selector={(s) => s.isSubmitting}
            children={(isSubmitting) => (
              <button
                type="submit"
                disabled={isSubmitting || createMutation.isPending}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-blue-600 disabled:opacity-50"
              >
                {isSubmitting || createMutation.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                    {t('app.feedback.submitting')}
                  </>
                ) : (
                  t('app.feedback.submitProposal')
                )}
              </button>
            )}
          />
        </div>
      </form>
    </Dialog>
  );
}

function FeedbackRow({ item }: { item: CustomerFeedbackItem }) {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const voteMutation = useMutation({
    mutationFn: voteOnFeedbackItem,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['feedback'] }),
  });
  const voteText = { title: item.title, count: item.votes };
  return (
    <li className="flex items-start gap-4 rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
      <button
        type="button"
        onClick={() => voteMutation.mutate(item.id)}
        disabled={voteMutation.isPending}
        aria-pressed={Boolean(item.hasVoted)}
        aria-label={item.hasVoted ? t('app.feedback.votedLabel', voteText) : t('app.feedback.voteLabel', voteText)}
        className={`flex h-14 w-12 shrink-0 flex-col items-center justify-center rounded-lg border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
          item.hasVoted
            ? 'border-primary bg-primary text-white shadow-sm'
            : 'border-border bg-muted/50 text-foreground hover:border-primary/50 hover:bg-muted'
        }`}
      >
        <ThumbsUp className="size-4" aria-hidden="true" />
        <span className="mt-1 text-xs font-bold" aria-hidden="true">{item.votes}</span>
      </button>
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded border px-2 py-0.5 text-xs font-bold ${STATUS_TONE[item.status] ?? 'bg-muted text-muted-foreground border-border'}`}>
            {label('app.feedback.status', item.status)}
          </span>
          {item.targetEngine && (
            <span className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{item.targetEngine}</span>
          )}
          <span className="text-xs font-semibold text-muted-foreground">{label('app.feedback.type', item.feedbackType)}</span>
        </div>
        <h2 className="break-words text-base font-bold text-foreground">{item.title}</h2>
        <p className="break-words text-sm leading-relaxed text-muted-foreground">{item.description}</p>
        {voteMutation.isError && (
          <p role="alert" className="text-sm text-destructive">{errText(voteMutation.error, t('app.feedback.voteFailed'))}</p>
        )}
      </div>
    </li>
  );
}

export default function FeedbackPage() {
  const t = useT();
  const [selectedStatus, setSelectedStatus] = useState<(typeof STATUSES)[number]>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);

  const { data: feedbackList = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['feedback'],
    queryFn: fetchFeedbackItems,
  });

  const q = searchQuery.trim().toLowerCase();
  const filteredItems = feedbackList.filter((item) => {
    const matchesStatus = selectedStatus === 'ALL' || item.status === selectedStatus;
    const matchesSearch =
      !q ||
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      Boolean(item.targetEngine && item.targetEngine.toLowerCase().includes(q));
    return matchesStatus && matchesSearch;
  });

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <span className="inline-block rounded bg-primary/10 px-2 py-0.5 text-xs font-bold uppercase tracking-wider text-primary">
            {t('app.feedback.badge')}
          </span>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">{t('app.feedback.title')}</h1>
          <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t('app.feedback.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsSubmitOpen(true)}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('app.feedback.submit')}
        </button>
      </div>

      <div className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-center">
        <div className="relative max-w-md flex-1">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            aria-label={t('app.feedback.searchLabel')}
            placeholder={t('app.feedback.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
          />
        </div>
        <div role="group" aria-label={t('app.feedback.filterLabel')} className="flex flex-wrap items-center gap-1.5">
          {STATUSES.map((st) => (
            <button
              key={st}
              type="button"
              aria-pressed={selectedStatus === st}
              onClick={() => setSelectedStatus(st)}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selectedStatus === st ? 'bg-primary text-white shadow-sm' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {t(`app.feedback.statusFilter.${st}`)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="space-y-3" role="status" aria-label={t('app.feedback.loading')}>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-xl border border-border bg-card motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {isError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">{t('app.feedback.loadError')}</span>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 font-semibold hover:bg-destructive/10"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" /> {t('app.ui.retry')}
          </button>
        </div>
      )}

      {!isLoading && !isError && filteredItems.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {feedbackList.length === 0 ? t('app.feedback.empty') : t('app.feedback.noMatch')}
        </p>
      )}

      {filteredItems.length > 0 && (
        <ul className="space-y-4">
          {filteredItems.map((item) => (
            <FeedbackRow key={item.id} item={item} />
          ))}
        </ul>
      )}

      {isSubmitOpen && <SubmitDialog onClose={() => setIsSubmitOpen(false)} />}
    </div>
  );
}
