'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FlaskConical,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  Check,
  FileCode2,
  ChevronRight,
  ArrowLeft,
  Sparkles,
  ShieldCheck,
  ShieldAlert,
  Layers,
  Code2,
  Loader2,
  RefreshCw,
  FolderOpen,
  Info,
  ChevronDown,
  ChevronUp,
  FileText,
  Clock,
  Cpu,
  CheckCircle,
} from 'lucide-react';
import { customInstance } from '@/lib/api/custom-instance';
import { fetchProject } from '@/lib/api-client';
import { SeverityBadge } from '@/components/findings/severity-badge';
import { ConfidenceBadge } from '@/components/findings/confidence-badge';
import { RegressionTestsPanel } from '@/components/findings/regression-tests-panel';
import {
  ScenarioDomain,
  ScenarioFailureType,
  SyntheticScenario,
  LabRunResult,
  LabAssertionItem,
  Severity,
  ConfidenceClass,
  TargetRelease,
} from '@erppreflight/schemas';

interface DomainOption {
  id: ScenarioDomain;
  name: string;
  engine: string;
  description: string;
  failureOptions: Array<{ id: ScenarioFailureType; label: string; description: string }>;
}

const DOMAINS: DomainOption[] = [
  {
    id: 'OPD',
    name: 'OPD Output Determination',
    engine: 'OPD_GUARD',
    description: 'BRFplus decision tables for billing and purchase order determination',
    failureOptions: [
      {
        id: 'CLEAN_PASS',
        label: 'Clean Pass (Valid Email & Role)',
        description: 'All 8 determination steps resolve condition records cleanly',
      },
      {
        id: 'OPD_MISSING_RECIPIENT',
        label: 'Missing Recipient Defect',
        description: 'Customer 100045 has no recipient entry in Email Recipient step',
      },
      {
        id: 'OPD_INVALID_CHANNEL',
        label: 'Decommissioned Channel (FAX)',
        description: 'Output table assigns FAX which is retired in Cloud',
      },
      {
        id: 'OPD_SHADOWED_RULE',
        label: 'Shadowed Rule (Unreachable)',
        description: 'Wildcard rule subsumes specific document type condition',
      },
    ],
  },
  {
    id: 'FORM',
    name: 'ADS FormDoctor Binding',
    engine: 'FORM_DOCTOR',
    description: 'Adobe Document Services XDP template and context XML binding evaluator',
    failureOptions: [
      {
        id: 'CLEAN_PASS',
        label: 'Clean Pass (Bound Key-User Field)',
        description: 'All bound XDP fields resolve to valid elements in runtime XML',
      },
      {
        id: 'FORM_MISSING_BINDING',
        label: 'Unbound Custom Field (YY1_*)',
        description: 'Bound YY1_PROMOTIONAL_CODE field missing from payload XML',
      },
      {
        id: 'FORM_BINDING_MISMATCH',
        label: 'Path Mismatch (PostingDate)',
        description: 'Bound path $.Header.PostingDate not found in XML structure',
      },
      {
        id: 'FORM_TRUNCATION_RISK',
        label: 'Corrupted XDP Syntax',
        description: 'Template syntax unclosed tag triggering parse rejection',
      },
    ],
  },
  {
    id: 'MFS',
    name: 'MFS PLC Telegram Buffer',
    engine: 'MFS_BLACKBOX',
    description: 'Material Flow System conveyor & stacker crane sequence auditor',
    failureOptions: [
      {
        id: 'CLEAN_PASS',
        label: 'Clean Sequence (Ordered Topology)',
        description: 'Valid sequential telegram flow with timely PLC acknowledgements',
      },
      {
        id: 'MFS_LOCATION_JUMP',
        label: 'Topology Location Jump (CP01 -> CP05)',
        description: 'Handling unit jumps checkpoints without valid graph edge',
      },
      {
        id: 'MFS_ACK_TIMEOUT',
        label: 'PLC ACK Timeout & Retry Storm',
        description: 'Missing telegram ACK response triggering duplicate sends',
      },
    ],
  },
  {
    id: 'CHANGE_POINTER',
    name: 'Change Pointer Coverage',
    engine: 'CHANGE_POINTER_COVERAGE_AUDITOR',
    description: 'BD21 / BD52 Material Master (MATMAS) delta trigger verification',
    failureOptions: [
      {
        id: 'CLEAN_PASS',
        label: 'Clean Pass (Active Trigger on BRGEW)',
        description: 'BD61 active, BD50 enabled, and all critical fields registered',
      },
      {
        id: 'CP_MISSING_FIELD_TRIGGER',
        label: 'Missing BD52 Active Trigger',
        description: 'Gross weight MARA-BRGEW omitted from change pointer trigger',
      },
      {
        id: 'CP_GLOBAL_DISABLED',
        label: 'Global Change Pointers Deactivated',
        description: 'Global change pointer flag deactivated in BD61 configuration',
      },
    ],
  },
];

const TARGET_RELEASES: TargetRelease[] = [
  'S4H_2023',
  'S4H_2022',
  'S4H_2021',
  'S4H_2020',
  'S4HC_2408',
  'S4HC_2402',
];

export default function ScenarioTestLabPage() {
  const params = useParams();
  const projectId = (params?.id as string) || '';
  const queryClient = useQueryClient();

  // Project details query
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId),
  });

  // Saved scenarios query
  const {
    data: savedScenarios = [],
    isLoading: isSavedLoading,
    refetch: refetchSavedScenarios,
  } = useQuery({
    queryKey: ['labScenarios', projectId],
    queryFn: () =>
      customInstance<SyntheticScenario[]>(`/projects/${projectId}/lab/scenarios`),
    enabled: Boolean(projectId),
    staleTime: 1000 * 30,
  });

  // State
  const [selectedDomain, setSelectedDomain] = React.useState<ScenarioDomain>('OPD');
  const [selectedFailureType, setSelectedFailureType] =
    React.useState<ScenarioFailureType>('OPD_MISSING_RECIPIENT');
  const [targetRelease, setTargetRelease] = React.useState<TargetRelease>('S4H_2023');
  const [currentScenario, setCurrentScenario] = React.useState<SyntheticScenario | null>(null);
  const [editedPayload, setEditedPayload] = React.useState<string>('');
  const [isPayloadDirty, setIsPayloadDirty] = React.useState<boolean>(false);
  const [runResult, setRunResult] = React.useState<LabRunResult | null>(null);
  const [copiedPayload, setCopiedPayload] = React.useState<boolean>(false);
  const [expandedLedgerRow, setExpandedLedgerRow] = React.useState<string | null>(null);
  const [showSavedDrawer, setShowSavedDrawer] = React.useState<boolean>(false);
  const [executionError, setExecutionError] = React.useState<string | null>(null);

  const activeDomainConfig =
    DOMAINS.find((d) => d.id === selectedDomain) || DOMAINS[0];

  // Mutation: Generate Scenario
  const generateMutation = useMutation({
    mutationFn: async (vars: {
      domain: ScenarioDomain;
      failureType: ScenarioFailureType;
    }) => {
      setExecutionError(null);
      return await customInstance<SyntheticScenario>(
        `/projects/${projectId}/lab/generate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: vars.domain,
            failureType: vars.failureType,
            scenarioName: `${vars.domain} Lab: ${vars.failureType.replace(/_/g, ' ')}`,
          }),
        }
      );
    },
    onSuccess: (data) => {
      setCurrentScenario(data);
      setEditedPayload(data.payload);
      setIsPayloadDirty(false);
      setRunResult(null);
      setExecutionError(null);
      queryClient.invalidateQueries({ queryKey: ['labScenarios', projectId] });
    },
    onError: (err: any) => {
      setExecutionError(
        err?.message || 'Failed to generate synthetic scenario. Check backend connectivity.'
      );
    },
  });

  // Mutation: Run Scenario
  const runMutation = useMutation({
    mutationFn: async (vars: {
      domain: ScenarioDomain;
      payload: string;
      expectedFindings?: any[];
      targetRelease: string;
      scenarioId?: string;
    }) => {
      setExecutionError(null);
      return await customInstance<LabRunResult>(
        `/projects/${projectId}/lab/run`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            domain: vars.domain,
            payload: vars.payload,
            expectedFindings: vars.expectedFindings,
            targetRelease: vars.targetRelease,
            scenarioId: vars.scenarioId,
          }),
        }
      );
    },
    onSuccess: (data) => {
      setRunResult(data);
      setExecutionError(null);
      queryClient.invalidateQueries({ queryKey: ['labScenarios', projectId] });
    },
    onError: (err: any) => {
      setExecutionError(
        err?.message ||
          'Failed to execute preflight test. Ensure services/analysis-python is running.'
      );
    },
  });

  // Initial Scenario Generation on Mount
  React.useEffect(() => {
    generateMutation.mutate({
      domain: selectedDomain,
      failureType: selectedFailureType,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDomain, selectedFailureType]);

  const handleDomainChange = (domainId: ScenarioDomain) => {
    setSelectedDomain(domainId);
    const domainObj = DOMAINS.find((d) => d.id === domainId);
    if (domainObj && domainObj.failureOptions.length > 0) {
      setSelectedFailureType(domainObj.failureOptions[0].id);
    }
  };

  const handleCopyPayload = () => {
    if (editedPayload) {
      navigator.clipboard.writeText(editedPayload);
      setCopiedPayload(true);
      setTimeout(() => setCopiedPayload(false), 2000);
    }
  };

  const handleResetPayload = () => {
    if (currentScenario?.payload) {
      setEditedPayload(currentScenario.payload);
      setIsPayloadDirty(false);
    }
  };

  const handleExecutePreflight = () => {
    if (!editedPayload.trim()) return;
    runMutation.mutate({
      domain: selectedDomain,
      payload: editedPayload,
      expectedFindings: currentScenario?.expectedFindings,
      targetRelease,
      scenarioId: currentScenario?.scenarioId,
    });
  };

  const handleLoadSavedScenario = (scen: SyntheticScenario) => {
    setSelectedDomain(scen.domain);
    setSelectedFailureType(scen.failureType);
    setCurrentScenario(scen);
    setEditedPayload(scen.payload);
    setIsPayloadDirty(false);
    setRunResult(null);
    setExecutionError(null);
    setShowSavedDrawer(false);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-20">
      {/* Breadcrumb Navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link href="/projects" className="hover:text-foreground transition-colors">
          Projects
        </Link>
        <ChevronRight className="size-3.5" />
        <Link
          href={`/projects/${projectId}`}
          className="hover:text-foreground transition-colors font-mono"
        >
          {project?.name || 'Workspace'}
        </Link>
        <ChevronRight className="size-3.5" />
        <span className="font-semibold text-foreground">Scenario & Regression Test Lab</span>
      </nav>

      {/* Page Header */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="size-9 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                <FlaskConical className="size-5" />
              </div>
              <div>
                <h1 className="text-xl sm:text-2xl font-extrabold text-foreground tracking-tight">
                  Scenario & Regression Test Lab
                </h1>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Interactive fixture generator & live rule execution workbench across OPD, ADS Forms, MFS BlackBox, and Change Pointers.
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowSavedDrawer(!showSavedDrawer)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card hover:bg-muted text-foreground transition-colors shadow-xs"
            >
              <FolderOpen className="size-3.5 text-primary" />
              <span>Saved Scenarios ({savedScenarios.length})</span>
            </button>
            <Link
              href={`/projects/${projectId}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shadow-xs"
            >
              <ArrowLeft className="size-3.5" />
              Back to Overview
            </Link>
          </div>
        </div>
      </div>

      {/* Regression tests generated from findings (Part 05 §5.5) */}
      <RegressionTestsPanel projectId={projectId} />

      {/* Saved Scenarios Drawer / Slide-Down */}
      {showSavedDrawer && (
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FolderOpen className="size-4 text-primary" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">
                Workspace Scenarios Archive ({savedScenarios.length})
              </h3>
            </div>
            <button
              onClick={() => setShowSavedDrawer(false)}
              className="text-xs text-muted-foreground hover:text-foreground font-semibold"
            >
              Close
            </button>
          </div>

          {isSavedLoading ? (
            <div className="py-4 text-center text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin inline mr-2" />
              Loading scenario catalog...
            </div>
          ) : savedScenarios.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">
              No saved scenarios found for this project. Generate and run scenarios to persist them automatically.
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
              {savedScenarios.map((scen) => (
                <button
                  key={scen.scenarioId}
                  onClick={() => handleLoadSavedScenario(scen)}
                  className="text-left p-3 rounded-lg border border-border bg-muted/20 hover:bg-muted/60 transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[10px] uppercase font-bold text-primary">
                        {scen.domain}
                      </span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {scen.format.toUpperCase()}
                      </span>
                    </div>
                    <h4 className="text-xs font-semibold text-foreground mt-1 truncate">
                      {scen.scenarioName}
                    </h4>
                  </div>
                  <span className="text-[10px] text-muted-foreground mt-2 block">
                    Mode: {scen.failureType}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Domain Selection Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {DOMAINS.map((domain) => {
          const isSelected = selectedDomain === domain.id;
          return (
            <button
              key={domain.id}
              onClick={() => handleDomainChange(domain.id)}
              className={`text-left p-4 rounded-xl border transition-all ${
                isSelected
                  ? 'border-primary bg-primary/5 shadow-xs ring-1 ring-primary/20'
                  : 'border-border bg-card hover:bg-muted/50'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-bold text-xs font-mono uppercase tracking-wider text-primary">
                  {domain.id}
                </span>
                {isSelected ? (
                  <Sparkles className="size-4 text-primary" />
                ) : (
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {domain.engine}
                  </span>
                )}
              </div>
              <h3 className="font-bold text-sm text-foreground mt-1.5">{domain.name}</h3>
              <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">
                {domain.description}
              </p>
            </button>
          );
        })}
      </div>

      {/* Defect Mode Selection & Target Release Panel */}
      <div className="p-4 rounded-xl border border-border bg-card shadow-xs space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider block">
              Test Scenario / Defect Mode ({activeDomainConfig.name})
            </label>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Select defect trigger or clean pass to generate authoritative synthetic test fixtures.
            </p>
          </div>

          {/* Target Release Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">
              Target Release:
            </span>
            <select
              value={targetRelease}
              onChange={(e) => setTargetRelease(e.target.value as TargetRelease)}
              className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-input bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {TARGET_RELEASES.map((rel) => (
                <option key={rel} value={rel}>
                  {rel}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Failure Options Pills */}
        <div className="flex flex-wrap gap-2">
          {activeDomainConfig.failureOptions.map((opt) => {
            const isSelected = selectedFailureType === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => setSelectedFailureType(opt.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border text-left ${
                  isSelected
                    ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                    : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
                }`}
              >
                <div>{opt.label}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Error Banner */}
      {executionError && (
        <div
          role="alert"
          className="p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-xs text-destructive flex items-start gap-3 shadow-xs"
        >
          <AlertTriangle className="size-4 shrink-0 mt-0.5" />
          <div className="flex-1">
            <span className="font-bold block">Execution Fault Detected</span>
            <p className="mt-0.5">{executionError}</p>
          </div>
          <button
            onClick={() => handleExecutePreflight()}
            className="px-2.5 py-1 rounded bg-destructive text-destructive-foreground font-semibold hover:bg-destructive/90 transition-colors"
          >
            Retry Run
          </button>
        </div>
      )}

      {/* Main Grid: Code / Payload Editor (Left) & Assertion Ledger (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left: Interactive Payload Editor */}
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileCode2 className="size-4 text-primary" />
              <span className="text-xs font-bold text-foreground">
                Synthetic Fixture Payload ({currentScenario?.format.toUpperCase() || 'XML'})
              </span>
              {isPayloadDirty && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300">
                  Modified
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {isPayloadDirty && (
                <button
                  onClick={handleResetPayload}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="Reset to generated fixture"
                >
                  <RotateCcw className="size-3" />
                  <span>Reset</span>
                </button>
              )}
              <button
                onClick={handleCopyPayload}
                disabled={!editedPayload}
                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                title="Copy payload to clipboard"
              >
                {copiedPayload ? (
                  <Check className="size-3 text-emerald-600" />
                ) : (
                  <Copy className="size-3" />
                )}
                <span>{copiedPayload ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                onClick={handleExecutePreflight}
                disabled={runMutation.isPending || !editedPayload.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-bold rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 shadow-xs"
              >
                {runMutation.isPending ? (
                  <>
                    <Loader2 className="size-3.5 animate-spin" />
                    <span>Executing Engine...</span>
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" />
                    <span>Execute Preflight Test</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Interactive Textarea Code Editor */}
          <div className="flex-1 bg-zinc-950 p-2 font-mono text-xs text-zinc-100 min-h-[380px] flex flex-col">
            <textarea
              value={editedPayload}
              onChange={(e) => {
                setEditedPayload(e.target.value);
                setIsPayloadDirty(true);
              }}
              spellCheck={false}
              placeholder="// Generating synthetic preflight fixture..."
              className="w-full flex-1 bg-transparent text-zinc-100 font-mono text-xs p-2 resize-none focus:outline-none selection:bg-primary/40 leading-relaxed"
            />
          </div>

          {/* Payload Footer */}
          <div className="px-4 py-2.5 border-t border-border bg-muted/20 text-xs flex items-center justify-between">
            <div className="flex items-center gap-3 text-muted-foreground text-[11px]">
              <span>Characters: {editedPayload.length}</span>
              <span>Format: {currentScenario?.format.toUpperCase() || 'XML'}</span>
            </div>

            {currentScenario?.expectedFindings && currentScenario.expectedFindings.length > 0 ? (
              <div className="flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400 font-medium">
                <AlertTriangle className="size-3.5 shrink-0" />
                <span>Expected: {currentScenario.expectedFindings[0].ruleId}</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                <CheckCircle2 className="size-3.5 shrink-0" />
                <span>Expected: Clean Pass (0 defects)</span>
              </div>
            )}
          </div>
        </div>

        {/* Right: Pass/Fail Regression Assertion Ledger */}
        <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs flex flex-col">
          <div className="px-4 py-3 border-b border-border bg-muted/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FlaskConical className="size-4 text-primary" />
              <span className="text-xs font-bold text-foreground">
                Regression Assertion Ledger
              </span>
            </div>

            {runResult && (
              <span
                role="status"
                aria-label={`Run Status: ${runResult.overallStatus}`}
                className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                  runResult.overallStatus === 'PASSED'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300 dark:bg-emerald-950/70 dark:text-emerald-300 dark:border-emerald-800'
                    : 'bg-rose-50 text-rose-800 border-rose-300 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800'
                }`}
              >
                {runResult.overallStatus === 'PASSED' ? (
                  <>
                    <CheckCircle2 className="size-3.5 text-emerald-600" />
                    <span>STATUS: PASSED</span>
                  </>
                ) : (
                  <>
                    <XCircle className="size-3.5 text-rose-600" />
                    <span>STATUS: {runResult.overallStatus}</span>
                  </>
                )}
              </span>
            )}
          </div>

          <div className="p-4 flex-1 flex flex-col justify-start space-y-4">
            {!runResult ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground my-auto">
                <div className="size-12 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-3">
                  <Play className="size-6 text-primary" />
                </div>
                <h4 className="font-bold text-sm text-foreground">Ready for Preflight Execution</h4>
                <p className="text-xs text-muted-foreground max-w-sm mt-1">
                  Click <strong>&quot;Execute Preflight Test&quot;</strong> to dispatch this payload to the Python engine (<code className="font-mono text-[11px] text-foreground">{activeDomainConfig.engine}</code>) and evaluate regression assertions.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Scorecard KPI Cards */}
                <div className="grid grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2.5 rounded-lg border border-border bg-muted/20">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                      Assertions
                    </span>
                    <span className="text-base font-bold font-mono text-foreground mt-0.5 block">
                      {runResult.passedCount} / {runResult.assertionsCount}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border bg-muted/20">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                      Verdict
                    </span>
                    <span
                      className={`text-xs font-bold font-mono mt-1 block ${
                        runResult.verdict === 'CLEAR'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      {runResult.verdict}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border bg-muted/20">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                      Exec Time
                    </span>
                    <span className="text-base font-bold font-mono text-foreground mt-0.5 block">
                      {runResult.executionTimeMs} ms
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border bg-muted/20">
                    <span className="text-muted-foreground block text-[10px] uppercase font-bold">
                      Rules Checked
                    </span>
                    <span className="text-base font-bold font-mono text-foreground mt-0.5 block">
                      {runResult.rulesEvaluated}
                    </span>
                  </div>
                </div>

                {/* Assertion Ledger Items */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Assertion Ledger Verification
                    </h4>
                    <span className="text-[11px] font-mono text-muted-foreground">
                      SHA: {runResult.payloadSha256.slice(0, 10)}...
                    </span>
                  </div>

                  {runResult.assertionLedger.map((item, idx) => {
                    const isExpanded = expandedLedgerRow === item.ruleId;
                    return (
                      <div
                        key={idx}
                        className={`rounded-xl border transition-all ${
                          item.passed
                            ? 'border-border bg-card'
                            : 'border-rose-300 dark:border-rose-800 bg-rose-50/20 dark:bg-rose-950/20'
                        }`}
                      >
                        <div
                          onClick={() =>
                            setExpandedLedgerRow(isExpanded ? null : item.ruleId)
                          }
                          className="p-3 cursor-pointer flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {item.passed ? (
                              <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                            ) : (
                              <XCircle className="size-4 text-rose-600 shrink-0" />
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-foreground">
                                  {item.ruleId}
                                </span>
                                <SeverityBadge severity={item.severity as Severity} size="sm" />
                              </div>
                              <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                                {item.message}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded border ${
                                item.passed
                                  ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-300'
                                  : 'text-rose-700 bg-rose-50 dark:bg-rose-950 dark:text-rose-300 border-rose-300'
                              }`}
                            >
                              {item.passed ? 'PASSED' : 'FAILED'}
                            </span>
                            {isExpanded ? (
                              <ChevronUp className="size-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="size-3.5 text-muted-foreground" />
                            )}
                          </div>
                        </div>

                        {/* Expandable Details Drawer */}
                        {isExpanded && (
                          <div className="p-3 border-t border-border/80 bg-muted/20 text-xs space-y-2">
                            <div className="grid grid-cols-2 gap-2 text-[11px]">
                              <div>
                                <span className="text-muted-foreground block">Expected Outcome:</span>
                                <span className="font-semibold text-foreground">
                                  {item.expected ? 'Defect Triggered' : 'Clean / Not Triggered'}
                                </span>
                              </div>
                              <div>
                                <span className="text-muted-foreground block">Actual Outcome:</span>
                                <span className="font-semibold text-foreground">
                                  {item.actual ? 'Defect Triggered' : 'Clean / Not Triggered'}
                                </span>
                              </div>
                            </div>

                            <div className="pt-1 flex items-center gap-2">
                              <ConfidenceBadge
                                confidence={item.confidenceClass as ConfidenceClass}
                                size="sm"
                              />
                              {item.lineNumber && (
                                <span className="text-[11px] font-mono text-muted-foreground">
                                  Line: {item.lineNumber}
                                </span>
                              )}
                            </div>

                            {item.evidenceSnippet && (
                              <div className="mt-1 bg-zinc-950 text-zinc-100 p-2 rounded font-mono text-[11px] overflow-x-auto">
                                <code>{item.evidenceSnippet}</code>
                              </div>
                            )}

                            <div className="pt-1 text-[10px] font-mono text-muted-foreground break-all">
                              Evidence Checksum: {item.evidenceSha256}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Deterministic Preflight Findings Emitted */}
                {runResult.findings.length > 0 && (
                  <div className="pt-2 border-t border-border space-y-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                      Emitted Engine Findings ({runResult.findings.length})
                    </h4>
                    <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                      {runResult.findings.map((finding, idx) => (
                        <div
                          key={finding.id || idx}
                          className="p-3 rounded-lg border border-border bg-card space-y-1.5 shadow-xs"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-xs font-bold text-primary">
                              {finding.ruleId}
                            </span>
                            <SeverityBadge severity={finding.severity as Severity} size="sm" />
                          </div>
                          <h5 className="font-bold text-xs text-foreground">{finding.title}</h5>
                          <p className="text-[11px] text-muted-foreground">{finding.description}</p>
                          <div className="pt-1 flex items-center justify-between text-[10px] text-muted-foreground border-t border-border/50">
                            <ConfidenceBadge
                              confidence={finding.confidence as ConfidenceClass}
                              score={finding.confidenceScore}
                              size="sm"
                            />
                            <span className="font-mono">
                              Artifact: {finding.evidence?.[0]?.artifactPath || 'inline'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
