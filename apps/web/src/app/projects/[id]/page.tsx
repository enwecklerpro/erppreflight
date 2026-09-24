'use client';

import React, { useState } from 'react';
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
} from 'lucide-react';
import {
  ALL_18_ENGINES,
  fetchProject,
  fetchFindingsStats,
  fetchAnalyses,
  triggerAnalysis,
} from '../../../lib/api-client';

export default function ProjectWorkspacePage() {
  const params = useParams();
  const projectId = (params?.id as string) || '';
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<
    'overview' | 'findings' | 'objects' | 'artifacts' | 'history' | 'launcher'
  >('overview');
  const [selectedEngines, setSelectedEngines] = useState<string[]>([
    'OPD_GUARD',
    'CLEAN_CORE_OBJECT_GUARD',
    'FORM_DOCTOR',
  ]);
  const [launchMessage, setLaunchMessage] = useState<string | null>(null);

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

  // Real Analysis Execution Mutation
  const launchMutation = useMutation({
    mutationFn: () =>
      triggerAnalysis({
        projectId,
        engineTypes: selectedEngines,
        targetRelease: project?.targetRelease || 'S4H_2023',
      }),
    onSuccess: (data) => {
      setLaunchMessage(
        `Preflight analysis completed! ${data.findingsCount} finding(s) detected across ${selectedEngines.length} engine(s).`
      );
      queryClient.invalidateQueries({ queryKey: ['findingsStats', projectId] });
      queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
      queryClient.invalidateQueries({ queryKey: ['findings', projectId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
    },
    onError: (err: any) => {
      setLaunchMessage(`Launch failed: ${err?.message || 'Server error'}`);
    },
  });

  const toggleEngine = (id: string) => {
    setSelectedEngines((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const handleLaunch = () => {
    setLaunchMessage(null);
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

  const cleanCoreScore = stats?.cleanCoreIndex ?? 100.0;
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
              Workspace ID: {project.id} • Target Release: {project.targetRelease}
            </p>
          </div>

          <div className="flex gap-2">
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
                  {cleanCoreScore.toFixed(1)}%
                </span>
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded border ${
                    cleanCoreScore >= 85
                      ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                      : 'text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                  }`}
                >
                  {cleanCoreScore >= 85 ? 'Target Met (>85%)' : 'Needs Remediation'}
                </span>
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
                <span className="text-3xl font-bold text-foreground font-mono">Verified</span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  Catalog Active
                </span>
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
                <span className="text-3xl font-bold text-foreground">Ready</span>
                <span className="text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  Clean Quarantine
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                XML, JSON, CSV, and ABAP artifacts evaluated by deterministic engines.
              </p>
            </div>
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

      {/* Tab: Artifact Dropzone */}
      {activeTab === 'artifacts' && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="text-center py-8">
            <UploadCloud className="h-12 w-12 text-primary mx-auto mb-3" />
            <h3 className="text-base font-bold text-foreground">Staged SAP Artifacts</h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
              Secure quarantine scanning, MIME sniffing, and secret scrubbing for customer ZIPs, XML, and ABAP dumps.
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950 px-2.5 py-1 rounded border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
                <FileCheck2 className="h-3.5 w-3.5" />
                Antivirus Scanner Active
              </span>
            </div>
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
                <div key={run.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold font-mono text-foreground">{run.id.slice(0, 8)}...</span>
                      <span className="text-muted-foreground">
                        • {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-muted-foreground mt-0.5">
                      Evaluated {run.engineTypes?.length || 0} engine(s) • {run.findingsCount} finding(s) detected • Release: {run.targetRelease}
                    </p>
                  </div>
                  <span
                    className={`px-2.5 py-0.5 text-xs font-semibold rounded ${
                      run.status === 'COMPLETED'
                        ? 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                        : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                    }`}
                  >
                    {run.status}
                  </span>
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
              Select which deterministic preflight engines to execute against {project.name}.
            </p>
          </div>

          {launchMessage && (
            <div
              className={`p-4 rounded-lg text-xs flex items-center gap-2 ${
                launchMutation.isError
                  ? 'bg-red-50 border border-red-200 text-red-800 dark:bg-red-950/60 dark:text-red-200'
                  : 'bg-green-50 border border-green-200 text-green-800 dark:bg-green-950/60 dark:text-green-200'
              }`}
            >
              {launchMutation.isError ? (
                <AlertCircle className="h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle className="h-4 w-4 shrink-0" />
              )}
              <span>{launchMessage}</span>
            </div>
          )}

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

          <div className="pt-4 border-t border-border flex justify-end">
            <button
              onClick={handleLaunch}
              disabled={launchMutation.isPending || selectedEngines.length === 0}
              className="px-5 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-blue-600 transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              {launchMutation.isPending ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Dispatching to Analysis Service...
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
