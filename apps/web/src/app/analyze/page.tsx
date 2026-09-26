'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { CheckCircle2, FileText, FolderPlus, Loader2, Play, Search, ShieldAlert, UploadCloud } from 'lucide-react';
import { TargetReleaseEnum, type ProblemRouteResponse, type Severity } from '@erppreflight/schemas';
import { FormField, FormInput, FormSelect, FormTextarea } from '@/components/form';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useT } from '@/i18n/client';
import { createProject, fetchProjects, fetchProjectFiles, type ProjectRecord } from '@/lib/api-client';
import {
  fetchAnalysisFindings,
  fetchEngineCatalog,
  launchAnalysis,
  orchestrationKeys,
  routeProblem,
  uploadProjectFile,
} from '@/lib/api/analysis-orchestration';
import { ErrorState, errorMessage } from '@/components/commercial/states';
import { RouterSuggestions } from '@/components/analysis/router-suggestions';
import { AnalysisProgressStepper } from '@/components/analysis/analysis-progress-stepper';
import { SeverityBadge } from '@/components/findings/severity-badge';

const PENDING_FILE_STATES = new Set(['PENDING_SCAN', 'SCANNING']);

type AnalyzeValues = {
  problem: string;
  objectIdentifier: string;
  projectId: string;
  useAi: boolean;
  engines: string[];
  fileIds: string[];
};

function contextSummary(project: ProjectRecord | undefined): string | null {
  const ctx = (project as { context?: Record<string, unknown> } | undefined)?.context;
  if (!ctx) return null;
  const parts = [
    ctx.sourceErp ? `${ctx.sourceErp}${ctx.sourceVersion ? ` ${ctx.sourceVersion}` : ''}` : null,
    ctx.targetProduct ? `→ ${ctx.targetProduct}${ctx.targetEdition ? ` ${ctx.targetEdition}` : ''}` : null,
    ctx.deploymentType ? String(ctx.deploymentType) : null,
    Array.isArray(ctx.modules) && ctx.modules.length ? (ctx.modules as string[]).join('/') : null,
    Array.isArray(ctx.countries) && ctx.countries.length ? (ctx.countries as string[]).join(', ') : null,
    project?.targetRelease ? `release ${project.targetRelease}` : null,
  ].filter(Boolean);
  return parts.length > 1 || ctx.sourceErp || ctx.targetProduct ? parts.join(' · ') : null;
}

function DirtyGuard({ isDirty, message, children }: { isDirty: boolean; message: string; children: React.ReactNode }) {
  useUnsavedChangesGuard({ isDirty, message });
  return <>{children}</>;
}

export default function AnalyzeRoute() {
  return (
    <React.Suspense fallback={<div className="mx-auto max-w-5xl h-64 rounded-xl bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />}>
      <AnalyzePage />
    </React.Suspense>
  );
}

function AnalyzePage() {
  const t = useT();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const [route, setRoute] = React.useState<ProblemRouteResponse | null>(null);
  const [launched, setLaunched] = React.useState<{ analysisId: string; projectId: string } | null>(null);
  const [finishedStatus, setFinishedStatus] = React.useState<string | null>(null);
  const [launchError, setLaunchError] = React.useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const schema = React.useMemo(
    () =>
      z.object({
        problem: z.string().trim().min(3, t('analyze.validation.problemShort')).max(4000, t('analyze.validation.problemLong')),
        objectIdentifier: z.string().trim().max(200, t('analyze.validation.objectLong')),
        projectId: z.string(),
        useAi: z.boolean(),
        engines: z.array(z.string()),
        fileIds: z.array(z.string()),
      }),
    [t]
  );

  const projects = useQuery({ queryKey: ['projects'], queryFn: fetchProjects, staleTime: 30_000 });
  const catalog = useQuery({ queryKey: orchestrationKeys.engineCatalog, queryFn: fetchEngineCatalog, staleTime: 300_000 });

  const routeMutation = useMutation({
    mutationFn: (values: AnalyzeValues) =>
      routeProblem({
        problem: values.problem.trim(),
        projectId: values.projectId || undefined,
        fileIds: values.projectId && values.fileIds.length ? values.fileIds : undefined,
        objectIdentifier: values.objectIdentifier.trim() || undefined,
        useAi: values.useAi || undefined,
      }),
    onSuccess: (res) => {
      setRoute(res);
      form.setFieldValue('engines', res.suggestions.map((s) => s.engine));
    },
  });

  const form = useForm({
    defaultValues: {
      problem: '',
      objectIdentifier: '',
      projectId: searchParams?.get('projectId') ?? '',
      useAi: false,
      engines: [],
      fileIds: [],
    } as AnalyzeValues,
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setLaunchError(null);
      await routeMutation.mutateAsync(value).catch(() => undefined);
    },
  });

  const [projectId, setProjectId] = React.useState(form.state.values.projectId);
  const files = useQuery({
    queryKey: ['projectArtifacts', projectId],
    queryFn: () => fetchProjectFiles(projectId),
    enabled: Boolean(projectId),
    refetchInterval: (q) => ((q.state.data ?? []).some((f) => PENDING_FILE_STATES.has(String(f.quarantineStatus))) ? 2000 : false),
  });
  const selectedProject = projects.data?.find((p) => p.id === projectId);

  const uploadMutation = useMutation({
    mutationFn: (file: File) => uploadProjectFile(projectId, file),
    onSuccess: (res, file) => {
      setUploadMessage({ ok: true, text: `${file.name} — ${t('analyze.fileStatus', { status: res.quarantineStatus ?? 'PENDING_SCAN' })}` });
      const current = form.getFieldValue('fileIds');
      if (!current.includes(res.fileId)) form.setFieldValue('fileIds', [...current, res.fileId]);
      void queryClient.invalidateQueries({ queryKey: ['projectArtifacts', projectId] });
    },
    onError: (err) => setUploadMessage({ ok: false, text: t('analyze.uploadFailed', { message: errorMessage(err) }) }),
  });

  const launchMutation = useMutation({
    mutationFn: (values: AnalyzeValues) =>
      launchAnalysis({
        projectId: values.projectId,
        engineTypes: values.engines,
        fileIds: values.fileIds,
        targetRelease: selectedProject?.targetRelease ?? undefined,
        assignmentMode: 'AUTO',
        problemStatement: values.problem.trim() || undefined,
        routingId: route?.routingId,
      }),
    onSuccess: (res, values) => {
      setFinishedStatus(null);
      setLaunched({ analysisId: res.analysisId, projectId: values.projectId });
    },
    onError: (err) => setLaunchError(t('analyze.launchFailed', { message: errorMessage(err) })),
  });

  const finished = useQuery({
    queryKey: ['analysis', launched?.analysisId, 'findings'],
    queryFn: () => fetchAnalysisFindings(launched!.analysisId),
    enabled: Boolean(launched && finishedStatus),
  });

  const handleLaunch = () => {
    setLaunchError(null);
    const v = form.state.values;
    if (!v.projectId) return setLaunchError(t('analyze.launchNeedsProject'));
    const cleanIds = new Set((files.data ?? []).filter((f) => f.quarantineStatus === 'CLEAN').map((f) => f.id));
    const fileIds = v.fileIds.filter((id) => cleanIds.has(id));
    if (fileIds.length === 0) return setLaunchError(t('analyze.launchNeedsFiles'));
    if (v.engines.length === 0) return setLaunchError(t('analyze.launchNeedsEngines'));
    launchMutation.mutate({ ...v, fileIds });
  };

  const engineOptions = catalog.data?.engines ?? [];
  const suggested = route?.suggestions.map((s) => s.engine) ?? [];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header className="border-b border-border pb-4">
        <h1 className="flex items-center gap-2 text-xl font-extrabold text-foreground sm:text-2xl">
          <Search className="size-6 text-primary" aria-hidden="true" />
          {t('analyze.title')}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('analyze.subtitle')}</p>
      </header>

      <form.Subscribe
        selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
        children={({ isDirty, isSubmitting, canSubmit }) => (
          <DirtyGuard isDirty={isDirty && !launched} message={t('analyze.unsavedWarning')}>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
              className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm"
              aria-label={t('analyze.title')}
            >
              <form.Field
                name="problem"
                children={(field) => (
                  <FormField id="analyze-problem" name={field.name} label={t('analyze.problemLabel')} description={t('analyze.problemHelp')} required error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}>
                    <FormTextarea
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      onBlur={field.handleBlur}
                      rows={4}
                      placeholder={t('analyze.problemPlaceholder')}
                      data-testid="analyze-problem"
                    />
                  </FormField>
                )}
              />

              <div className="grid gap-4 md:grid-cols-2">
                <form.Field
                  name="objectIdentifier"
                  children={(field) => (
                    <FormField id="analyze-object" name={field.name} label={t('analyze.objectLabel')} error={field.state.meta.errors as any}>
                      <FormInput
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                        placeholder={t('analyze.objectPlaceholder')}
                        isMono
                      />
                    </FormField>
                  )}
                />
                <form.Field
                  name="projectId"
                  children={(field) => (
                    <FormField
                      id="analyze-project"
                      name={field.name}
                      label={t('analyze.projectLabel')}
                      description={projects.isLoading ? t('analyze.projectsLoading') : undefined}
                    >
                      <FormSelect
                        value={field.state.value}
                        onChange={(e) => {
                          field.handleChange(e.target.value);
                          setProjectId(e.target.value);
                          form.setFieldValue('fileIds', []);
                        }}
                        disabled={projects.isLoading}
                        options={[
                          { value: '', label: t('analyze.projectPlaceholder') },
                          ...(projects.data ?? []).map((p) => ({ value: p.id, label: p.name })),
                        ]}
                        data-testid="analyze-project"
                      />
                    </FormField>
                  )}
                />
              </div>
              {projects.isError && <ErrorState title={t('analyze.projectsError')} error={projects.error} onRetry={() => projects.refetch()} />}

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setNewProjectOpen((v) => !v)}
                  aria-expanded={newProjectOpen}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 font-medium hover:bg-muted"
                >
                  <FolderPlus className="size-3.5" aria-hidden="true" /> {t('analyze.newProject')}
                </button>
                {selectedProject && (
                  <span className="text-muted-foreground" data-testid="analyze-project-context">
                    {contextSummary(selectedProject)
                      ? t('analyze.projectContext', { context: contextSummary(selectedProject) as string })
                      : t('analyze.projectContextNone')}
                  </span>
                )}
              </div>
              {newProjectOpen && (
                <NewProjectForm
                  onCreated={(p) => {
                    void queryClient.invalidateQueries({ queryKey: ['projects'] });
                    form.setFieldValue('projectId', p.id);
                    setProjectId(p.id);
                    setNewProjectOpen(false);
                  }}
                />
              )}

              <fieldset className="space-y-2">
                <legend className="text-xs font-bold text-foreground">{t('analyze.filesLabel')}</legend>
                <p className="text-[11px] text-muted-foreground">{t('analyze.filesHelp')}</p>
                {!projectId ? (
                  <p className="text-xs text-muted-foreground">{t('analyze.selectProjectFirst')}</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="sr-only"
                        id="analyze-upload"
                        data-testid="analyze-upload"
                        accept=".xml,.json,.csv,.zip,.abap,.xdp,.txt,.xlsx,.edmx,.wsdl"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadMutation.mutate(f);
                          e.target.value = '';
                        }}
                      />
                      <label
                        htmlFor="analyze-upload"
                        className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted focus-within:ring-2 focus-within:ring-primary/50"
                      >
                        {uploadMutation.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                        {uploadMutation.isPending ? t('analyze.uploading') : t('analyze.uploadButton')}
                      </label>
                      {uploadMessage && (
                        <span role={uploadMessage.ok ? 'status' : 'alert'} className={`text-xs ${uploadMessage.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
                          {uploadMessage.text}
                        </span>
                      )}
                    </div>
                    {files.isLoading ? (
                      <div className="h-12 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />
                    ) : files.isError ? (
                      <ErrorState title={t('analyze.filesLabel')} error={files.error} onRetry={() => files.refetch()} />
                    ) : (files.data ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t('analyze.noFiles')}</p>
                    ) : (
                      <form.Field
                        name="fileIds"
                        children={(field) => (
                          <ul className="grid gap-2 sm:grid-cols-2" data-testid="analyze-files">
                            {(files.data ?? []).map((f) => {
                              const clean = f.quarantineStatus === 'CLEAN';
                              const checked = field.state.value.includes(f.id);
                              return (
                                <li key={f.id}>
                                  <label className={`flex items-center gap-2 rounded-lg border p-2 text-xs ${checked ? 'border-primary bg-primary/5' : 'border-border'} ${clean ? 'cursor-pointer' : 'opacity-70'}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={!clean}
                                      onChange={() =>
                                        field.handleChange(checked ? field.state.value.filter((x) => x !== f.id) : [...field.state.value, f.id])
                                      }
                                    />
                                    <FileText className="size-3.5 shrink-0 text-primary" aria-hidden="true" />
                                    <span className="flex-1 truncate font-medium" title={f.name}>{f.name}</span>
                                    <span className="inline-flex items-center gap-1 font-mono text-[10px]">
                                      {clean ? <CheckCircle2 className="size-3 text-emerald-600" aria-hidden="true" /> : PENDING_FILE_STATES.has(String(f.quarantineStatus)) ? <Loader2 className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <ShieldAlert className="size-3 text-destructive" aria-hidden="true" />}
                                      {f.quarantineStatus}
                                    </span>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      />
                    )}
                  </>
                )}
              </fieldset>

              <form.Field
                name="useAi"
                children={(field) => (
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={field.state.value} onChange={(e) => field.handleChange(e.target.checked)} className="mt-0.5" />
                    {t('analyze.useAi')}
                  </label>
                )}
              />

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
                {routeMutation.isError && (
                  <p role="alert" className="mr-auto text-xs text-destructive">
                    {t('analyze.routeFailed', { message: errorMessage(routeMutation.error) })}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={!canSubmit || isSubmitting || routeMutation.isPending}
                  data-testid="analyze-suggest"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
                >
                  {routeMutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Search className="size-4" aria-hidden="true" />}
                  {routeMutation.isPending ? t('analyze.suggesting') : t('analyze.suggest')}
                </button>
              </div>
            </form>
          </DirtyGuard>
        )}
      />

      {route && (
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <RouterSuggestions result={route} />
        </div>
      )}

      <section aria-labelledby="engines-title" className="space-y-3 rounded-xl border border-border bg-card p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="engines-title" className="text-sm font-bold text-foreground">{t('analyze.manualTitle')}</h2>
          <form.Subscribe
            selector={(s) => s.values.engines}
            children={(engines) => (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground" data-testid="analyze-engine-count">{t('analyze.selectedCount', { count: engines.length })}</span>
                {suggested.length > 0 && (
                  <button type="button" className="font-semibold text-primary underline" onClick={() => form.setFieldValue('engines', suggested)}>
                    {t('analyze.selectSuggested')}
                  </button>
                )}
                <button type="button" className="text-muted-foreground underline" onClick={() => form.setFieldValue('engines', [])}>
                  {t('analyze.clearEngines')}
                </button>
              </div>
            )}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">{t('analyze.manualHelp')}</p>
        {catalog.isLoading ? (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" />
            ))}
          </div>
        ) : catalog.isError ? (
          <ErrorState title={t('analyze.catalogError')} error={catalog.error} onRetry={() => catalog.refetch()} />
        ) : (
          <form.Field
            name="engines"
            children={(field) => (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" role="group" aria-labelledby="engines-title">
                {engineOptions.map((e) => {
                  const checked = field.state.value.includes(e.engine);
                  return (
                    <label
                      key={e.engine}
                      data-engine={e.engine}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border p-2.5 text-xs ${checked ? 'border-primary bg-primary/5' : 'border-border'}`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={checked}
                        onChange={() => field.handleChange(checked ? field.state.value.filter((x) => x !== e.engine) : [...field.state.value, e.engine])}
                      />
                      <span>
                        <span className="block font-semibold text-foreground">{e.engineName}</span>
                        <span className="block text-[10px] text-muted-foreground">{e.domain}{e.acceptedFormats.length ? ` · ${e.acceptedFormats.join(', ')}` : ''}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          />
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-3">
          {launchError && (
            <p role="alert" className="mr-auto text-xs text-destructive">{launchError}</p>
          )}
          <button
            type="button"
            onClick={handleLaunch}
            disabled={launchMutation.isPending}
            data-testid="analyze-launch"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {launchMutation.isPending ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}
            {launchMutation.isPending ? t('analyze.launching') : t('analyze.launch')}
          </button>
        </div>
      </section>

      {launched && (
        <section className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm" aria-live="polite">
          <p className="text-xs text-muted-foreground" role="status">{t('analyze.launched', { id: launched.analysisId.slice(0, 8) })}</p>
          <AnalysisProgressStepper
            analysisId={launched.analysisId}
            onTerminal={(status) => {
              setFinishedStatus(status);
              void queryClient.invalidateQueries({ queryKey: ['analyses', launched.projectId] });
            }}
          />
          {finishedStatus && (
            <div className="space-y-2" data-testid="analyze-results">
              {finished.isLoading ? (
                <div className="h-10 rounded-lg bg-muted animate-pulse motion-reduce:animate-none" aria-hidden="true" />
              ) : finished.isError ? (
                <ErrorState title={t('analyze.viewFindings')} error={finished.error} onRetry={() => finished.refetch()} />
              ) : (
                <ul className="space-y-1.5">
                  {(finished.data ?? []).map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2 text-xs" data-testid="analyze-finding" data-rule={f.ruleId}>
                      <SeverityBadge severity={f.severity as Severity} size="sm" />
                      <span className="font-mono text-[11px]">{f.ruleId}</span>
                      <span className="text-foreground">{f.title}</span>
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-3 text-xs">
                <Link href={`/projects/${launched.projectId}/findings`} className="font-semibold text-primary underline">
                  {t('analyze.viewFindings')}
                </Link>
                <Link href={`/projects/${launched.projectId}`} className="text-muted-foreground underline">
                  {t('analyze.viewProject')}
                </Link>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Inline project creation (TanStack Form + Zod). */
function NewProjectForm({ onCreated }: { onCreated: (p: ProjectRecord) => void }) {
  const t = useT();
  const [serverError, setServerError] = React.useState<string | null>(null);
  const schema = React.useMemo(
    () => z.object({ name: z.string().trim().min(2, t('analyze.validation.projectName')).max(255), targetRelease: TargetReleaseEnum }),
    [t]
  );
  const mutation = useMutation({
    mutationFn: (v: z.infer<typeof schema>) => createProject({ name: v.name.trim(), targetRelease: v.targetRelease }),
    onSuccess: (p) => onCreated(p),
    onError: (err) => setServerError(errorMessage(err)),
  });
  const form = useForm({
    defaultValues: { name: '', targetRelease: 'S4H_2023' } as z.infer<typeof schema>,
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value }) => {
      setServerError(null);
      await mutation.mutateAsync(value).catch(() => undefined);
    },
  });
  return (
    <div className="rounded-lg border border-dashed border-border p-3" data-testid="analyze-new-project">
      {serverError && <p role="alert" className="mb-2 text-xs text-destructive">{serverError}</p>}
      <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <form.Field
          name="name"
          children={(field) => (
            <FormField id="new-project-name" name={field.name} label={t('analyze.newProjectName')} required error={field.state.meta.isTouched ? (field.state.meta.errors as any) : undefined}>
              <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} placeholder={t('analyze.newProjectNamePlaceholder')} />
            </FormField>
          )}
        />
        <form.Field
          name="targetRelease"
          children={(field) => (
            <FormField id="new-project-release" name={field.name} label={t('projectContext.targetRelease')}>
              <FormSelect
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value as z.infer<typeof schema>['targetRelease'])}
                options={TargetReleaseEnum.options.map((r) => ({ value: r, label: r }))}
              />
            </FormField>
          )}
        />
        <button
          type="button"
          onClick={() => void form.handleSubmit()}
          disabled={mutation.isPending}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-primary px-3 text-xs font-semibold text-primary disabled:opacity-60"
        >
          {mutation.isPending ? <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <FolderPlus className="size-3.5" aria-hidden="true" />}
          {mutation.isPending ? t('analyze.creatingProject') : t('analyze.createProject')}
        </button>
      </div>
    </div>
  );
}
