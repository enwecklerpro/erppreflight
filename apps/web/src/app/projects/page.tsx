'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from '@tanstack/react-form';
import { z } from 'zod';
import { fetchProjects, createProject, CreateProjectPayload, ProjectRecord } from '../../lib/api-client';
import { FolderGit2, Plus, ArrowRight, Calendar, Server, X, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput, FormSelect, FormTextarea } from '@/components/form/form-inputs';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';
import { vmsg } from '@/i18n/validation';

// Must stay aligned with TargetReleaseEnum in @erppreflight/schemas.
const TARGET_RELEASES = ['S4H_2023', 'S4HC_2408', 'S4HC_2402', 'S4H_2022', 'S4H_2021', 'S4H_2020'] as const;

const createProjectSchema = z.object({
  name: z.string().trim().min(1, vmsg('app.validation.required')).max(200),
  targetRelease: z.enum(TARGET_RELEASES),
  description: z.string().max(2000),
});

function CreateProjectDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (payload: CreateProjectPayload) => createProject(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
      onClose();
    },
    onError: (err: unknown) => setFormError(errText(err, t('app.projects.create.failed'))),
  });

  const form = useForm({
    defaultValues: { name: '', targetRelease: 'S4H_2023' as (typeof TARGET_RELEASES)[number], description: '' },
    validators: { onSubmit: createProjectSchema },
    onSubmit: async ({ value }) => {
      setFormError(null);
      await createMutation
        .mutateAsync({
          name: value.name.trim(),
          description: value.description.trim() || undefined,
          targetRelease: value.targetRelease,
        })
        .catch(() => undefined);
    },
  });

  // Escape closes; focus moves into the dialog and returns to the trigger on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !createMutation.isPending) onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previouslyFocused?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        aria-describedby="create-project-intro"
        className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl p-6 relative max-h-[calc(100vh-2rem)] overflow-y-auto"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          aria-label={t('app.projects.create.close')}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex items-center gap-2 mb-1 pr-8">
          <FolderGit2 className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 id="create-project-title" className="text-lg font-extrabold text-foreground">
            {t('app.projects.create.title')}
          </h2>
        </div>
        <p id="create-project-intro" className="text-sm text-muted-foreground mb-5">
          {t('app.projects.create.intro')}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
          noValidate
          className="space-y-4"
        >
          {formError && (
            <div role="alert" className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-sm rounded-lg flex items-center gap-2">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <form.Field
            name="name"
            children={(field) => (
              <FormField id="project-name" name={field.name} label={t('app.projects.create.name')} required error={field.state.meta.errors as any}>
                <FormInput
                  type="text"
                  placeholder={t('app.projects.create.namePlaceholder')}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          />

          <form.Field
            name="targetRelease"
            children={(field) => (
              <FormField
                id="project-release"
                name={field.name}
                label={t('app.projects.create.release')}
                description={t('app.projects.create.releaseHint')}
                required
                error={field.state.meta.errors as any}
              >
                <FormSelect
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value as (typeof TARGET_RELEASES)[number])}
                  onBlur={field.handleBlur}
                  options={TARGET_RELEASES.map((r) => ({ value: r, label: label('app.projects.releases', r) }))}
                />
              </FormField>
            )}
          />

          <form.Field
            name="description"
            children={(field) => (
              <FormField id="project-description" name={field.name} label={t('app.projects.create.description')} error={field.state.meta.errors as any}>
                <FormTextarea
                  rows={3}
                  placeholder={t('app.projects.create.descriptionPlaceholder')}
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )}
          />

          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-2 pt-4 border-t border-border mt-5">
            <button
              type="button"
              onClick={onClose}
              disabled={createMutation.isPending}
              className="px-3.5 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors"
            >
              {t('app.ui.cancel')}
            </button>
            <form.Subscribe
              selector={(s) => s.isSubmitting}
              children={(isSubmitting) => (
                <button
                  type="submit"
                  disabled={isSubmitting || createMutation.isPending}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 shadow-sm"
                >
                  {isSubmitting || createMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      {t('app.projects.create.submitting')}
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                      {t('app.projects.create.submit')}
                    </>
                  )}
                </button>
              )}
            />
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const [isModalOpen, setIsModalOpen] = useState(false);

  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<ProjectRecord[]>({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 1000 * 30,
  });

  const newProjectButton = (
    <button
      type="button"
      onClick={() => setIsModalOpen(true)}
      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
    >
      <Plus className="h-4 w-4" aria-hidden="true" />
      {t('app.projects.newProject')}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <FolderGit2 className="h-6 w-6 text-primary" aria-hidden="true" />
            {t('app.projects.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t('app.projects.subtitle')}</p>
        </div>
        {newProjectButton}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5" aria-busy="true" aria-label={t('app.ui.loading')}>
          {[1, 2].map((i) => (
            <div key={i} className="bg-card border border-border rounded-xl p-6 h-48 animate-pulse motion-reduce:animate-none flex flex-col justify-between">
              <div className="space-y-3">
                <div className="h-4 bg-muted rounded w-28" />
                <div className="h-6 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-full" />
              </div>
              <div className="h-4 bg-muted rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div role="alert" className="p-8 text-center bg-card border border-border rounded-xl">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" aria-hidden="true" />
          <p className="text-sm font-semibold text-foreground">{t('app.projects.loadErrorTitle')}</p>
          <p className="text-sm text-muted-foreground mt-1">{errText(error)}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-4 px-3 py-1.5 bg-primary text-white text-sm font-medium rounded-lg hover:bg-blue-600 transition-colors"
          >
            {t('app.ui.retry')}
          </button>
        </div>
      ) : projects.length === 0 ? (
        <div className="p-12 text-center bg-card border border-dashed border-border rounded-xl">
          <FolderGit2 className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-60" aria-hidden="true" />
          <h2 className="text-base font-bold text-foreground">{t('app.projects.emptyTitle')}</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{t('app.projects.emptyBody')}</p>
          <button
            type="button"
            onClick={() => setIsModalOpen(true)}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {t('app.projects.createFirst')}
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {projects.map((proj) => (
            <li
              key={proj.id}
              className="bg-card border border-border rounded-xl p-6 shadow-sm hover:border-primary/50 transition-colors flex flex-col justify-between min-w-0"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <Server className="h-3 w-3" aria-hidden="true" />
                    {t('app.projects.target', { release: proj.targetRelease || t('app.projects.targetNotSet') })}
                  </span>
                  {proj.status && (
                    <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {label('app.projects.status', proj.status)}
                    </span>
                  )}
                </div>

                <h2 className="text-lg font-bold text-foreground mt-3 break-words">{proj.name}</h2>
                <p className="text-sm text-muted-foreground mt-2 leading-relaxed break-words">
                  {proj.description || t('app.projects.noDescription')}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-border flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" aria-hidden="true" />
                  {proj.createdAt ? t('app.projects.created', { date: fmt.date(proj.createdAt) }) : t('app.projects.createdUnknown')}
                </span>

                <Link
                  href={`/projects/${proj.id}`}
                  className="inline-flex items-center gap-1 text-sm font-semibold text-primary hover:text-blue-700 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  {t('app.projects.enter')}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}

      {isModalOpen && <CreateProjectDialog onClose={() => setIsModalOpen(false)} />}
    </div>
  );
}
