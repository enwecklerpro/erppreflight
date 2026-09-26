'use client';

import * as React from 'react';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { CheckCircle2, CircleDashed, FileCode2, Loader2, Plus, Star, Trash2 } from 'lucide-react';
import { FormCheckbox, FormField, FormInput, FormSelect } from '@/components/form';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { Dialog } from '@/components/dialog';
import { ErrorState } from '@/components/commercial/states';
import { ApiError } from '@/lib/api/custom-instance';
import {
  activateApiBaseline,
  apiBaselineKeys,
  createApiBaseline,
  deleteApiBaseline,
  fetchApiBaselines,
  type ApiBaseline,
} from '@/lib/api/api-baselines';
import { useErrorText, useFmt, useT } from '@/i18n/client';
import type { MessageKey } from '@/i18n/translate';

export interface BaselineSourceFile {
  id: string;
  name: string;
  detectedFormat?: string | null;
}

const KNOWN_ERROR_CODES = new Set([
  'API_BASELINE_UNSUPPORTED_FORMAT',
  'API_BASELINE_EMPTY_SURFACE',
  'API_BASELINE_XML_DTD_FORBIDDEN',
  'API_BASELINE_NOT_TEXT',
  'API_BASELINE_TOO_LARGE',
  'API_BASELINE_EXISTS',
  'ARTIFACT_NOT_CLEAN',
  'API_BASELINE_NOT_FOUND',
]);

/** Server error text: known baseline error codes are translated, everything else uses the generic mapping. */
function useBaselineErrorText(): (error: unknown, fallback: string) => string {
  const t = useT();
  const errText = useErrorText();
  return React.useCallback(
    (error: unknown, fallback: string) => {
      if (error instanceof ApiError && error.code && KNOWN_ERROR_CODES.has(error.code)) {
        return t(`app.apiBaselines.errors.${error.code}` as MessageKey);
      }
      return errText(error, fallback);
    },
    [t, errText]
  );
}

function surfaceText(t: ReturnType<typeof useT>, b: ApiBaseline): string {
  const s = b.surface ?? {};
  return b.format === 'EDMX'
    ? t('app.apiBaselines.surfaceEdmx', { entityTypes: s.entityTypes ?? 0, entitySets: s.entitySets ?? 0 })
    : t('app.apiBaselines.surfaceOpenApi', { paths: s.paths ?? 0, operations: s.operations ?? 0, schemas: s.schemas ?? 0 });
}

/** Active / inactive is shown with icon + text, never colour alone. */
function StatusBadge({ active }: { active: boolean }) {
  const t = useT();
  return active ? (
    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
      <CheckCircle2 className="size-3" aria-hidden="true" /> {t('app.apiBaselines.statusActive')}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
      <CircleDashed className="size-3" aria-hidden="true" /> {t('app.apiBaselines.statusInactive')}
    </span>
  );
}

/**
 * Project registry of API Change Guard baselines: register from a CLEAN upload, list, activate, delete
 * (KNOWN_LIMITATIONS E4). Loading skeleton, empty and error states with retry (Axiom 1).
 */
export function ApiBaselinesPanel({ projectId, files }: { projectId: string; files: BaselineSourceFile[] }) {
  const t = useT();
  const fmt = useFmt();
  const qc = useQueryClient();
  const baselineError = useBaselineErrorText();
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = React.useState<ApiBaseline | null>(null);
  const key = apiBaselineKeys.list(projectId);

  const list = useQuery({ queryKey: key, queryFn: () => fetchApiBaselines(projectId), enabled: Boolean(projectId) });

  const activate = useMutation({
    mutationFn: (id: string) => activateApiBaseline(projectId, id),
    onSuccess: () => {
      setActionError(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => setActionError(baselineError(err, t('app.apiBaselines.activateFailed'))),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteApiBaseline(projectId, id),
    onSuccess: () => {
      setActionError(null);
      setPendingDelete(null);
      void qc.invalidateQueries({ queryKey: key });
    },
    onError: (err) => {
      setPendingDelete(null);
      setActionError(baselineError(err, t('app.apiBaselines.deleteFailed')));
    },
  });

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm" aria-labelledby="api-baselines-title" data-testid="api-baselines">
      <div>
        <h3 id="api-baselines-title" className="flex items-center gap-2 text-base font-bold text-foreground">
          <FileCode2 className="size-5 text-primary" aria-hidden="true" /> {t('app.apiBaselines.title')}
        </h3>
        <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{t('app.apiBaselines.description')}</p>
      </div>

      {actionError && (
        <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
          {actionError}
        </p>
      )}

      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true" aria-label={t('app.apiBaselines.loading')}>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 rounded-md bg-muted motion-safe:animate-pulse" />
          ))}
        </div>
      ) : list.isError ? (
        <ErrorState title={t('app.apiBaselines.loadError')} error={list.error} onRetry={() => void list.refetch()} />
      ) : !list.data?.length ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground" data-testid="api-baselines-empty">
          <p className="font-semibold text-foreground">{t('app.apiBaselines.empty')}</p>
          <p className="mt-1">{t('app.apiBaselines.emptyHint')}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-xs" data-testid="api-baselines-table">
            <caption className="sr-only">{t('app.apiBaselines.caption')}</caption>
            <thead className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-3">{t('app.apiBaselines.col.name')}</th>
                <th scope="col" className="py-2 pr-3">{t('app.apiBaselines.col.format')}</th>
                <th scope="col" className="py-2 pr-3">{t('app.apiBaselines.col.surface')}</th>
                <th scope="col" className="py-2 pr-3">{t('app.apiBaselines.col.hash')}</th>
                <th scope="col" className="py-2 pr-3">{t('app.apiBaselines.col.created')}</th>
                <th scope="col" className="py-2 pr-3">{t('app.apiBaselines.col.status')}</th>
                <th scope="col" className="py-2 text-right">{t('app.apiBaselines.col.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {list.data.map((b) => (
                <tr key={b.id} className="border-b border-border/60 align-top" data-baseline={b.name}>
                  <th scope="row" className="py-2 pr-3 font-semibold text-foreground">
                    {b.name}
                    <span className="block font-mono text-[11px] font-normal text-muted-foreground">@ {b.version}</span>
                    {b.sourceFileName && <span className="block text-[11px] font-normal text-muted-foreground">{b.sourceFileName}</span>}
                  </th>
                  <td className="py-2 pr-3">
                    {t(`app.apiBaselines.formats.${b.format}`)}
                    {b.specVersion && (
                      <span className="block text-[11px] text-muted-foreground">{t('app.apiBaselines.specVersion', { version: b.specVersion })}</span>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{surfaceText(t, b)}</td>
                  <td className="py-2 pr-3 font-mono text-[11px]" title={b.sha256}>
                    {b.sha256.slice(0, 12)}…
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">{fmt.dateTime(b.createdAt)}</td>
                  <td className="py-2 pr-3">
                    <StatusBadge active={b.isActive} />
                  </td>
                  <td className="py-2 text-right">
                    <div className="inline-flex gap-1.5">
                      {!b.isActive && (
                        <button
                          type="button"
                          onClick={() => activate.mutate(b.id)}
                          disabled={activate.isPending}
                          aria-label={t('app.apiBaselines.activateAria', { name: b.name, version: b.version })}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-60"
                        >
                          {activate.isPending && activate.variables === b.id ? (
                            <Loader2 className="size-3 motion-safe:animate-spin" aria-hidden="true" />
                          ) : (
                            <Star className="size-3" aria-hidden="true" />
                          )}
                          {activate.isPending && activate.variables === b.id ? t('app.apiBaselines.activating') : t('app.apiBaselines.activate')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setPendingDelete(b)}
                        aria-label={t('app.apiBaselines.deleteAria', { name: b.name, version: b.version })}
                        className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-[11px] font-semibold text-destructive hover:bg-destructive/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/40"
                      >
                        <Trash2 className="size-3" aria-hidden="true" /> {t('app.apiBaselines.delete')}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CreateBaselineForm projectId={projectId} files={files} />

      {pendingDelete && (
        <Dialog labelledBy="api-baseline-delete-title" describedBy="api-baseline-delete-body" onClose={() => setPendingDelete(null)}>
          <h2 id="api-baseline-delete-title" className="text-base font-bold text-foreground">
            {t('app.apiBaselines.confirmDeleteTitle')}
          </h2>
          <p id="api-baseline-delete-body" className="mt-2 text-sm text-muted-foreground">
            {t('app.apiBaselines.confirmDeleteBody', { name: pendingDelete.name, version: pendingDelete.version })}
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setPendingDelete(null)} className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              {t('app.apiBaselines.cancel')}
            </button>
            <button
              type="button"
              onClick={() => remove.mutate(pendingDelete.id)}
              disabled={remove.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-1.5 text-sm font-semibold text-destructive-foreground disabled:opacity-60"
            >
              {remove.isPending && <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />}
              {t('app.apiBaselines.confirmDelete')}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

function CreateBaselineForm({ projectId, files }: { projectId: string; files: BaselineSourceFile[] }) {
  const t = useT();
  const qc = useQueryClient();
  const baselineError = useBaselineErrorText();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [created, setCreated] = React.useState<string | null>(null);

  const schema = React.useMemo(
    () =>
      z.object({
        fileId: z.string().min(1, t('app.apiBaselines.form.fileRequired')),
        name: z.string().trim().min(1, t('app.apiBaselines.form.nameRequired')).max(200, t('app.apiBaselines.form.nameTooLong')),
        version: z.string().trim().max(100, t('app.apiBaselines.form.versionTooLong')),
        activate: z.boolean(),
      }),
    [t]
  );
  type Values = z.infer<typeof schema>;

  const mutation = useMutation({
    mutationFn: (v: Values) =>
      createApiBaseline(projectId, {
        fileId: v.fileId,
        name: v.name.trim(),
        ...(v.version.trim() ? { version: v.version.trim() } : {}),
        ...(v.activate ? { activate: true } : {}),
      }),
    onSuccess: (b) => {
      setCreated(t('app.apiBaselines.form.created', { name: b.name, version: b.version }));
      form.reset();
      void qc.invalidateQueries({ queryKey: apiBaselineKeys.list(projectId) });
    },
    onError: (err) => setServerError(baselineError(err, t('app.apiBaselines.form.createFailed'))),
  });

  const form = useForm({
    defaultValues: { fileId: '', name: '', version: '', activate: false } as Values,
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      setCreated(null);
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });

  const fileOptions = [
    { value: '', label: t('app.apiBaselines.form.filePlaceholder') },
    ...files.map((f) => ({ value: f.id, label: f.detectedFormat ? `${f.name} (${f.detectedFormat})` : f.name })),
  ];

  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <DirtyGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              void form.handleSubmit();
            }}
            noValidate
            aria-labelledby="api-baseline-form-title"
            className="space-y-3 rounded-lg border border-border bg-background p-4"
            data-testid="api-baseline-form"
          >
            <h4 id="api-baseline-form-title" className="flex items-center gap-1.5 text-sm font-semibold">
              <Plus className="size-4" aria-hidden="true" /> {t('app.apiBaselines.form.title')}
            </h4>
            {serverError && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
                {serverError}
              </p>
            )}
            {created && (
              <p role="status" className="flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
                <CheckCircle2 className="size-3.5" aria-hidden="true" /> {created}
              </p>
            )}
            {files.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('app.apiBaselines.form.noFiles')}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <form.Field
                  name="fileId"
                  children={(field) => (
                    <FormField
                      id="api-baseline-file"
                      name={field.name}
                      label={t('app.apiBaselines.form.file')}
                      description={t('app.apiBaselines.form.fileHint')}
                      required
                      error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}
                    >
                      <FormSelect
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        options={fileOptions}
                      />
                    </FormField>
                  )}
                />
                <form.Field
                  name="name"
                  children={(field) => (
                    <FormField
                      id="api-baseline-name"
                      name={field.name}
                      label={t('app.apiBaselines.form.name')}
                      required
                      error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}
                    >
                      <FormInput
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder={t('app.apiBaselines.form.namePlaceholder')}
                        maxLength={200}
                      />
                    </FormField>
                  )}
                />
                <form.Field
                  name="version"
                  children={(field) => (
                    <FormField
                      id="api-baseline-version"
                      name={field.name}
                      label={t('app.apiBaselines.form.version')}
                      description={t('app.apiBaselines.form.versionHint')}
                      error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}
                    >
                      <FormInput
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        maxLength={100}
                      />
                    </FormField>
                  )}
                />
                <form.Field
                  name="activate"
                  children={(field) => (
                    <div className="self-end pb-1">
                      <FormCheckbox
                        id="api-baseline-activate"
                        name={field.name}
                        checked={field.state.value}
                        onChange={(e) => field.handleChange(e.target.checked)}
                        label={t('app.apiBaselines.form.activate')}
                        description={t('app.apiBaselines.form.activateHint')}
                      />
                    </div>
                  )}
                />
              </div>
            )}
            <button
              type="submit"
              disabled={files.length === 0 || !canSubmit || isSubmitting || mutation.isPending}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {mutation.isPending ? (
                <Loader2 className="size-4 motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <Plus className="size-4" aria-hidden="true" />
              )}
              {mutation.isPending ? t('app.apiBaselines.form.submitting') : t('app.apiBaselines.form.submit')}
            </button>
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

/**
 * Launch option for API Change Guard: the project's active baseline (default, value '') or an explicit one.
 */
export function ApiBaselineSelector({
  projectId,
  value,
  onChange,
}: {
  projectId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const t = useT();
  const list = useQuery({ queryKey: apiBaselineKeys.list(projectId), queryFn: () => fetchApiBaselines(projectId), enabled: Boolean(projectId) });
  const baselines = list.data ?? [];
  const active = baselines.find((b) => b.isActive);

  React.useEffect(() => {
    // Drop a selection that no longer exists (baseline deleted meanwhile).
    if (value && list.isSuccess && !baselines.some((b) => b.id === value)) onChange('');
  }, [value, list.isSuccess, baselines, onChange]);

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3" data-testid="api-baseline-selector">
      <label htmlFor="launch-api-baseline" className="text-xs font-bold text-foreground">
        {t('app.apiBaselines.selector.label')}
      </label>
      <p className="text-[11px] text-muted-foreground" id="launch-api-baseline-hint">
        {t('app.apiBaselines.selector.hint')}
      </p>
      {list.isLoading ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground" role="status">
          <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" /> {t('app.apiBaselines.selector.loading')}
        </p>
      ) : list.isError ? (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-300" role="alert">
          {t('app.apiBaselines.selector.loadError')}
        </p>
      ) : baselines.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">{t('app.apiBaselines.selector.none')}</p>
      ) : (
        <select
          id="launch-api-baseline"
          aria-describedby="launch-api-baseline-hint"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40"
        >
          <option value="">
            {active
              ? t('app.apiBaselines.selector.useActive', { name: active.name, version: active.version })
              : t('app.apiBaselines.selector.noActive')}
          </option>
          {baselines.map((b) => (
            <option key={b.id} value={b.id}>
              {t('app.apiBaselines.selector.option', { name: b.name, version: b.version, format: t(`app.apiBaselines.formats.${b.format}`) })}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
