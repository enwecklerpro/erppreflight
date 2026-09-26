'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Ban, Loader2, RotateCcw } from 'lucide-react';
import type { AnalysisDetail } from '@erppreflight/schemas';
import { Dialog } from '@/components/dialog';
import { FormField } from '@/components/form/form-field';
import { FormTextarea } from '@/components/form/form-inputs';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useErrorText, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';
import { analysisRunHref, analysisRunKeys, cancelAnalysisRun, rerunAnalysisRun } from '@/lib/api/analysis-lifecycle';
import { orchestrationKeys } from '@/lib/api/analysis-orchestration';

function DialogGuard({ dirty, submitting }: { dirty: boolean; submitting: boolean }) {
  useUnsavedChangesGuard({ isDirty: dirty, isSubmitting: submitting });
  return null;
}

/**
 * Cancel (with confirm dialog + optional reason) and re-run (with confirm dialog) for one
 * analysis run. Buttons are rendered only when the API grants the permission (role + state).
 */
export function RunActions({ detail, onMessage }: { detail: AnalysisDetail; onMessage: (message: { tone: 'info' | 'error'; text: string }) => void }) {
  const t = useT();
  const errText = useErrorText();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [dialog, setDialog] = React.useState<'cancel' | 'rerun' | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);
  const rerunRef = React.useRef<HTMLButtonElement>(null);
  const { analysis } = detail;
  const cancelRequested = Boolean(detail.cancellation?.requestedAt) && analysis.status !== 'CANCELLED';

  const refresh = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: analysisRunKeys.detail(analysis.id) });
    void queryClient.invalidateQueries({ queryKey: orchestrationKeys.progress(analysis.id) });
    void queryClient.invalidateQueries({ queryKey: orchestrationKeys.analysesByProject(analysis.projectId) });
  }, [queryClient, analysis.id, analysis.projectId]);

  const cancel = useMutation({
    mutationFn: (reason: string) => cancelAnalysisRun(analysis.id, reason),
    onSuccess: (res) => {
      setDialog(null);
      onMessage({ tone: 'info', text: t(`app.analysisRun.cancelOutcome.${res.outcome}` as MessageKey) });
      refresh();
    },
    onError: (err) => onMessage({ tone: 'error', text: t('app.analysisRun.actionError', { message: errText(err) }) }),
  });

  const rerun = useMutation({
    mutationFn: () => rerunAnalysisRun(analysis.id),
    onSuccess: (res) => {
      setDialog(null);
      refresh();
      router.push(analysisRunHref(analysis.projectId, res.analysisId));
    },
    onError: (err) => {
      setDialog(null);
      onMessage({ tone: 'error', text: t('app.analysisRun.actionError', { message: errText(err) }) });
    },
  });

  const form = useForm({
    defaultValues: { reason: '' },
    validators: {
      onChange: z.object({ reason: z.string().max(500, t('app.analysisRun.cancelDialog.reasonTooLong')) }),
    },
    onSubmit: async ({ value }) => {
      await cancel.mutateAsync(value.reason);
    },
  });

  const closeDialog = (which: 'cancel' | 'rerun') => {
    setDialog(null);
    if (which === 'cancel') form.reset();
    (which === 'cancel' ? cancelRef : rerunRef).current?.focus();
  };

  const isLab = analysis.kind.startsWith('LAB_');
  if (!detail.permissions.canCancel && !detail.permissions.canRerun) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {detail.permissions.canCancel && (
        <button
          ref={cancelRef}
          type="button"
          data-testid="analysis-cancel"
          onClick={() => setDialog('cancel')}
          disabled={cancelRequested || cancel.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 bg-card px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
        >
          <Ban className="size-3.5" aria-hidden="true" />
          {cancelRequested ? t('app.analysisRun.status.CANCELLING') : t('app.analysisRun.actions.cancel')}
        </button>
      )}
      {detail.permissions.canRerun && (
        <button
          ref={rerunRef}
          type="button"
          data-testid="analysis-rerun"
          onClick={() => setDialog('rerun')}
          disabled={rerun.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        >
          {rerun.isPending ? (
            <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          ) : (
            <RotateCcw className="size-3.5" aria-hidden="true" />
          )}
          {t('app.analysisRun.actions.rerun')}
        </button>
      )}

      {dialog === 'cancel' && (
        <Dialog labelledBy="cancel-run-title" describedBy="cancel-run-desc" onClose={() => closeDialog('cancel')}>
          <form.Subscribe
            selector={(s) => ({ dirty: s.isDirty, submitting: s.isSubmitting, canSubmit: s.canSubmit })}
            children={({ dirty, submitting, canSubmit }) => (
              <form
                noValidate
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  void form.handleSubmit();
                }}
              >
                <DialogGuard dirty={dirty} submitting={submitting} />
                <h2 id="cancel-run-title" className="text-base font-bold text-foreground">
                  {t('app.analysisRun.cancelDialog.title')}
                </h2>
                <p id="cancel-run-desc" className="text-sm text-muted-foreground">
                  {analysis.status === 'QUEUED' ? t('app.analysisRun.cancelDialog.queued') : t('app.analysisRun.cancelDialog.running')}
                </p>
                <form.Field
                  name="reason"
                  children={(field) => (
                    <FormField
                      id="cancel-run-reason"
                      name={field.name}
                      label={t('app.analysisRun.cancelDialog.reasonLabel')}
                      description={t('app.analysisRun.cancelDialog.reasonHint')}
                      error={field.state.meta.errors as never}
                    >
                      <FormTextarea
                        rows={3}
                        maxLength={600}
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                    </FormField>
                  )}
                />
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => closeDialog('cancel')}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    {t('app.analysisRun.cancelDialog.keep')}
                  </button>
                  <button
                    type="submit"
                    data-testid="analysis-cancel-confirm"
                    disabled={!canSubmit || submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/50"
                  >
                    {submitting && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
                    {submitting ? t('app.analysisRun.cancelDialog.cancelling') : t('app.analysisRun.cancelDialog.confirm')}
                  </button>
                </div>
              </form>
            )}
          />
        </Dialog>
      )}

      {dialog === 'rerun' && (
        <Dialog labelledBy="rerun-run-title" describedBy="rerun-run-desc" onClose={() => closeDialog('rerun')}>
          <h2 id="rerun-run-title" className="text-base font-bold text-foreground">
            {t('app.analysisRun.rerunDialog.title')}
          </h2>
          <p id="rerun-run-desc" className="text-sm text-muted-foreground">
            {isLab
              ? t('app.analysisRun.rerunDialog.labBody', { tests: Math.max(1, detail.inputs.testCaseIds.length) })
              : t('app.analysisRun.rerunDialog.body', { files: detail.inputs.files.length, engines: analysis.engineTypes.length })}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => closeDialog('rerun')}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {t('app.analysisRun.rerunDialog.close')}
            </button>
            <button
              type="button"
              data-testid="analysis-rerun-confirm"
              onClick={() => rerun.mutate()}
              disabled={rerun.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            >
              {rerun.isPending && <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              {rerun.isPending ? t('app.analysisRun.rerunDialog.starting') : t('app.analysisRun.rerunDialog.confirm')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
