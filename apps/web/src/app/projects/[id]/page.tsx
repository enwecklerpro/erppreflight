'use client';

import React, { useState, useRef, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FolderGit2,
  UploadCloud,
  History,
  Play,
  Layers,
  CheckCircle,
  ShieldAlert,
  Boxes,
  ArrowRight,
  ExternalLink,
  Loader2,
  AlertCircle,
  FileCheck2,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  RefreshCw,
  Upload,
  ShieldCheck,
  GitCompare,
  FlaskConical,
  Download,
  BookmarkCheck,
  GitBranch,
} from 'lucide-react';
import {
  ALL_18_ENGINES,
  ACTIVE_ANALYSIS_STATUSES,
  fetchProject,
  fetchFindingsStats,
  fetchAnalyses,
  fetchAnalysis,
  fetchProjectFiles,
  triggerAnalysis,
  fetchProjectDrift,
  setProjectBaseline,
  downloadReproducibilityBundle,
  downloadOfflineHtmlReport,
  fetchDiagnosticBundle,
} from '../../../lib/api-client';
import { customInstance, saveBlobAsFile } from '../../../lib/api/custom-instance';
import { queryKeys } from '../../../lib/query/query-keys';
import { SapNativeArtifactCenter } from '@/components/sap-native-artifact-center';
import { WhatIfSimulationPanel } from '@/components/changesets/what-if-simulation-panel';
import { ReportExportPanel } from '@/components/commercial/report-export-panel';
import { AnalysisProgressStepper } from '@/components/analysis/analysis-progress-stepper';
import { FullPreflightPanel } from '@/components/analysis/full-preflight-panel';
import { ProjectTabLabel, RunFullPreflightLabel, RunProgressDisclosure } from '@/components/analysis/project-workspace-extras';
import { ProjectContextForm } from '@/components/projects/project-context-form';
import { LaunchedRunLink, RunHistoryRowExtras } from '@/components/analysis-run/run-links';
import { useEngineDomainLabel } from '@/components/engine-matrix';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';

const ANALYSIS_POLL_INTERVAL_MS = 3000;

export default function ProjectWorkspacePage() {
  const params = useParams();
  const projectId = (params?.id as string) || '';
  const queryClient = useQueryClient();
  const t = useT();
  const fmt = useFmt();
  const statusLabel = useLabel();
  const domainLabel = useEngineDomainLabel();
  const errText = useErrorText();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'findings' | 'objects' | 'sap-native' | 'simulation' | 'artifacts' | 'history' | 'launcher' | 'preflight' | 'context'
  >('overview');
  const [selectedEngines, setSelectedEngines] = useState<string[]>([
    'OPD_GUARD',
    'CLEAN_CORE_OBJECT_GUARD',
    'FORM_DOCTOR',
  ]);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);
  const [exportPanelRunId, setExportPanelRunId] = useState<string | null>(null);

  // Artifact Dropzone state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState<string | null>(null);
  const [exportingBundle, setExportingBundle] = useState(false);

  const handleExportDiagnosticBundle = async () => {
    setExportingBundle(true);
    setDownloadError(null);
    try {
      const bundle = await fetchDiagnosticBundle(projectId);
      saveBlobAsFile({
        blob: new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }),
        fileName: `erppreflight-support-bundle-${project?.slug || projectId}-${new Date().toISOString().slice(0, 10)}.json`,
      });
    } catch (err) {
      setDownloadError(t('app.workspace.errors.supportBundleFailed', { error: errText(err, t('app.workspace.errors.serverError')) }));
    } finally {
      setExportingBundle(false);
    }
  };

  const handleRunDownload = async (
    key: string,
    action: () => Promise<unknown>,
    label: string
  ) => {
    setDownloadError(null);
    setDownloadingKey(key);
    try {
      await action();
    } catch (err) {
      setDownloadError(t('app.workspace.errors.downloadFailed', { label, error: errText(err, t('app.workspace.errors.serverError')) }));
    } finally {
      setDownloadingKey(null);
    }
  };

  // Real Project Details Query
  const {
    data: project,
    isLoading: isProjectLoading,
    isError: isProjectError,
  } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId),
    staleTime: 1000 * 60,
  });

  // Real Findings Stats for this project
  const {
    data: stats,
    isLoading: isStatsLoading,
  } = useQuery({
    queryKey: ['findingsStats', projectId],
    queryFn: () => fetchFindingsStats(projectId),
    enabled: Boolean(projectId),
    staleTime: 1000 * 30,
  });

  // Real Analyses Run History for this project
  const {
    data: analyses = [],
    isLoading: isAnalysesLoading,
  } = useQuery({
    queryKey: ['analyses', projectId],
    queryFn: () => fetchAnalyses(projectId),
    enabled: Boolean(projectId),
    staleTime: 1000 * 30,
  });

  // Digital Baseline & Configuration Drift Query
  const { data: drift } = useQuery({
    queryKey: ['projectDrift', projectId],
    queryFn: () => fetchProjectDrift(projectId),
    enabled: Boolean(projectId),
    staleTime: 1000 * 30,
  });

  const baselineMutation = useMutation({
    mutationFn: (analysisId: string) => setProjectBaseline(projectId, analysisId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectDrift', projectId] });
      queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    },
  });

  // Project files (uploaded artifacts) — errors propagate for retry UI
  const {
    data: artifacts = [],
    isLoading: isArtifactsLoading,
    isError: isArtifactsError,
    error: artifactsError,
    refetch: refetchArtifacts,
  } = useQuery({
    queryKey: ['projectArtifacts', projectId],
    queryFn: () => fetchProjectFiles(projectId),
    enabled: Boolean(projectId),
    staleTime: 1000 * 15,
  });

  const cleanFiles = useMemo(
    () => artifacts.filter((f) => f.quarantineStatus === 'CLEAN'),
    [artifacts]
  );

  // Drop selections that are no longer CLEAN / no longer present.
  useEffect(() => {
    setSelectedFileIds((prev) => {
      const next = prev.filter((id) => cleanFiles.some((f) => f.id === id));
      return next.length === prev.length ? prev : next;
    });
  }, [cleanFiles]);

  const toggleFile = (id: string) => {
    setSelectedFileIds((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  };

  // Analysis launch — the API queues the run and returns immediately.
  const launchMutation = useMutation({
    mutationFn: () =>
      triggerAnalysis({
        projectId,
        engineTypes: selectedEngines,
        targetRelease: project?.targetRelease ?? undefined,
        fileIds: selectedFileIds,
      }),
    onSuccess: (data) => {
      setActiveAnalysisId(data.analysisId);
      setLaunchMessage(
        t('app.workspace.launcher.queued', {
          id: data.analysisId.slice(0, 8),
          engines: data.engineTypes?.length ?? selectedEngines.length,
          files: selectedFileIds.length,
        })
      );
      queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    },
    onError: (err: Error) => {
      setActiveAnalysisId(null);
      setLaunchMessage(t('app.workspace.launcher.launchFailed', { error: errText(err, t('app.workspace.errors.serverError')) }));
    },
  });

  // Poll the launched analysis until it reaches a terminal state.
  const { data: activeAnalysis, isError: isActiveAnalysisError } = useQuery({
    queryKey: ['analysis', activeAnalysisId],
    queryFn: () => fetchAnalysis(activeAnalysisId as string),
    enabled: Boolean(activeAnalysisId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return !status || ACTIVE_ANALYSIS_STATUSES.has(status)
        ? ANALYSIS_POLL_INTERVAL_MS
        : false;
    },
  });

  const activeStatus = activeAnalysis?.status;
  const isAnalysisRunning = Boolean(
    activeAnalysisId && (!activeStatus || ACTIVE_ANALYSIS_STATUSES.has(activeStatus))
  );

  // When the run finishes, refresh everything derived from findings.
  useEffect(() => {
    if (!activeStatus || ACTIVE_ANALYSIS_STATUSES.has(activeStatus)) return;
    queryClient.invalidateQueries({ queryKey: ['findingsStats', projectId] });
    queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    queryClient.invalidateQueries({ queryKey: queryKeys.findings.all });
    queryClient.invalidateQueries({ queryKey: ['projectDrift', projectId] });
    queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
  }, [activeStatus, projectId, queryClient]);

  // Real Artifact Upload Mutation
  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      return await customInstance<{ quarantineStatus?: string; quarantine_status?: string; status?: string }>(
        `/projects/${projectId}/files`,
        {
          method: 'POST',
          body: formData,
        }
      );
    },
    onSuccess: (data, file: File) => {
      const status = data?.quarantineStatus ?? data?.quarantine_status ?? data?.status;
      setUploadError(null);
      setUploadSuccess(
        t('app.workspace.artifacts.uploaded', { name: file.name }) +
          (status ? t('app.workspace.artifacts.quarantineStatus', { status }) : t('app.workspace.artifacts.awaitingScan'))
      );
      queryClient.invalidateQueries({ queryKey: ['projectArtifacts', projectId] });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: any) => {
      setUploadSuccess(null);
      setUploadError(errText(err, t('app.workspace.artifacts.uploadErrorFallback')));
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const handleFileSelection = (file: File) => {
    setUploadError(null);
    setUploadSuccess(null);

    const validExtensions = ['.xml', '.json', '.csv', '.zip', '.abap'];
    const hasValidExt = validExtensions.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!hasValidExt) {
      setUploadError(t('app.workspace.artifacts.invalidFormat', { name: file.name }));
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setUploadError(t('app.workspace.artifacts.tooLarge'));
      return;
    }

    uploadMutation.mutate(file);
  };

  const toggleEngine = (id: string) => {
    setSelectedEngines((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const handleLaunch = () => {
    setLaunchMessage(null);
    if (selectedFileIds.length === 0) {
      setLaunchMessage(t('app.workspace.launcher.selectFileFirst'));
      return;
    }
    launchMutation.mutate();
  };

  if (isProjectLoading) {
    return (
      <div className="p-16 text-center text-xs text-muted-foreground animate-pulse">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
        {t('app.workspace.loading')}
      </div>
    );
  }

  if (isProjectError || !project) {
    return (
      <div className="p-12 text-center bg-card border border-border rounded-xl">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <h2 className="text-base font-bold text-foreground">{t('app.workspace.notFoundTitle')}</h2>
        <p className="text-xs text-muted-foreground mt-1">{t('app.workspace.notFoundBody')}</p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors"
        >
          {t('app.workspace.backToWorkspaces')}
        </Link>
      </div>
    );
  }

  const cleanCoreScore = typeof stats?.cleanCoreIndex === 'number' ? stats.cleanCoreIndex : null;
  const blockersCount = stats?.bySeverity?.BLOCKER ?? 0;
  const criticalsCount = stats?.bySeverity?.CRITICAL ?? 0;
  const totalFindings = stats?.totalFindings ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-6 w-6 text-primary" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">
                {project.name}
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              {t('app.workspace.meta', { id: project.id, release: project.targetRelease || t('app.workspace.notSet') })}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/projects/${project.id}/simulation`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <GitCompare className="h-3.5 w-3.5 text-cyan-500" />
              {t('app.workspace.actions.simulation')}
            </Link>
            <Link
              href={`/projects/${project.id}/traceability`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <Layers className="h-3.5 w-3.5 text-emerald-500" />
              {t('app.workspace.actions.traceability')}
            </Link>
            <Link
              href={`/projects/${project.id}/lab`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
              {t('app.workspace.actions.lab')}
            </Link>
            <button
              type="button"
              onClick={handleExportDiagnosticBundle}
              disabled={exportingBundle}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              title={t('app.workspace.actions.supportBundleHint')}
            >
              {exportingBundle ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
              )}
              {t('app.workspace.actions.supportBundle')}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('preflight')}
              data-testid="open-full-preflight"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-card border border-primary text-primary text-xs font-semibold rounded-lg hover:bg-muted transition-colors"
            >
              <Layers className="h-3.5 w-3.5" aria-hidden="true" />
              <RunFullPreflightLabel />
            </button>
            <button
              onClick={() => setActiveTab('launcher')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Play className="h-3.5 w-3.5" />
              {t('app.workspace.actions.launch')}
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border mt-6 space-x-4 sm:space-x-6 text-xs font-medium overflow-x-auto">
          {[
            { id: 'overview', label: t('app.workspace.tabs.overview'), icon: Layers },
            { id: 'findings', label: t('app.workspace.tabs.findings'), icon: ShieldAlert },
            { id: 'objects', label: t('app.workspace.tabs.objects'), icon: Boxes },
            { id: 'sap-native', label: t('app.workspace.tabs.sapNative'), icon: FileCheck2 },
            { id: 'simulation', label: t('app.workspace.tabs.simulation'), icon: GitBranch },
            { id: 'artifacts', label: t('app.workspace.tabs.artifacts'), icon: UploadCloud },
            { id: 'history', label: t('app.workspace.tabs.history'), icon: History },
            { id: 'launcher', label: t('app.workspace.tabs.launcher'), icon: Play },
            { id: 'preflight', label: <ProjectTabLabel tab="preflight" />, icon: FlaskConical },
            { id: 'context', label: <ProjectTabLabel tab="context" />, icon: GitBranch },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                data-testid={`tab-${tab.id}`}
                className={`pb-3 flex items-center gap-2 font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {downloadError && (
        <div
          role="alert"
          className="p-3 rounded-lg text-xs flex items-start gap-2 bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200 dark:border-red-900"
        >
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="flex-1">{downloadError}</span>
          <button
            type="button"
            onClick={() => setDownloadError(null)}
            className="font-semibold underline"
          >
            {t('app.workspace.errors.dismiss')}
          </button>
        </div>
      )}

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Clean Core Health Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {t('app.workspace.overview.healthScore')}
              </h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {isStatsLoading ? '…' : cleanCoreScore === null ? '—' : fmt.percent(cleanCoreScore / 100, 1)}
                </span>
                {cleanCoreScore !== null && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                      cleanCoreScore >= 85
                        ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                    }`}
                  >
                    {cleanCoreScore >= 85 ? t('app.workspace.overview.targetMet') : t('app.workspace.overview.needsRemediation')}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('app.workspace.overview.healthHint')}
              </p>
            </div>

            {/* Findings Link Card */}
            <Link
              href={`/projects/${projectId}/findings`}
              className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/60 transition-all group block"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {t('app.workspace.overview.findings')}
                </h3>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {totalFindings}
                </span>
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 px-2 py-0.5 rounded flex items-center gap-1 border border-amber-200 dark:border-amber-800">
                  {t('app.workspace.overview.findingsBadge', { blockers: blockersCount, critical: criticalsCount })}
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('app.workspace.overview.findingsHint')}
              </p>
            </Link>

            {/* Objects Link Card */}
            <Link
              href={`/projects/${projectId}/objects`}
              className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/60 transition-all group block"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  {t('app.workspace.overview.objects')}
                </h3>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-base font-semibold text-foreground">{t('app.workspace.overview.openCatalog')}</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {t('app.workspace.overview.objectsHint')}
              </p>
            </Link>

            {/* Staged Artifacts Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                {t('app.workspace.overview.staged')}
              </h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {isArtifactsLoading ? '…' : isArtifactsError ? '—' : artifacts.length}
                </span>
                {!isArtifactsLoading && !isArtifactsError && (
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                    {t('app.workspace.overview.cleanCount', { count: cleanFiles.length })}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {isArtifactsError
                  ? t('app.workspace.overview.stagedUnavailable')
                  : t('app.workspace.overview.stagedHint')}
              </p>
            </div>
          </div>

          {/* Digital Project Baseline & Configuration Drift (Part 14.10 / Part 16.5) */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
              <div className="flex items-center gap-2.5">
                <BookmarkCheck className="h-5 w-5 text-primary" />
                <div>
                  <h3 className="text-sm font-bold text-foreground">
                    {t('app.workspace.baseline.title')}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('app.workspace.baseline.intro')}
                  </p>
                </div>
              </div>

              {drift?.hasBaseline ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                    <CheckCircle2 className="size-3.5" />
                    <span>{t('app.workspace.baseline.active')} <span className="font-mono">{drift.baseline?.id?.slice(0, 8)}...</span></span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-muted text-muted-foreground border border-border shrink-0">
                    <Clock className="size-3.5" />
                    <span>{t('app.workspace.baseline.date', { date: fmt.date(drift.baseline?.createdAt) })}</span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
                    <AlertCircle className="size-3.5" />
                    {t('app.workspace.baseline.none')}
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    {t('app.workspace.baseline.selectInHistory')}
                  </button>
                </div>
              )}
            </div>

            {drift?.hasBaseline && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-1 text-xs">
                <div className="p-3.5 rounded-lg border border-border bg-muted/20">
                  <span className="text-muted-foreground font-semibold block text-[11px] uppercase tracking-wider">
                    {t('app.workspace.baseline.known')}
                  </span>
                  <span className="text-xl font-bold font-mono text-foreground mt-1 block">
                    {drift.driftSummary.knownBaselineRisks}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5 block">
                    {t('app.workspace.baseline.knownHint')}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20">
                  <span className="text-rose-700 dark:text-rose-300 font-bold block text-[11px] uppercase tracking-wider">
                    {t('app.workspace.baseline.introduced')}
                  </span>
                  <span className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1 block">
                    +{drift.driftSummary.newlyIntroducedRisks}
                  </span>
                  <span className="text-[11px] text-rose-700/80 dark:text-rose-300/80 mt-0.5 block">
                    {t('app.workspace.baseline.introducedHint')}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20">
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold block text-[11px] uppercase tracking-wider">
                    {t('app.workspace.baseline.resolved')}
                  </span>
                  <span className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                    {drift.driftSummary.resolvedRisks}
                  </span>
                  <span className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5 block">
                    {t('app.workspace.baseline.resolvedHint')}
                  </span>
                </div>

                <div className="p-3.5 rounded-lg border border-border bg-muted/20">
                  <span className="text-muted-foreground font-semibold block text-[11px] uppercase tracking-wider">
                    {t('app.workspace.baseline.scoreDelta')}
                  </span>
                  <span className={`text-xl font-bold font-mono mt-1 block ${
                    drift.driftSummary.scoreDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {drift.driftSummary.scoreDelta >= 0 ? `+${drift.driftSummary.scoreDelta}%` : `${drift.driftSummary.scoreDelta}%`}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5 block">
                    {t('app.workspace.baseline.scoreDeltaHint')}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Findings */}
      {activeTab === 'findings' && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-50 dark:bg-red-950/60 text-red-600 rounded-xl border border-red-200 dark:border-red-900">
                  <ShieldAlert className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    {t('app.workspace.findingsTab.title')}
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t('app.workspace.findingsTab.intro', { project: project.name })}
                  </p>
                </div>
              </div>

              <Link
                href={`/projects/${projectId}/findings`}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-sm shrink-0"
              >
                <span>{t('app.workspace.findingsTab.open')}</span>
                <ExternalLink className="size-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">{t('app.workspace.findingsTab.blockers')}</span>
                <span className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 block">
                  {blockersCount}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  {t('app.workspace.findingsTab.blockersHint')}
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">{t('app.workspace.findingsTab.critical')}</span>
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1 block">
                  {criticalsCount}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  {t('app.workspace.findingsTab.criticalHint')}
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">{t('app.workspace.findingsTab.total')}</span>
                <span className="text-2xl font-bold text-foreground mt-1 block">
                  {totalFindings}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  {t('app.workspace.findingsTab.totalHint')}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Objects */}
      {activeTab === 'objects' && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">{t('app.workspace.objectsTab.title')}</h2>
              <p className="text-xs text-muted-foreground mt-1">{t('app.workspace.objectsTab.intro')}</p>
            </div>
            <Link
              href={`/projects/${projectId}/objects`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors"
            >
              {t('app.workspace.objectsTab.open')}
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Tab: SAP-Native Artifact Center (Part 15.20) */}
      {activeTab === 'sap-native' && (
        <SapNativeArtifactCenter projectId={projectId} />
      )}

      {/* Tab: What-If Simulation Workspace (Part 16.2) */}
      {activeTab === 'simulation' && (
        <WhatIfSimulationPanel projectId={projectId} />
      )}

      {/* Tab: Artifact Dropzone */}
      {activeTab === 'artifacts' && (
        <div className="space-y-6">
          {/* Antivirus & Pipeline Banner */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <UploadCloud className="h-5 w-5 text-primary" />
                  {t('app.workspace.artifacts.title')}
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('app.workspace.artifacts.intro')}
                </p>
              </div>
            </div>
          </div>

          {/* Interactive Drop Area */}
          <div
            role="region"
            aria-label={t('app.workspace.artifacts.dropzone')}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setIsDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const files = e.dataTransfer.files;
              if (files && files.length > 0) {
                handleFileSelection(files[0]);
              }
            }}
            className={`border-2 border-dashed rounded-xl p-8 text-center transition-all ${
              isDragging
                ? 'border-primary bg-primary/5 scale-[1.005]'
                : 'border-border hover:border-primary/50 bg-card'
            }`}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept=".xml,.json,.csv,.zip,.abap"
              className="hidden"
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  handleFileSelection(files[0]);
                }
              }}
              aria-label={t('app.workspace.artifacts.fileInput')}
            />

            <div className="max-w-md mx-auto space-y-3">
              <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                {uploadMutation.isPending ? (
                  <Loader2 className="h-6 w-6 text-primary animate-spin" />
                ) : (
                  <UploadCloud className="h-6 w-6 text-primary" />
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-foreground">
                  {uploadMutation.isPending
                    ? t('app.workspace.artifacts.uploading')
                    : t('app.workspace.artifacts.dropHere')}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('app.workspace.artifacts.formats')} <span className="font-mono font-medium">.xml, .json, .csv, .zip, .abap</span>{' '}
                  {t('app.workspace.artifacts.maxSize')}
                </p>
              </div>

              <div className="pt-2">
                <button
                  type="button"
                  disabled={uploadMutation.isPending}
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-xs font-semibold rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-colors disabled:opacity-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  {uploadMutation.isPending ? t('app.workspace.artifacts.processing') : t('app.workspace.artifacts.browse')}
                </button>
              </div>

              {uploadError && (
                <div
                  role="alert"
                  className="mt-3 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-800 dark:text-red-200 flex items-start gap-2 text-left"
                >
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{t('app.workspace.artifacts.uploadFailed')}</p>
                    <p className="mt-0.5">{uploadError}</p>
                  </div>
                </div>
              )}

              {uploadSuccess && (
                <div
                  role="status"
                  className="mt-3 p-3 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 rounded-lg text-xs text-emerald-800 dark:text-emerald-200 flex items-start gap-2 text-left"
                >
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">{t('app.workspace.artifacts.uploadVerified')}</p>
                    <p className="mt-0.5">{uploadSuccess}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Uploaded Artifacts Ledger */}
          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-foreground">
                  {t('app.workspace.artifacts.ledger', { count: artifacts.length })}
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {t('app.workspace.artifacts.ledgerHint')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => refetchArtifacts()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted/50 transition-colors"
                title={t('app.workspace.artifacts.refreshHint')}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('app.workspace.artifacts.refresh')}
              </button>
            </div>

            {isArtifactsLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {t('app.workspace.artifacts.loading')}
              </div>
            ) : isArtifactsError ? (
              <div role="alert" className="p-8 text-center text-xs border border-destructive/30 rounded-lg">
                <AlertCircle className="h-5 w-5 text-destructive mx-auto mb-2" aria-hidden="true" />
                <p className="font-semibold text-foreground">{t('app.workspace.artifacts.loadFailed')}</p>
                <p className="text-muted-foreground mt-1">
                  {errText(artifactsError, t('app.workspace.errors.networkError'))}
                </p>
                <button
                  type="button"
                  onClick={() => refetchArtifacts()}
                  className="mt-3 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg"
                >
                  {t('app.workspace.artifacts.retry')}
                </button>
              </div>
            ) : artifacts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs border border-dashed border-border rounded-lg">
                {t('app.workspace.artifacts.empty')}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground font-medium">
                      <th className="py-2.5 px-3">{t('app.workspace.artifacts.colName')}</th>
                      <th className="py-2.5 px-3">{t('app.workspace.artifacts.colSize')}</th>
                      <th className="py-2.5 px-3">{t('app.workspace.artifacts.colFormat')}</th>
                      <th className="py-2.5 px-3">{t('app.workspace.artifacts.colChecksum')}</th>
                      <th className="py-2.5 px-3">{t('app.workspace.artifacts.colUploaded')}</th>
                      <th className="py-2.5 px-3">{t('app.workspace.artifacts.colStatus')}</th>
                      <th className="py-2.5 px-3 text-right">{t('app.workspace.artifacts.colActions')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {artifacts.map((artifact) => {
                      const status = artifact.quarantineStatus;
                      const isClean = status === 'CLEAN';
                      return (
                        <tr key={artifact.id} className="hover:bg-muted/30 transition-colors">
                          <td className="py-3 px-3 font-medium text-foreground flex items-center gap-2">
                            <FileText className="h-4 w-4 text-primary shrink-0" />
                            <span className="truncate max-w-[200px]" title={artifact.name}>
                              {artifact.name}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-muted-foreground font-mono">
                            {artifact.sizeBytes !== null ? t('app.workspace.artifacts.sizeKb', { size: fmt.number(artifact.sizeBytes / 1024, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }) : '—'}
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded text-foreground font-semibold">
                              {artifact.detectedFormat || t('app.workspace.artifacts.unknownFormat')}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-muted-foreground text-[11px]">
                            {artifact.checksumSha256 ? (
                              <span title={artifact.checksumSha256}>
                                {artifact.checksumSha256.slice(0, 10)}...{artifact.checksumSha256.slice(-6)}
                              </span>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td className="py-3 px-3 text-muted-foreground whitespace-nowrap">
                            {fmt.dateTime(artifact.createdAt)}
                          </td>
                          <td className="py-3 px-3">
                            {status === 'CLEAN' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                aria-label={t('app.workspace.artifacts.statusAria', { status: t('app.workspace.artifacts.status.CLEAN') })}
                              >
                                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                                {t('app.workspace.artifacts.status.CLEAN')}
                              </span>
                            ) : status === 'QUARANTINED' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                aria-label={t('app.workspace.artifacts.statusAria', { status: t('app.workspace.artifacts.status.QUARANTINED') })}
                              >
                                <ShieldAlert className="h-3 w-3" aria-hidden="true" />
                                {t('app.workspace.artifacts.status.QUARANTINED')}
                              </span>
                            ) : status === 'REJECTED' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800"
                                aria-label={t('app.workspace.artifacts.statusAria', { status: t('app.workspace.artifacts.status.REJECTED') })}
                              >
                                <XCircle className="h-3 w-3" aria-hidden="true" />
                                {t('app.workspace.artifacts.status.REJECTED')}
                              </span>
                            ) : status === 'SCANNING' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                aria-label={t('app.workspace.artifacts.statusAria', { status: t('app.workspace.artifacts.status.SCANNING') })}
                              >
                                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                                {t('app.workspace.artifacts.status.SCANNING')}
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                                aria-label={t('app.workspace.artifacts.statusAria', { status: t('app.workspace.artifacts.status.PENDING') })}
                              >
                                <Clock className="h-3 w-3" aria-hidden="true" />
                                {t('app.workspace.artifacts.status.PENDING')}
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-3 text-right">
                            {isClean ? (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedFileIds((prev) =>
                                    prev.includes(artifact.id) ? prev : [...prev, artifact.id]
                                  );
                                  setActiveTab('launcher');
                                }}
                                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
                              >
                                <Play className="h-3 w-3" />
                                {t('app.workspace.artifacts.runPreflight')}
                              </button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">
                                {t('app.workspace.artifacts.unavailable')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab: Run History */}
      {activeTab === 'history' && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-4">
            {t('app.workspace.history.title')}
          </h3>
          {isAnalysesLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
              {t('app.workspace.history.loading')}
            </div>
          ) : analyses.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              {t('app.workspace.history.empty')}
            </div>
          ) : (
            <div className="divide-y divide-border text-xs">
              {analyses.map((run) => (
                <div key={run.id} className="py-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-foreground">{run.id.slice(0, 8)}...</span>
                      <span className="text-muted-foreground">
                        • {fmt.dateTime(run.createdAt)}
                      </span>
                      <RunHistoryRowExtras projectId={projectId} run={run} />
                      {(drift?.baseline?.id === run.id || (run as any).isBaseline) && (
                        <span
                          className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 inline-flex items-center gap-1"
                          aria-label={t('app.workspace.history.activeBaseline')}
                        >
                          <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                          {t('app.workspace.history.activeBaselineBadge')}
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5">
                      {t('app.workspace.history.summary', {
                        engines: run.engineTypes?.length || 0,
                        findings: run.findingsCount ?? 0,
                        release: run.targetRelease ?? '—',
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-0.5 text-xs font-semibold rounded ${
                        run.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                          : run.status === 'FAILED'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                          : run.status === 'PARTIAL'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : run.status === 'CANCELLED'
                          ? 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {statusLabel('app.workspace.history.status', run.status)}
                    </span>
                    {(run.status === 'COMPLETED' || run.status === 'PARTIAL') && !String(run.kind ?? '').startsWith('LAB_') && (
                      <>
                        <button
                          type="button"
                          onClick={() => setExportPanelRunId(exportPanelRunId === run.id ? null : run.id)}
                          aria-expanded={exportPanelRunId === run.id}
                          aria-controls={`export-panel-${run.id}`}
                          data-testid={`open-exports-${run.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-primary/40 bg-card hover:bg-muted text-foreground transition-colors"
                          title={t('app.workspace.history.reportsHint')}
                        >
                          <Download className="size-3 text-primary" aria-hidden="true" />
                          <span>{t('app.workspace.history.reports')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRunDownload(
                              `bundle-${run.id}`,
                              () => downloadReproducibilityBundle(run.id),
                              t('app.workspace.history.bundleLabel')
                            )
                          }
                          disabled={downloadingKey !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title={t('app.workspace.history.bundleHint')}
                        >
                          {downloadingKey === `bundle-${run.id}` ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : (
                            <Download className="size-3 text-primary" aria-hidden="true" />
                          )}
                          <span>{t('app.workspace.history.bundle')}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRunDownload(
                              `html-${run.id}`,
                              () => downloadOfflineHtmlReport(projectId, run.id),
                              t('app.workspace.history.htmlLabel')
                            )
                          }
                          disabled={downloadingKey !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title={t('app.workspace.history.htmlHint')}
                        >
                          {downloadingKey === `html-${run.id}` ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : (
                            <FileText className="size-3 text-primary" aria-hidden="true" />
                          )}
                          <span>{t('app.workspace.history.html')}</span>
                        </button>
                        {drift?.baseline?.id !== run.id && !(run as any).isBaseline && (
                          <button
                            type="button"
                            onClick={() => baselineMutation.mutate(run.id)}
                            disabled={baselineMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-border bg-card hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                            title={t('app.workspace.history.setBaselineHint')}
                          >
                            <BookmarkCheck className="size-3 text-primary" />
                            <span>{t('app.workspace.history.setBaseline')}</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                {exportPanelRunId === run.id && (
                  <div id={`export-panel-${run.id}`}>
                    <ReportExportPanel projectId={projectId} analysisId={run.id} />
                  </div>
                )}
                <RunProgressDisclosure analysisId={run.id} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Analysis Launcher */}
      {activeTab === 'launcher' && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-base font-bold text-foreground">
              {t('app.workspace.launcher.title')}
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              {project.targetRelease
                ? t('app.workspace.launcher.introWithRelease', { project: project.name, release: project.targetRelease })
                : t('app.workspace.launcher.intro', { project: project.name })}
            </p>
          </div>

          {launchMessage && (
            <div
              role={launchMutation.isError ? 'alert' : 'status'}
              className={`p-4 rounded-lg text-xs flex items-center gap-2 ${
                launchMutation.isError
                  ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200'
                  : 'bg-blue-50 border border-blue-200 text-blue-800 dark:bg-blue-950/60 dark:text-blue-200'
              }`}
            >
              {launchMutation.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Clock className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span>{launchMessage}</span>
            </div>
          )}

          {activeAnalysisId && (
            <div
              role="status"
              aria-live="polite"
              className={`p-4 rounded-lg text-xs flex items-center gap-2 border ${
                activeStatus === 'COMPLETED'
                  ? 'bg-green-50 border-green-200 text-green-800 dark:bg-green-950/60 dark:text-green-200'
                  : activeStatus === 'FAILED'
                  ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200'
                  : activeStatus === 'PARTIAL'
                  ? 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/60 dark:text-amber-200'
                  : 'bg-muted/40 border-border text-foreground'
              }`}
            >
              {isAnalysisRunning ? (
                <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
              ) : activeStatus === 'COMPLETED' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="flex-1">
                {t('app.workspace.launcher.analysis')} <span className="font-mono">{activeAnalysisId.slice(0, 8)}</span>:{' '}
                <strong>{statusLabel('app.workspace.history.status', activeStatus ?? 'QUEUED')}</strong>
                {activeStatus === 'COMPLETED' || activeStatus === 'PARTIAL'
                  ? t('app.workspace.launcher.doneSuffix', { count: activeAnalysis?.findingsCount ?? 0 })
                  : activeStatus === 'FAILED'
                  ? t('app.workspace.launcher.failedSuffix')
                  : isActiveAnalysisError
                  ? t('app.workspace.launcher.refreshErrorSuffix')
                  : t('app.workspace.launcher.waitingSuffix')}
              </span>
              <LaunchedRunLink projectId={projectId} analysisId={activeAnalysisId} />
              {!isAnalysisRunning && (
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="font-semibold underline shrink-0"
                >
                  {t('app.workspace.launcher.runHistory')}
                </button>
              )}
            </div>
          )}

          {activeAnalysisId && <AnalysisProgressStepper analysisId={activeAnalysisId} />}

          <fieldset>
            <legend className="text-xs font-bold text-foreground">
              {t('app.workspace.launcher.files', { selected: selectedFileIds.length, total: cleanFiles.length })}
            </legend>
            {isArtifactsLoading ? (
              <div className="mt-3 h-16 rounded-lg bg-muted animate-pulse" aria-hidden="true" />
            ) : isArtifactsError ? (
              <div role="alert" className="mt-3 p-3 rounded-lg border border-destructive/30 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                <span className="flex-1">{t('app.workspace.launcher.filesLoadFailed')}</span>
                <button type="button" onClick={() => refetchArtifacts()} className="font-semibold underline">
                  {t('app.workspace.launcher.retry')}
                </button>
              </div>
            ) : cleanFiles.length === 0 ? (
              <div className="mt-3 p-4 rounded-lg border border-dashed border-border text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center gap-3">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  {t('app.workspace.launcher.noCleanFile')}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('artifacts')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md font-semibold shrink-0"
                >
                  <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                  {t('app.workspace.launcher.uploadFiles')}
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
                {cleanFiles.map((file) => {
                  const checked = selectedFileIds.includes(file.id);
                  return (
                    <label
                      key={file.id}
                      className={`p-3 rounded-lg border text-xs flex items-center gap-2 cursor-pointer ${
                        checked ? 'border-primary bg-blue-50/60 dark:bg-blue-950/40' : 'border-border bg-background'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleFile(file.id)}
                        className="h-3.5 w-3.5"
                      />
                      <FileText className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden="true" />
                      <span className="truncate flex-1 text-foreground font-medium" title={file.name}>
                        {file.name}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {file.detectedFormat || t('app.workspace.artifacts.unknownFormat')}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </fieldset>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-foreground">
                {t('app.workspace.launcher.engines', { selected: selectedEngines.length, total: ALL_18_ENGINES.length })}
              </label>
              <div className="space-x-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedEngines(ALL_18_ENGINES.map((e) => e.id))}
                  className="text-primary hover:underline font-semibold"
                >
                  {t('app.workspace.launcher.selectAll')}
                </button>
                <span className="text-muted-foreground">•</span>
                <button
                  type="button"
                  onClick={() => setSelectedEngines([])}
                  className="text-muted-foreground hover:underline"
                >
                  {t('app.workspace.launcher.deselectAll')}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 mt-3">
              {ALL_18_ENGINES.map((eng) => {
                const selected = selectedEngines.includes(eng.id);
                return (
                  <button
                    type="button"
                    key={eng.id}
                    onClick={() => toggleEngine(eng.id)}
                    className={`p-3 rounded-lg border text-left transition-all text-xs flex items-start justify-between ${
                      selected
                        ? 'border-primary bg-blue-50/60 dark:bg-blue-950/40 text-foreground font-semibold'
                        : 'border-border bg-background text-muted-foreground hover:border-border/80'
                    }`}
                  >
                    <div>
                      <div className="text-foreground" translate="no">{eng.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{domainLabel(eng.domain)}</div>
                    </div>
                    {selected && <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-border flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
            {(cleanFiles.length === 0 || selectedFileIds.length === 0 || selectedEngines.length === 0) && (
              <p className="text-[11px] text-muted-foreground" id="launch-requirements">
                {cleanFiles.length === 0
                  ? t('app.workspace.launcher.disabledNoClean')
                  : selectedFileIds.length === 0
                  ? t('app.workspace.launcher.disabledNoFile')
                  : t('app.workspace.launcher.disabledNoEngine')}
              </p>
            )}
            <button
              type="button"
              onClick={handleLaunch}
              aria-describedby="launch-requirements"
              disabled={
                launchMutation.isPending ||
                isAnalysisRunning ||
                selectedEngines.length === 0 ||
                selectedFileIds.length === 0
              }
              className="px-5 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {launchMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('app.workspace.launcher.queuing')}
                </>
              ) : isAnalysisRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('app.workspace.launcher.inProgress')}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  {t('app.workspace.launcher.execute')}
                </>
              )}
            </button>
          </div>
        </div>
      )}
      {/* Tab: Full Project Preflight (Part 01 §1.6) */}
      {activeTab === 'preflight' && <FullPreflightPanel projectId={projectId} />}

      {/* Tab: Project mode context (Part 01 §1.5) */}
      {activeTab === 'context' && <ProjectContextForm key={project.id} project={project} />}
    </div>
  );
}
