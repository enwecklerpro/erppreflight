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

const ANALYSIS_POLL_INTERVAL_MS = 3000;

export default function ProjectWorkspacePage() {
  const params = useParams();
  const projectId = (params?.id as string) || '';
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'findings' | 'objects' | 'sap-native' | 'simulation' | 'artifacts' | 'history' | 'launcher'
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
      setDownloadError(
        `Support bundle export failed: ${(err as Error)?.message || 'Server error'}`
      );
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
      setDownloadError(`${label} download failed: ${(err as Error)?.message || 'Server error'}`);
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
        `Analysis ${data.analysisId.slice(0, 8)} queued (${data.engineTypes?.length ?? selectedEngines.length} engine(s), ${selectedFileIds.length} file(s)). Status updates automatically.`
      );
      queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    },
    onError: (err: Error) => {
      setActiveAnalysisId(null);
      setLaunchMessage(`Launch failed: ${err?.message || 'Server error'}`);
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
        `Artifact "${file.name}" uploaded.${status ? ` Quarantine status: ${status}.` : ' Awaiting scan result.'}`
      );
      queryClient.invalidateQueries({ queryKey: ['projectArtifacts', projectId] });
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    onError: (err: any) => {
      setUploadSuccess(null);
      setUploadError(err?.message || 'Failed to upload artifact. Ensure file format is valid.');
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
      setUploadError(
        `Invalid file format: "${file.name}". Only .xml, .json, .csv, .zip, and .abap files are supported.`
      );
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setUploadError('File size exceeds the 100 MB limit.');
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
      setLaunchMessage('Select at least one CLEAN uploaded file to analyse.');
      return;
    }
    launchMutation.mutate();
  };

  if (isProjectLoading) {
    return (
      <div className="p-16 text-center text-xs text-muted-foreground animate-pulse">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
        Loading workspace metadata...
      </div>
    );
  }

  if (isProjectError || !project) {
    return (
      <div className="p-12 text-center bg-card border border-border rounded-xl">
        <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <h2 className="text-base font-bold text-foreground">Project Workspace Not Found</h2>
        <p className="text-xs text-muted-foreground mt-1">
          The requested workspace does not exist or you lack permission to view it.
        </p>
        <Link
          href="/projects"
          className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors"
        >
          Return to Workspaces
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
              Workspace ID: {project.id} • Target Release: {project.targetRelease || 'Not set'}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href={`/projects/${project.id}/simulation`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <GitCompare className="h-3.5 w-3.5 text-cyan-500" />
              What-If Simulation
            </Link>
            <Link
              href={`/projects/${project.id}/traceability`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <Layers className="h-3.5 w-3.5 text-emerald-500" />
              Traceability Matrix
            </Link>
            <Link
              href={`/projects/${project.id}/lab`}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <FlaskConical className="h-3.5 w-3.5 text-purple-500" />
              Scenario Test Lab
            </Link>
            <button
              type="button"
              onClick={handleExportDiagnosticBundle}
              disabled={exportingBundle}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-card border border-border hover:bg-muted text-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
              title="Generate sanitized enterprise support bundle (Part 18.18)"
            >
              {exportingBundle ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 text-amber-500" />
              )}
              Support Bundle
            </button>
            <button
              onClick={() => setActiveTab('launcher')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
            >
              <Play className="h-3.5 w-3.5" />
              Launch Analysis
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border mt-6 space-x-4 sm:space-x-6 text-xs font-medium overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: Layers },
            { id: 'findings', label: 'Findings', icon: ShieldAlert },
            { id: 'objects', label: 'Objects', icon: Boxes },
            { id: 'sap-native', label: 'SAP Artifact Center', icon: FileCheck2 },
            { id: 'simulation', label: 'What-If Simulation', icon: GitBranch },
            { id: 'artifacts', label: 'Artifact Dropzone', icon: UploadCloud },
            { id: 'history', label: 'Run History', icon: History },
            { id: 'launcher', label: 'Analysis Launcher', icon: Play },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
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
            Dismiss
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
                Clean Core Health Score
              </h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {isStatsLoading ? '…' : cleanCoreScore === null ? '—' : `${cleanCoreScore.toFixed(1)}%`}
                </span>
                {cleanCoreScore !== null && (
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                      cleanCoreScore >= 85
                        ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                        : 'text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                    }`}
                  >
                    {cleanCoreScore >= 85 ? 'Target Met (>85%)' : 'Needs Remediation'}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tier 1 / Tier 2 cloud extensibility compliance across workspace repository.
              </p>
            </div>

            {/* Findings Link Card */}
            <Link
              href={`/projects/${projectId}/findings`}
              className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/60 transition-all group block"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Preflight Findings
                </h3>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {totalFindings}
                </span>
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 px-2 py-0.5 rounded flex items-center gap-1 border border-amber-200 dark:border-amber-800">
                  {blockersCount} Blocker{blockersCount !== 1 ? 's' : ''} • {criticalsCount} Critical
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                View cryptographic SHA-256 evidence ledger & Clean Core remediation &rarr;
              </p>
            </Link>

            {/* Objects Link Card */}
            <Link
              href={`/projects/${projectId}/objects`}
              className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/60 transition-all group block"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Object Inventory
                </h3>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-base font-semibold text-foreground">Open catalog</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Browse virtualized catalog & Clean Core tier classifications &rarr;
              </p>
            </Link>

            {/* Staged Artifacts Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Staged Artifacts
              </h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">
                  {isArtifactsLoading ? '…' : isArtifactsError ? '—' : artifacts.length}
                </span>
                {!isArtifactsLoading && !isArtifactsError && (
                  <span className="text-xs font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded border border-border">
                    {cleanFiles.length} CLEAN
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {isArtifactsError
                  ? 'File list unavailable — open the Artifact Dropzone to retry.'
                  : 'Uploaded files; only CLEAN files can be analysed.'}
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
                    Digital Project Baseline & Configuration Drift
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Categorizes findings against the official signed baseline into accepted risks, new regressions, and resolved findings.
                  </p>
                </div>
              </div>

              {drift?.hasBaseline ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 shrink-0">
                    <CheckCircle2 className="size-3.5" />
                    <span>Active Baseline: <span className="font-mono">{drift.baseline?.id?.slice(0, 8)}...</span></span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md bg-muted text-muted-foreground border border-border shrink-0">
                    <Clock className="size-3.5" />
                    <span>Baseline Date: {drift.baseline?.createdAt ? new Date(drift.baseline.createdAt).toLocaleDateString() : 'N/A'}</span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-md bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0">
                    <AlertCircle className="size-3.5" />
                    No Baseline Set
                  </span>
                  <button
                    type="button"
                    onClick={() => setActiveTab('history')}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                  >
                    Select in Run History &rarr;
                  </button>
                </div>
              )}
            </div>

            {drift?.hasBaseline && (
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 pt-1 text-xs">
                <div className="p-3.5 rounded-lg border border-border bg-muted/20">
                  <span className="text-muted-foreground font-semibold block text-[11px] uppercase tracking-wider">
                    Known Baseline Risks
                  </span>
                  <span className="text-xl font-bold font-mono text-foreground mt-1 block">
                    {drift.driftSummary.knownBaselineRisks}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5 block">
                    Pre-existing accepted issues
                  </span>
                </div>

                <div className="p-3.5 rounded-lg border border-rose-200 dark:border-rose-900 bg-rose-50/40 dark:bg-rose-950/20">
                  <span className="text-rose-700 dark:text-rose-300 font-bold block text-[11px] uppercase tracking-wider">
                    Newly Introduced Risks
                  </span>
                  <span className="text-xl font-bold font-mono text-rose-600 dark:text-rose-400 mt-1 block">
                    +{drift.driftSummary.newlyIntroducedRisks}
                  </span>
                  <span className="text-[11px] text-rose-700/80 dark:text-rose-300/80 mt-0.5 block">
                    Regression drift since baseline
                  </span>
                </div>

                <div className="p-3.5 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/40 dark:bg-emerald-950/20">
                  <span className="text-emerald-700 dark:text-emerald-300 font-bold block text-[11px] uppercase tracking-wider">
                    Resolved Findings
                  </span>
                  <span className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1 block">
                    {drift.driftSummary.resolvedRisks}
                  </span>
                  <span className="text-[11px] text-emerald-700/80 dark:text-emerald-300/80 mt-0.5 block">
                    Successfully mitigated issues
                  </span>
                </div>

                <div className="p-3.5 rounded-lg border border-border bg-muted/20">
                  <span className="text-muted-foreground font-semibold block text-[11px] uppercase tracking-wider">
                    Score Delta
                  </span>
                  <span className={`text-xl font-bold font-mono mt-1 block ${
                    drift.driftSummary.scoreDelta >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                  }`}>
                    {drift.driftSummary.scoreDelta >= 0 ? `+${drift.driftSummary.scoreDelta}%` : `${drift.driftSummary.scoreDelta}%`}
                  </span>
                  <span className="text-[11px] text-muted-foreground mt-0.5 block">
                    Clean Core index progression
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
                    Preflight Findings Ledger & Cryptographic Evidence
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Explore all detected violations, Clean Core deviations, and cryptographic proofs for {project.name}.
                  </p>
                </div>
              </div>

              <Link
                href={`/projects/${projectId}/findings`}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-sm shrink-0"
              >
                <span>Open Full Findings Ledger</span>
                <ExternalLink className="size-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Blockers Detected</span>
                <span className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 block">
                  {blockersCount}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Must be resolved before target release deployment
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Critical Defects</span>
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1 block">
                  {criticalsCount}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  High-risk Clean Core and architectural deviations
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Total Findings</span>
                <span className="text-2xl font-bold text-foreground mt-1 block">
                  {totalFindings}
                </span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Cryptographically hashed and evidence-linked findings
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
              <h2 className="text-lg font-bold text-foreground">Object Inventory Explorer</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Deep-dive into custom Z/Y-programs, decision tables, CDS views, and forms.
              </p>
            </div>
            <Link
              href={`/projects/${projectId}/objects`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors"
            >
              Open Object Catalog
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
                  Staged SAP Artifacts & Verification Pipeline
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Uploaded files are scanned and quarantined server-side; only files with status CLEAN can be analysed.
                </p>
              </div>
            </div>
          </div>

          {/* Interactive Drop Area */}
          <div
            role="region"
            aria-label="Artifact upload dropzone"
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
              aria-label="Upload SAP artifact file"
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
                    ? 'Uploading and scanning artifact...'
                    : 'Drag & drop SAP artifacts here'}
                </h4>
                <p className="text-xs text-muted-foreground mt-1">
                  Supported formats: <span className="font-mono font-medium">.xml, .json, .csv, .zip, .abap</span> (up to 100 MB)
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
                  {uploadMutation.isPending ? 'Processing...' : 'Browse files'}
                </button>
              </div>

              {uploadError && (
                <div
                  role="alert"
                  className="mt-3 p-3 bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-900 rounded-lg text-xs text-red-800 dark:text-red-200 flex items-start gap-2 text-left"
                >
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Upload failed</p>
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
                    <p className="font-semibold">Upload verified</p>
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
                  Workspace Artifacts Ledger ({artifacts.length})
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verified customer files available for preflight analysis runs
                </p>
              </div>
              <button
                type="button"
                onClick={() => refetchArtifacts()}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground border border-border rounded-md hover:bg-muted/50 transition-colors"
                title="Refresh artifacts list"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>

            {isArtifactsLoading ? (
              <div className="p-8 text-center text-xs text-muted-foreground animate-pulse flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Loading staged artifacts...
              </div>
            ) : isArtifactsError ? (
              <div role="alert" className="p-8 text-center text-xs border border-destructive/30 rounded-lg">
                <AlertCircle className="h-5 w-5 text-destructive mx-auto mb-2" aria-hidden="true" />
                <p className="font-semibold text-foreground">Could not load project files</p>
                <p className="text-muted-foreground mt-1">
                  {(artifactsError as Error)?.message || 'Network error'}
                </p>
                <button
                  type="button"
                  onClick={() => refetchArtifacts()}
                  className="mt-3 px-3 py-1.5 bg-primary text-primary-foreground text-xs font-medium rounded-lg"
                >
                  Retry
                </button>
              </div>
            ) : artifacts.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-xs border border-dashed border-border rounded-lg">
                No artifacts staged yet. Use the dropzone above to upload SAP XML configurations, transports, or ABAP extracts.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground font-medium">
                      <th className="py-2.5 px-3">File Name</th>
                      <th className="py-2.5 px-3">Size</th>
                      <th className="py-2.5 px-3">Format</th>
                      <th className="py-2.5 px-3">SHA-256 Checksum</th>
                      <th className="py-2.5 px-3">Uploaded At</th>
                      <th className="py-2.5 px-3">Quarantine Status</th>
                      <th className="py-2.5 px-3 text-right">Actions</th>
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
                            {artifact.sizeBytes !== null ? `${(artifact.sizeBytes / 1024).toFixed(1)} KB` : '—'}
                          </td>
                          <td className="py-3 px-3">
                            <span className="font-mono text-[11px] bg-muted px-1.5 py-0.5 rounded text-foreground font-semibold">
                              {artifact.detectedFormat || 'UNKNOWN'}
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
                            {artifact.createdAt ? new Date(artifact.createdAt).toLocaleString() : '—'}
                          </td>
                          <td className="py-3 px-3">
                            {status === 'CLEAN' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                                aria-label="Status: CLEAN"
                              >
                                <CheckCircle2 className="h-3 w-3" />
                                CLEAN
                              </span>
                            ) : status === 'QUARANTINED' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                                aria-label="Status: QUARANTINED"
                              >
                                <ShieldAlert className="h-3 w-3" />
                                QUARANTINED
                              </span>
                            ) : status === 'REJECTED' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-300 border border-red-200 dark:border-red-800"
                                aria-label="Status: REJECTED"
                              >
                                <XCircle className="h-3 w-3" />
                                REJECTED
                              </span>
                            ) : status === 'SCANNING' ? (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                                aria-label="Status: SCANNING"
                              >
                                <Loader2 className="h-3 w-3 animate-spin" />
                                SCANNING
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700"
                                aria-label="Status: PENDING SCAN"
                              >
                                <Clock className="h-3 w-3" />
                                PENDING SCAN
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
                                Run Preflight
                              </button>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">
                                Unavailable
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
            Analysis Execution Ledger
          </h3>
          {isAnalysesLoading ? (
            <div className="p-8 text-center text-xs text-muted-foreground animate-pulse">
              Loading run history...
            </div>
          ) : analyses.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-xs">
              No analysis runs recorded yet for this workspace. Use the Analysis Launcher to trigger a run.
            </div>
          ) : (
            <div className="divide-y divide-border text-xs">
              {analyses.map((run) => (
                <div key={run.id} className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-foreground">{run.id.slice(0, 8)}...</span>
                      <span className="text-muted-foreground">
                        • {new Date(run.createdAt).toLocaleString()}
                      </span>
                      {(drift?.baseline?.id === run.id || (run as any).isBaseline) && (
                        <span
                          className="px-2.5 py-0.5 text-[10px] font-bold rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800 inline-flex items-center gap-1"
                          aria-label="Active Project Baseline"
                        >
                          <ShieldCheck className="size-3 text-emerald-600 dark:text-emerald-400" />
                          ACTIVE BASELINE
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5">
                      Evaluated {run.engineTypes?.length || 0} engine(s) • {run.findingsCount} finding(s) detected • Release: {run.targetRelease}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2.5 py-0.5 text-xs font-semibold rounded ${
                        run.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                          : run.status === 'FAILED'
                          ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                          : run.status === 'PARTIAL'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                          : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {run.status}
                    </span>
                    {(run.status === 'COMPLETED' || run.status === 'PARTIAL') && (
                      <>
                        <button
                          type="button"
                          onClick={() =>
                            handleRunDownload(
                              `bundle-${run.id}`,
                              () => downloadReproducibilityBundle(run.id),
                              'Reproducibility bundle'
                            )
                          }
                          disabled={downloadingKey !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title="Download reproducibility bundle (.zip)"
                        >
                          {downloadingKey === `bundle-${run.id}` ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : (
                            <Download className="size-3 text-primary" aria-hidden="true" />
                          )}
                          <span>Bundle (.zip)</span>
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRunDownload(
                              `html-${run.id}`,
                              () => downloadOfflineHtmlReport(projectId, run.id),
                              'Offline HTML report'
                            )
                          }
                          disabled={downloadingKey !== null}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded border border-border bg-card hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                          title="Download offline HTML report"
                        >
                          {downloadingKey === `html-${run.id}` ? (
                            <Loader2 className="size-3 animate-spin text-primary" aria-hidden="true" />
                          ) : (
                            <FileText className="size-3 text-primary" aria-hidden="true" />
                          )}
                          <span>HTML Report</span>
                        </button>
                        {drift?.baseline?.id !== run.id && !(run as any).isBaseline && (
                          <button
                            type="button"
                            onClick={() => baselineMutation.mutate(run.id)}
                            disabled={baselineMutation.isPending}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded border border-border bg-card hover:bg-muted text-foreground transition-colors disabled:opacity-50"
                            title="Set as digital project baseline"
                          >
                            <BookmarkCheck className="size-3 text-primary" />
                            <span>Set as Baseline</span>
                          </button>
                        )}
                      </>
                    )}
                  </div>
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
              Configure & Trigger Preflight Assessment
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Select input files and deterministic preflight engines to execute against {project.name}
              {project.targetRelease ? ` (target release ${project.targetRelease})` : ''}.
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
                Analysis <span className="font-mono">{activeAnalysisId.slice(0, 8)}</span>:{' '}
                <strong>{activeStatus ?? 'QUEUED'}</strong>
                {activeStatus === 'COMPLETED' || activeStatus === 'PARTIAL'
                  ? ` — ${activeAnalysis?.findingsCount ?? 0} finding(s). Findings have been refreshed.`
                  : activeStatus === 'FAILED'
                  ? ' — the analysis service reported a failure. Check Run History for details.'
                  : isActiveAnalysisError
                  ? ' — status could not be refreshed; retrying.'
                  : ' — waiting for the analysis service…'}
              </span>
              {!isAnalysisRunning && (
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="font-semibold underline shrink-0"
                >
                  Run History
                </button>
              )}
            </div>
          )}

          <fieldset>
            <legend className="text-xs font-bold text-foreground">
              Select Input Files ({selectedFileIds.length} of {cleanFiles.length} CLEAN file(s) selected)
            </legend>
            {isArtifactsLoading ? (
              <div className="mt-3 h-16 rounded-lg bg-muted animate-pulse" aria-hidden="true" />
            ) : isArtifactsError ? (
              <div role="alert" className="mt-3 p-3 rounded-lg border border-destructive/30 text-xs flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-destructive shrink-0" aria-hidden="true" />
                <span className="flex-1">Could not load project files.</span>
                <button type="button" onClick={() => refetchArtifacts()} className="font-semibold underline">
                  Retry
                </button>
              </div>
            ) : cleanFiles.length === 0 ? (
              <div className="mt-3 p-4 rounded-lg border border-dashed border-border text-xs text-muted-foreground flex flex-col sm:flex-row sm:items-center gap-3">
                <AlertCircle className="h-4 w-4 text-amber-600 shrink-0" aria-hidden="true" />
                <span className="flex-1">
                  No CLEAN file is available. Upload an SAP artifact and wait for it to pass the quarantine scan before launching an analysis.
                </span>
                <button
                  type="button"
                  onClick={() => setActiveTab('artifacts')}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-primary text-primary-foreground rounded-md font-semibold shrink-0"
                >
                  <UploadCloud className="h-3.5 w-3.5" aria-hidden="true" />
                  Upload files
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
                        {file.detectedFormat || 'UNKNOWN'}
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
                Select Preflight Engines ({selectedEngines.length} of {ALL_18_ENGINES.length} selected)
              </label>
              <div className="space-x-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => setSelectedEngines(ALL_18_ENGINES.map((e) => e.id))}
                  className="text-primary hover:underline font-semibold"
                >
                  Select All
                </button>
                <span className="text-muted-foreground">•</span>
                <button
                  type="button"
                  onClick={() => setSelectedEngines([])}
                  className="text-muted-foreground hover:underline"
                >
                  Deselect All
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
                      <div className="text-foreground">{eng.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{eng.domain}</div>
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
                  ? 'Launch disabled: upload at least one file that passes the quarantine scan (CLEAN).'
                  : selectedFileIds.length === 0
                  ? 'Launch disabled: select at least one CLEAN input file.'
                  : 'Launch disabled: select at least one engine.'}
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
                  Queuing analysis...
                </>
              ) : isAnalysisRunning ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Analysis in progress...
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Execute Preflight Run
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
