'use client';

import React, { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldCheck,
  Bot,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  FileCode2,
  Copy,
  Plus,
  Play,
  ArrowRight,
  Clock,
  Sparkles,
  Lock,
  Loader2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {
  fetchAgents,
  registerAgent,
  fetchAgentProposals,
  submitAgentProposal,
  approveAgentProposal,
  AgentIdentityItem,
  AgentProposalItem,
  fetchProjects,
} from '@/lib/api-client';

export default function AgentGatePage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'proposals' | 'agents' | 'simulator'>('proposals');

  // Expanded proposal details
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);

  // New Agent Modal State
  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentRuntime, setAgentRuntime] = useState('MCP_CLIENT');
  const [agentMaxRisk, setAgentMaxRisk] = useState('MEDIUM');

  // Project whose proposals are listed (the API scopes proposals per project)
  const [proposalProjectId, setProposalProjectId] = useState('');

  // Simulator Form State
  const [simProjectId, setSimProjectId] = useState('');
  const [simAgentId, setSimAgentId] = useState('');
  const [simChangeType, setSimChangeType] = useState('REMOVE_CUSTOM_FIELD');
  const [simTargetEnv, setSimTargetEnv] = useState<'DEV' | 'QA' | 'PROD'>('QA');
  const [simDiffJson, setSimDiffJson] = useState('{\n  "targetObject": "YY1_CLASS",\n  "action": "DROP_FIELD"\n}');
  const [simSuccess, setSimSuccess] = useState<string | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  // Approved token modal
  const [issuedTokenInfo, setIssuedTokenInfo] = useState<{
    proposalId: string;
    token: string;
    expiresAt: string;
  } | null>(null);

  // Queries
  const { data: agents = [], isLoading: isAgentsLoading } = useQuery({
    queryKey: ['agent-gate-agents'],
    queryFn: fetchAgents,
  });

  const {
    data: projects = [],
    isLoading: isProjectsLoading,
    isError: isProjectsError,
    refetch: refetchProjects,
  } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  // Default the proposal list to the first project once projects load.
  useEffect(() => {
    if (!proposalProjectId && projects.length > 0) {
      setProposalProjectId(projects[0].id);
    }
  }, [projects, proposalProjectId]);

  const {
    data: proposals = [],
    isLoading: isProposalsLoading,
    isError: isProposalsError,
    error: proposalsError,
    refetch: refetchProposals,
  } = useQuery({
    queryKey: ['agent-gate-proposals', proposalProjectId],
    queryFn: () => fetchAgentProposals(proposalProjectId),
    enabled: Boolean(proposalProjectId),
  });

  // Mutations
  const registerAgentMutation = useMutation({
    mutationFn: registerAgent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-gate-agents'] });
      setShowNewAgentModal(false);
      setAgentName('');
    },
  });

  const submitProposalMutation = useMutation({
    mutationFn: submitAgentProposal,
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['agent-gate-proposals'] });
      setProposalProjectId(variables.projectId);
      setSimSuccess(`Change proposal submitted! Gate verdict: ${data.verdict}`);
      setSimError(null);
    },
    onError: (err: any) => {
      setSimError(err.message || 'Failed to submit proposal');
      setSimSuccess(null);
    },
  });

  const approveProposalMutation = useMutation({
    mutationFn: approveAgentProposal,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-gate-proposals'] });
      setIssuedTokenInfo({
        proposalId: data.proposal.id,
        token: data.executionToken,
        expiresAt: data.expiresAt,
      });
    },
  });

  const handleRegisterAgentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    registerAgentMutation.mutate({
      name: agentName.trim(),
      runtime: agentRuntime,
      maxRiskClass: agentMaxRisk,
    });
  };

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simProjectId || !simAgentId) {
      setSimError('Please select both a Project and an Agent');
      return;
    }
    let parsedDiff = {};
    try {
      parsedDiff = JSON.parse(simDiffJson);
    } catch {
      setSimError('Invalid JSON format in Proposed Diff');
      return;
    }

    submitProposalMutation.mutate({
      projectId: simProjectId,
      agentId: simAgentId,
      changeType: simChangeType,
      targetEnvironment: simTargetEnv,
      proposedDiff: parsedDiff,
    });
  };

  const getVerdictBadge = (verdict: string) => {
    switch (verdict) {
      case 'CLEAR':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            <CheckCircle2 className="size-3" />
            CLEAR
          </span>
        );
      case 'CLEAR_WITH_WARNINGS':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
            <AlertTriangle className="size-3" />
            WARNINGS
          </span>
        );
      case 'HUMAN_REVIEW_REQUIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            <Lock className="size-3" />
            DUAL-REVIEW
          </span>
        );
      case 'BLOCKED':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
            <XCircle className="size-3" />
            BLOCKED
          </span>
        );
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider">
            <Bot className="size-4" />
            <span>Autonomous ERP Governance • Part 19</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">
            Agentic Change Gate & MCP Client Governance
          </h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">
            Governs AI agents (SAP Joule, Claude, Cursor, Copilot) proposing ERP changes.
            Enforces deterministic preflight verification, production write-safety locks,
            and cryptographic proposal hash binding prior to execution.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowNewAgentModal(true)}
            className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm"
          >
            <Plus className="size-4" />
            <span>Register Agent</span>
          </button>
        </div>
      </div>

      {/* Epistemic Invariant Callout */}
      <div className="bg-gradient-to-r from-blue-950/20 via-background to-card border border-blue-800/30 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="size-5 text-blue-500 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <p className="font-semibold text-foreground">
            Production Write-Safety Invariant (Part 19.1 & 19.8)
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Autonomous execution to <span className="font-mono text-foreground font-semibold">PROD</span> is strictly blocked.
            Agent execution tokens are short-lived (15 min TTL), bound to the exact SHA-256 proposal hash,
            and revoked if any proposal property is mutated.
          </p>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-border">
        <div className="flex gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('proposals')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'proposals'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <FileCode2 className="size-4" />
            <span>Change Proposals ({proposals.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('agents')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'agents'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Bot className="size-4" />
            <span>Registered Agents ({agents.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('simulator')}
            className={`pb-3 text-sm font-semibold border-b-2 transition-colors flex items-center gap-2 ${
              activeTab === 'simulator'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Play className="size-4" />
            <span>Proposal Simulator</span>
          </button>
        </div>
      </div>

      {/* Tab: Proposals */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-xs">
            <label htmlFor="proposal-project" className="font-semibold text-foreground">
              Project
            </label>
            <select
              id="proposal-project"
              value={proposalProjectId}
              onChange={(e) => setProposalProjectId(e.target.value)}
              disabled={isProjectsLoading || projects.length === 0}
              className="w-full sm:w-80 px-3 py-2 bg-background border border-border rounded-lg text-foreground"
            >
              <option value="">Select project...</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {isProjectsError ? (
            <div role="alert" className="border border-destructive/30 rounded-xl p-6 text-center text-xs space-y-2">
              <AlertTriangle className="size-5 mx-auto text-destructive" aria-hidden="true" />
              <p className="font-semibold text-foreground">Could not load projects</p>
              <button type="button" onClick={() => refetchProjects()} className="font-semibold underline">
                Retry
              </button>
            </div>
          ) : !isProjectsLoading && projects.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-8 text-center text-xs text-muted-foreground">
              Change proposals are scoped to a project. Create a project first.
            </div>
          ) : !proposalProjectId ? (
            <div className="border border-dashed border-border rounded-xl p-8 text-center text-xs text-muted-foreground">
              Select a project to list its agent change proposals.
            </div>
          ) : isProposalsError ? (
            <div role="alert" className="border border-destructive/30 rounded-xl p-6 text-center text-xs space-y-2">
              <AlertTriangle className="size-5 mx-auto text-destructive" aria-hidden="true" />
              <p className="font-semibold text-foreground">Could not load change proposals</p>
              <p className="text-muted-foreground">{(proposalsError as Error)?.message}</p>
              <button type="button" onClick={() => refetchProposals()} className="font-semibold underline">
                Retry
              </button>
            </div>
          ) : isProposalsLoading ? (
            <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading agent change proposals...</span>
            </div>
          ) : proposals.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-12 text-center space-y-3">
              <Bot className="size-8 mx-auto text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">No Agent Proposals Yet</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                When external or internal AI agents interact via MCP or the Change Proposal API,
                their preflight proposals will be recorded and governed here.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('simulator')}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-muted hover:bg-muted/80 text-foreground transition-all"
              >
                <span>Simulate First Proposal</span>
                <ArrowRight className="size-3" />
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {proposals.map((proposal) => {
                const isExpanded = expandedProposalId === proposal.id;
                const canApprove =
                  proposal.approval_status === 'PENDING_REVIEW' && proposal.verdict !== 'BLOCKED';

                return (
                  <div
                    key={proposal.id}
                    className="border border-border rounded-xl bg-card overflow-hidden shadow-sm transition-all"
                  >
                    <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          {getVerdictBadge(proposal.verdict)}
                          <span
                            className={`px-2 py-0.5 text-xs font-semibold rounded font-mono ${
                              proposal.target_environment === 'PROD'
                                ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20'
                                : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            ENV: {proposal.target_environment}
                          </span>
                          <span className="font-semibold text-foreground text-sm">
                            {proposal.change_type}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            by {proposal.agent_name || 'Autonomous Agent'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground font-mono">
                          <span>ID: {proposal.id.slice(0, 8)}</span>
                          <span>•</span>
                          <span>Hash: {proposal.proposal_hash.slice(0, 12)}...</span>
                          <span>•</span>
                          <span>{new Date(proposal.created_at).toLocaleString()}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {proposal.approval_status === 'APPROVED' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="size-3.5" />
                            Approved
                          </span>
                        ) : canApprove ? (
                          <button
                            type="button"
                            onClick={() => approveProposalMutation.mutate(proposal.id)}
                            disabled={approveProposalMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-50"
                          >
                            <KeyRound className="size-3.5" />
                            <span>Dual-Approve & Token</span>
                          </button>
                        ) : null}

                        <button
                          type="button"
                          onClick={() => setExpandedProposalId(isExpanded ? null : proposal.id)}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
                          title="Toggle Details"
                        >
                          {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Expandable Details */}
                    {isExpanded && (
                      <div className="border-t border-border p-4 bg-muted/20 space-y-4 text-xs">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                              Cryptographic Proposal SHA-256 Binding
                            </span>
                            <div className="mt-1 p-2 rounded bg-background border border-border font-mono text-[11px] break-all select-all">
                              {proposal.proposal_hash}
                            </div>
                          </div>
                          <div>
                            <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                              Preflight Policy Reasons
                            </span>
                            <ul className="mt-1 list-disc list-inside space-y-1 text-muted-foreground">
                              {proposal.verdict_details?.reasons?.map((r, idx) => (
                                <li key={idx}>{r}</li>
                              )) || <li>Evaluated cleanly under deterministic rules.</li>}
                            </ul>
                          </div>
                        </div>

                        <div>
                          <span className="font-semibold text-foreground uppercase tracking-wider text-[10px]">
                            Proposed Object Diff Payload
                          </span>
                          <pre className="mt-1 p-3 rounded bg-background border border-border font-mono text-[11px] overflow-x-auto text-foreground">
                            {JSON.stringify(proposal.proposed_diff, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab: Agents */}
      {activeTab === 'agents' && (
        <div className="space-y-4">
          {isAgentsLoading ? (
            <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading registered agents...</span>
            </div>
          ) : agents.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-12 text-center space-y-3">
              <Bot className="size-8 mx-auto text-muted-foreground/60" />
              <h3 className="text-sm font-semibold text-foreground">No Registered Agents</h3>
              <p className="text-xs text-muted-foreground max-w-md mx-auto">
                Register an AI orchestrator or MCP client to allow it to query ERP Preflight tools
                and submit change proposals.
              </p>
              <button
                type="button"
                onClick={() => setShowNewAgentModal(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
              >
                <Plus className="size-3.5" />
                <span>Register Agent</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="border border-border rounded-xl bg-card p-5 space-y-4 shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold text-foreground text-sm">{agent.name}</h3>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        Runtime: {agent.runtime}
                      </p>
                    </div>
                    <span className="px-2 py-0.5 text-xs font-semibold rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      {agent.status}
                    </span>
                  </div>

                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Max Risk Tier:</span>
                      <span className="font-semibold text-foreground">{agent.max_risk_class}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Approval Mode:</span>
                      <span className="font-semibold text-foreground">{agent.approval_mode}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Registered:</span>
                      <span>{new Date(agent.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-border">
                    <span className="text-[10px] uppercase font-semibold text-muted-foreground tracking-wider">
                      Allowed MCP Tools
                    </span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {agent.allowed_tools?.map((tool) => (
                        <span
                          key={tool}
                          className="px-2 py-0.5 text-[10px] font-mono rounded bg-muted text-muted-foreground"
                        >
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab: Simulator */}
      {activeTab === 'simulator' && (
        <div className="border border-border rounded-xl bg-card p-6 max-w-2xl mx-auto space-y-5 shadow-sm">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Play className="size-4 text-primary" />
              <span>Simulate Agent Change Proposal</span>
            </h2>
            <p className="text-xs text-muted-foreground">
              Directly submit a change diff payload as an external agent to evaluate deterministic preflight gates,
              blocking policies, and hash generation.
            </p>
          </div>

          {simSuccess && (
            <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" />
              <span>{simSuccess}</span>
            </div>
          )}

          {simError && (
            <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
              <XCircle className="size-4 shrink-0" />
              <span>{simError}</span>
            </div>
          )}

          <form onSubmit={handleSimulateSubmit} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1">Target Project</label>
                <select
                  value={simProjectId}
                  onChange={(e) => setSimProjectId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                >
                  <option value="">Select project...</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Submitting Agent</label>
                <select
                  value={simAgentId}
                  onChange={(e) => setSimAgentId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                >
                  <option value="">Select registered agent...</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({a.runtime})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-medium text-foreground mb-1">Change Type</label>
                <select
                  value={simChangeType}
                  onChange={(e) => setSimChangeType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                >
                  <option value="REMOVE_CUSTOM_FIELD">REMOVE_CUSTOM_FIELD</option>
                  <option value="MODIFY_OPD_RULE">MODIFY_OPD_RULE</option>
                  <option value="MIGRATE_API_VERSION">MIGRATE_API_VERSION</option>
                  <option value="DROP_TABLE_MUTATION">DROP_TABLE_MUTATION (Policy Block Test)</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Target Environment</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['DEV', 'QA', 'PROD'] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setSimTargetEnv(env)}
                      className={`py-2 text-center rounded-lg font-semibold border transition-all ${
                        simTargetEnv === env
                          ? env === 'PROD'
                            ? 'bg-rose-500/20 text-rose-400 border-rose-500/40'
                            : 'bg-primary text-primary-foreground border-primary'
                          : 'border-border bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div>
              <label className="block font-medium text-foreground mb-1">
                Proposed Diff Payload (JSON)
              </label>
              <textarea
                rows={5}
                value={simDiffJson}
                onChange={(e) => setSimDiffJson(e.target.value)}
                className="w-full px-3 py-2 font-mono text-[11px] rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            <button
              type="submit"
              disabled={submitProposalMutation.isPending}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
            >
              {submitProposalMutation.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ShieldCheck className="size-4" />
              )}
              <span>Submit to Agentic Gate</span>
            </button>
          </form>
        </div>
      )}

      {/* Issued Token Dialog */}
      {issuedTokenInfo && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-emerald-500">
              <KeyRound className="size-6" />
              <h3 className="text-base font-semibold text-foreground">
                Execution Token Issued
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              The proposal has been approved. The external agent can present this short-lived cryptographic
              token to execute the verified change.
            </p>

            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                Execution Token (TTL: 15 minutes)
              </span>
              <div className="p-3 rounded-lg bg-background border border-border font-mono text-[11px] break-all select-all text-primary">
                {issuedTokenInfo.token}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(issuedTokenInfo.token);
                }}
                className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold flex items-center gap-1.5"
              >
                <Copy className="size-3.5" />
                <span>Copy Token</span>
              </button>
              <button
                type="button"
                onClick={() => setIssuedTokenInfo(null)}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Agent Modal */}
      {showNewAgentModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Bot className="size-5 text-primary" />
              <span>Register AI Agent</span>
            </h3>

            <form onSubmit={handleRegisterAgentSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-foreground mb-1">Agent Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. SAP Joule Production Copilot"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Runtime / Orchestrator</label>
                <select
                  value={agentRuntime}
                  onChange={(e) => setAgentRuntime(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                >
                  <option value="MCP_CLIENT">Model Context Protocol (MCP)</option>
                  <option value="LANGCHAIN">LangChain / LangGraph</option>
                  <option value="CREWAI">CrewAI</option>
                  <option value="GITHUB_ACTIONS">GitHub Actions CI Bot</option>
                  <option value="CUSTOM_HTTP">Custom HTTP Orchestrator</option>
                </select>
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Max Risk Class</label>
                <select
                  value={agentMaxRisk}
                  onChange={(e) => setAgentMaxRisk(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                >
                  <option value="LOW">LOW — Read-Only & Ingestion Analysis</option>
                  <option value="MEDIUM">MEDIUM — DEV & QA Proposal Generation</option>
                  <option value="HIGH">HIGH — Critical Architecture Refactoring</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewAgentModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={registerAgentMutation.isPending}
                  className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  Register
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
