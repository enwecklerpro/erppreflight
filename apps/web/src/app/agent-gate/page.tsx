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
  fetchProjects,
} from '@/lib/api-client';
import { Dialog } from '@/components/dialog';
import { useErrorText, useFmt, useLabel, useRichT, useT } from '@/i18n/client';

type Tab = 'proposals' | 'agents' | 'simulator';
const RUNTIMES = ['MCP_CLIENT', 'LANGCHAIN', 'CREWAI', 'GITHUB_ACTIONS', 'CUSTOM_HTTP'] as const;
const RISKS = ['LOW', 'MEDIUM', 'HIGH'] as const;
const CHANGE_TYPES = ['REMOVE_CUSTOM_FIELD', 'MODIFY_OPD_RULE', 'MIGRATE_API_VERSION', 'DROP_TABLE_MUTATION'] as const;

const inputClass =
  'w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40';

function VerdictBadge({ verdict }: { verdict: string }) {
  const label = useLabel();
  const meta: Record<string, { cls: string; icon: React.ComponentType<{ className?: string }> }> = {
    CLEAR: { cls: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800', icon: CheckCircle2 },
    CLEAR_WITH_WARNINGS: { cls: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300 border-amber-200 dark:border-amber-800', icon: AlertTriangle },
    HUMAN_REVIEW_REQUIRED: { cls: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 border-blue-200 dark:border-blue-800', icon: Lock },
    BLOCKED: { cls: 'bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border-rose-200 dark:border-rose-800', icon: XCircle },
  };
  const key = meta[verdict] ? verdict : 'BLOCKED';
  const { cls, icon: Icon } = meta[key];
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-semibold border ${cls}`}>
      <Icon className="size-3" aria-hidden="true" />
      {label('app.agentGate.verdict', key)}
    </span>
  );
}

export default function AgentGatePage() {
  const t = useT();
  const rt = useRichT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<Tab>('proposals');
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);

  const [showNewAgentModal, setShowNewAgentModal] = useState(false);
  const [agentName, setAgentName] = useState('');
  const [agentRuntime, setAgentRuntime] = useState<string>('MCP_CLIENT');
  const [agentMaxRisk, setAgentMaxRisk] = useState<string>('MEDIUM');

  const [proposalProjectId, setProposalProjectId] = useState('');

  const [simProjectId, setSimProjectId] = useState('');
  const [simAgentId, setSimAgentId] = useState('');
  const [simChangeType, setSimChangeType] = useState<string>('REMOVE_CUSTOM_FIELD');
  const [simTargetEnv, setSimTargetEnv] = useState<'DEV' | 'QA' | 'PROD'>('QA');
  const [simDiffJson, setSimDiffJson] = useState('{\n  "targetObject": "YY1_CLASS",\n  "action": "DROP_FIELD"\n}');
  const [simSuccess, setSimSuccess] = useState<string | null>(null);
  const [simError, setSimError] = useState<string | null>(null);

  const [issuedTokenInfo, setIssuedTokenInfo] = useState<{ proposalId: string; token: string; expiresAt: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);

  const agentsQuery = useQuery({ queryKey: ['agent-gate-agents'], queryFn: fetchAgents });
  const agents = agentsQuery.data ?? [];

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });
  const projects = projectsQuery.data ?? [];

  useEffect(() => {
    if (!proposalProjectId && projects.length > 0) setProposalProjectId(projects[0].id);
  }, [projects, proposalProjectId]);

  const proposalsQuery = useQuery({
    queryKey: ['agent-gate-proposals', proposalProjectId],
    queryFn: () => fetchAgentProposals(proposalProjectId),
    enabled: Boolean(proposalProjectId),
  });
  const proposals = proposalsQuery.data ?? [];

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
      setSimSuccess(t('app.agentGate.simSubmitted', { verdict: label('app.agentGate.verdict', data.verdict) }));
      setSimError(null);
    },
    onError: (err: unknown) => {
      setSimError(errText(err, t('app.agentGate.simSubmitFailed')));
      setSimSuccess(null);
    },
  });

  const approveProposalMutation = useMutation({
    mutationFn: approveAgentProposal,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agent-gate-proposals'] });
      setTokenCopied(false);
      setIssuedTokenInfo({ proposalId: data.proposal.id, token: data.executionToken, expiresAt: data.expiresAt });
    },
  });

  const handleRegisterAgentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentName.trim()) return;
    registerAgentMutation.mutate({ name: agentName.trim(), runtime: agentRuntime, maxRiskClass: agentMaxRisk });
  };

  const handleSimulateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!simProjectId || !simAgentId) {
      setSimError(t('app.agentGate.simMissing'));
      return;
    }
    let parsedDiff = {};
    try {
      parsedDiff = JSON.parse(simDiffJson);
    } catch {
      setSimError(t('app.agentGate.simInvalidJson'));
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

  const tabButton = (tab: Tab, icon: React.ComponentType<{ className?: string }>, text: string) => {
    const Icon = icon;
    const active = activeTab === tab;
    return (
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => setActiveTab(tab)}
        className={`pb-3 text-sm font-semibold border-b-2 -mb-px whitespace-nowrap transition-colors flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-t ${
          active ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
        }`}
      >
        <Icon className="size-4" aria-hidden="true" />
        <span>{text}</span>
      </button>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-wider">
            <Bot className="size-4" aria-hidden="true" />
            <span>{t('app.agentGate.eyebrow')}</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground mt-1">{t('app.agentGate.title')}</h1>
          <p className="text-muted-foreground text-sm mt-1 max-w-3xl">{t('app.agentGate.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowNewAgentModal(true)}
          className="inline-flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>{t('app.agentGate.registerAgent')}</span>
        </button>
      </div>

      <div className="bg-gradient-to-r from-blue-950/10 via-background to-card border border-blue-800/30 rounded-xl p-4 flex items-start gap-3">
        <ShieldCheck className="size-5 text-blue-500 shrink-0 mt-0.5" aria-hidden="true" />
        <div className="text-sm space-y-1">
          <p className="font-semibold text-foreground">{t('app.agentGate.invariantTitle')}</p>
          <p className="text-muted-foreground leading-relaxed">
            {rt('app.agentGate.invariantRich', { b: (c) => <span className="font-mono text-foreground font-semibold">{c}</span> })}
          </p>
        </div>
      </div>

      <div className="border-b border-border overflow-x-auto">
        <div className="flex gap-6" role="tablist" aria-label={t('app.agentGate.tabsLabel')}>
          {tabButton('proposals', FileCode2, t('app.agentGate.tabProposals', { count: proposals.length }))}
          {tabButton('agents', Bot, t('app.agentGate.tabAgents', { count: agents.length }))}
          {tabButton('simulator', Play, t('app.agentGate.tabSimulator'))}
        </div>
      </div>

      {activeTab === 'proposals' && (
        <div className="space-y-4" role="tabpanel">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 text-sm">
            <label htmlFor="proposal-project" className="font-semibold text-foreground">
              {t('app.agentGate.project')}
            </label>
            <select
              id="proposal-project"
              value={proposalProjectId}
              onChange={(e) => setProposalProjectId(e.target.value)}
              disabled={projectsQuery.isLoading || projects.length === 0}
              className={`${inputClass} sm:w-80`}
            >
              <option value="">{t('app.agentGate.selectProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {approveProposalMutation.isError && (
            <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm flex items-center gap-2">
              <XCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{errText(approveProposalMutation.error, t('app.agentGate.approveFailed'))}</span>
            </div>
          )}

          {projectsQuery.isError ? (
            <div role="alert" className="border border-destructive/30 rounded-xl p-6 text-center text-sm space-y-2">
              <AlertTriangle className="size-5 mx-auto text-destructive" aria-hidden="true" />
              <p className="font-semibold text-foreground">{t('app.agentGate.projectsFailed')}</p>
              <button type="button" onClick={() => projectsQuery.refetch()} className="font-semibold underline">
                {t('app.ui.retry')}
              </button>
            </div>
          ) : !projectsQuery.isLoading && projects.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-8 text-center text-sm text-muted-foreground">{t('app.agentGate.noProjects')}</div>
          ) : !proposalProjectId ? (
            <div className="border border-dashed border-border rounded-xl p-8 text-center text-sm text-muted-foreground">{t('app.agentGate.pickProject')}</div>
          ) : proposalsQuery.isError ? (
            <div role="alert" className="border border-destructive/30 rounded-xl p-6 text-center text-sm space-y-2">
              <AlertTriangle className="size-5 mx-auto text-destructive" aria-hidden="true" />
              <p className="font-semibold text-foreground">{t('app.agentGate.proposalsFailed')}</p>
              <p className="text-muted-foreground">{errText(proposalsQuery.error)}</p>
              <button type="button" onClick={() => proposalsQuery.refetch()} className="font-semibold underline">
                {t('app.ui.retry')}
              </button>
            </div>
          ) : proposalsQuery.isLoading ? (
            <div role="status" className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{t('app.agentGate.loadingProposals')}</span>
            </div>
          ) : proposals.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-8 sm:p-12 text-center space-y-3">
              <Bot className="size-8 mx-auto text-muted-foreground/60" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{t('app.agentGate.noProposalsTitle')}</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('app.agentGate.noProposalsBody')}</p>
              <button
                type="button"
                onClick={() => setActiveTab('simulator')}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-muted hover:bg-muted/80 text-foreground"
              >
                <span>{t('app.agentGate.simulateFirst')}</span>
                <ArrowRight className="size-3" aria-hidden="true" />
              </button>
            </div>
          ) : (
            <ul className="space-y-3">
              {proposals.map((proposal) => {
                const isExpanded = expandedProposalId === proposal.id;
                const canApprove = proposal.approval_status === 'PENDING_REVIEW' && proposal.verdict !== 'BLOCKED';
                const detailsId = `proposal-details-${proposal.id}`;
                return (
                  <li key={proposal.id} className="border border-border rounded-xl bg-card overflow-hidden shadow-sm">
                    <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <VerdictBadge verdict={proposal.verdict} />
                          <span
                            className={`px-2 py-0.5 text-xs font-semibold rounded font-mono ${
                              proposal.target_environment === 'PROD' ? 'bg-rose-500/10 text-rose-600 border border-rose-500/20' : 'bg-muted text-muted-foreground'
                            }`}
                          >
                            {t('app.agentGate.env', { env: proposal.target_environment })}
                          </span>
                          <span className="font-semibold text-foreground text-sm font-mono break-all">{proposal.change_type}</span>
                          <span className="text-xs text-muted-foreground">
                            {t('app.agentGate.byAgent', { agent: proposal.agent_name || t('app.agentGate.unknownAgent') })}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground font-mono">
                          <span>{t('app.agentGate.idLabel', { id: proposal.id.slice(0, 8) })}</span>
                          <span aria-hidden="true">•</span>
                          <span>{t('app.agentGate.hashLabel', { hash: proposal.proposal_hash.slice(0, 12) })}</span>
                          <span aria-hidden="true">•</span>
                          <span>{fmt.dateTime(proposal.created_at)}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {proposal.approval_status === 'APPROVED' ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1 text-xs font-semibold rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            {t('app.agentGate.approved')}
                          </span>
                        ) : canApprove ? (
                          <button
                            type="button"
                            onClick={() => approveProposalMutation.mutate(proposal.id)}
                            disabled={approveProposalMutation.isPending}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
                          >
                            <KeyRound className="size-3.5" aria-hidden="true" />
                            <span>{t('app.agentGate.approve')}</span>
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => setExpandedProposalId(isExpanded ? null : proposal.id)}
                          aria-expanded={isExpanded}
                          aria-controls={detailsId}
                          aria-label={t('app.agentGate.toggleDetails')}
                          title={t('app.agentGate.toggleDetails')}
                          className="p-1.5 rounded hover:bg-muted text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        >
                          {isExpanded ? <ChevronUp className="size-4" aria-hidden="true" /> : <ChevronDown className="size-4" aria-hidden="true" />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div id={detailsId} className="border-t border-border p-4 bg-muted/20 space-y-4 text-sm">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <span className="font-semibold text-foreground uppercase tracking-wider text-xs">{t('app.agentGate.hashTitle')}</span>
                            <div className="mt-1 p-2 rounded bg-background border border-border font-mono text-xs break-all select-all">{proposal.proposal_hash}</div>
                          </div>
                          <div>
                            <span className="font-semibold text-foreground uppercase tracking-wider text-xs">{t('app.agentGate.reasonsTitle')}</span>
                            <ul className="mt-1 list-disc list-inside space-y-1 text-muted-foreground">
                              {proposal.verdict_details?.reasons?.length ? (
                                proposal.verdict_details.reasons.map((r, idx) => <li key={idx}>{r}</li>)
                              ) : (
                                <li>{t('app.agentGate.noReasons')}</li>
                              )}
                            </ul>
                          </div>
                        </div>
                        <div>
                          <span className="font-semibold text-foreground uppercase tracking-wider text-xs">{t('app.agentGate.diffTitle')}</span>
                          <pre className="mt-1 p-3 rounded bg-background border border-border font-mono text-xs overflow-x-auto text-foreground">
                            {JSON.stringify(proposal.proposed_diff, null, 2)}
                          </pre>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'agents' && (
        <div className="space-y-4" role="tabpanel">
          {agentsQuery.isLoading ? (
            <div role="status" className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
              <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              <span>{t('app.agentGate.loadingAgents')}</span>
            </div>
          ) : agentsQuery.isError ? (
            <div role="alert" className="border border-destructive/30 rounded-xl p-6 text-center text-sm space-y-2">
              <AlertTriangle className="size-5 mx-auto text-destructive" aria-hidden="true" />
              <p className="font-semibold text-foreground">{t('app.agentGate.agentsFailed')}</p>
              <p className="text-muted-foreground">{errText(agentsQuery.error)}</p>
              <button type="button" onClick={() => agentsQuery.refetch()} className="font-semibold underline">
                {t('app.ui.retry')}
              </button>
            </div>
          ) : agents.length === 0 ? (
            <div className="border border-dashed border-border rounded-xl p-8 sm:p-12 text-center space-y-3">
              <Bot className="size-8 mx-auto text-muted-foreground/60" aria-hidden="true" />
              <h2 className="text-sm font-semibold text-foreground">{t('app.agentGate.noAgentsTitle')}</h2>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">{t('app.agentGate.noAgentsBody')}</p>
              <button
                type="button"
                onClick={() => setShowNewAgentModal(true)}
                className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="size-3.5" aria-hidden="true" />
                <span>{t('app.agentGate.registerAgent')}</span>
              </button>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {agents.map((agent) => (
                <li key={agent.id} className="border border-border rounded-xl bg-card p-5 space-y-4 shadow-sm min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h2 className="font-semibold text-foreground text-sm break-words">{agent.name}</h2>
                      <p className="text-xs text-muted-foreground font-mono mt-0.5">
                        {t('app.agentGate.runtime', { runtime: label('app.agentGate.runtimes', agent.runtime) })}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                      <CheckCircle2 className="size-3" aria-hidden="true" />
                      {label('app.agentGate.agentStatus', agent.status)}
                    </span>
                  </div>

                  <dl className="space-y-2 text-sm">
                    <div className="flex justify-between gap-2 text-muted-foreground">
                      <dt>{t('app.agentGate.maxRisk')}</dt>
                      <dd className="font-semibold text-foreground">{agent.max_risk_class}</dd>
                    </div>
                    <div className="flex justify-between gap-2 text-muted-foreground">
                      <dt>{t('app.agentGate.approvalMode')}</dt>
                      <dd className="font-semibold text-foreground font-mono text-xs">{agent.approval_mode}</dd>
                    </div>
                    <div className="flex justify-between gap-2 text-muted-foreground">
                      <dt>{t('app.agentGate.registered')}</dt>
                      <dd>{fmt.date(agent.created_at)}</dd>
                    </div>
                  </dl>

                  <div className="pt-2 border-t border-border">
                    <span className="text-xs uppercase font-semibold text-muted-foreground tracking-wider">{t('app.agentGate.allowedTools')}</span>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {agent.allowed_tools?.map((tool) => (
                        <span key={tool} className="px-2 py-0.5 text-xs font-mono rounded bg-muted text-muted-foreground">
                          {tool}
                        </span>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {activeTab === 'simulator' && (
        <div className="border border-border rounded-xl bg-card p-5 sm:p-6 max-w-2xl mx-auto space-y-5 shadow-sm" role="tabpanel">
          <div className="space-y-1">
            <h2 className="text-base font-semibold text-foreground flex items-center gap-2">
              <Play className="size-4 text-primary" aria-hidden="true" />
              <span>{t('app.agentGate.simTitle')}</span>
            </h2>
            <p className="text-sm text-muted-foreground">{t('app.agentGate.simIntro')}</p>
          </div>

          {simSuccess && (
            <div role="status" className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-sm flex items-center gap-2">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
              <span>{simSuccess}</span>
            </div>
          )}
          {simError && (
            <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm flex items-center gap-2">
              <XCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{simError}</span>
            </div>
          )}

          <form onSubmit={handleSimulateSubmit} className="space-y-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="sim-project" className="block font-medium text-foreground mb-1">
                  {t('app.agentGate.targetProject')}
                </label>
                <select id="sim-project" value={simProjectId} onChange={(e) => setSimProjectId(e.target.value)} className={inputClass}>
                  <option value="">{t('app.agentGate.selectProject')}</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="sim-agent" className="block font-medium text-foreground mb-1">
                  {t('app.agentGate.submittingAgent')}
                </label>
                <select id="sim-agent" value={simAgentId} onChange={(e) => setSimAgentId(e.target.value)} className={inputClass}>
                  <option value="">{t('app.agentGate.selectAgent')}</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} ({label('app.agentGate.runtimes', a.runtime)})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="sim-change-type" className="block font-medium text-foreground mb-1">
                  {t('app.agentGate.changeType')}
                </label>
                <select id="sim-change-type" value={simChangeType} onChange={(e) => setSimChangeType(e.target.value)} className={inputClass}>
                  {CHANGE_TYPES.map((ct) => (
                    <option key={ct} value={ct}>
                      {ct === 'DROP_TABLE_MUTATION' ? t('app.agentGate.policyBlockTest', { type: ct }) : ct}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset>
                <legend className="block font-medium text-foreground mb-1">{t('app.agentGate.targetEnv')}</legend>
                <div className="grid grid-cols-3 gap-2">
                  {(['DEV', 'QA', 'PROD'] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      aria-pressed={simTargetEnv === env}
                      onClick={() => setSimTargetEnv(env)}
                      className={`py-2 text-center rounded-lg font-semibold border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        simTargetEnv === env
                          ? env === 'PROD'
                            ? 'bg-rose-500/20 text-rose-700 dark:text-rose-300 border-rose-500/40'
                            : 'bg-primary text-primary-foreground border-primary'
                          : 'border-border bg-background hover:bg-muted text-muted-foreground'
                      }`}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              </fieldset>
            </div>

            <div>
              <label htmlFor="sim-diff" className="block font-medium text-foreground mb-1">
                {t('app.agentGate.diffLabel')}
              </label>
              <textarea id="sim-diff" rows={5} value={simDiffJson} onChange={(e) => setSimDiffJson(e.target.value)} className={`${inputClass} font-mono text-xs`} spellCheck={false} />
            </div>

            <button
              type="submit"
              disabled={submitProposalMutation.isPending}
              className="w-full py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold hover:bg-primary/90 flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
            >
              {submitProposalMutation.isPending ? (
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
              ) : (
                <ShieldCheck className="size-4" aria-hidden="true" />
              )}
              <span>{t('app.agentGate.submit')}</span>
            </button>
          </form>
        </div>
      )}

      {issuedTokenInfo && (
        <Dialog labelledBy="token-dialog-title" describedBy="token-dialog-body" onClose={() => setIssuedTokenInfo(null)}>
          <div className="flex items-center gap-3 text-emerald-600">
            <KeyRound className="size-6" aria-hidden="true" />
            <h2 id="token-dialog-title" className="text-base font-semibold text-foreground">
              {t('app.agentGate.tokenTitle')}
            </h2>
          </div>
          <p id="token-dialog-body" className="text-sm text-muted-foreground">
            {t('app.agentGate.tokenBody')}
          </p>
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('app.agentGate.tokenLabel')}</span>
            <div className="p-3 rounded-lg bg-background border border-border font-mono text-xs break-all select-all text-primary">{issuedTokenInfo.token}</div>
          </div>
          <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(issuedTokenInfo.token).then(() => setTokenCopied(true)).catch(() => undefined);
              }}
              className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-sm font-semibold flex items-center justify-center gap-1.5"
            >
              <Copy className="size-3.5" aria-hidden="true" />
              <span>{tokenCopied ? t('app.agentGate.copied') : t('app.agentGate.copyToken')}</span>
            </button>
            <button type="button" onClick={() => setIssuedTokenInfo(null)} className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90">
              {t('app.agentGate.done')}
            </button>
          </div>
        </Dialog>
      )}

      {showNewAgentModal && (
        <Dialog labelledBy="register-agent-title" onClose={() => setShowNewAgentModal(false)} className="max-w-md">
          <h2 id="register-agent-title" className="text-base font-semibold text-foreground flex items-center gap-2">
            <Bot className="size-5 text-primary" aria-hidden="true" />
            <span>{t('app.agentGate.registerTitle')}</span>
          </h2>
          {registerAgentMutation.isError && (
            <div role="alert" className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-300 text-sm">
              {errText(registerAgentMutation.error, t('app.agentGate.registerFailed'))}
            </div>
          )}
          <form onSubmit={handleRegisterAgentSubmit} className="space-y-4 text-sm">
            <div>
              <label htmlFor="agent-name" className="block font-medium text-foreground mb-1">
                {t('app.agentGate.agentName')}
              </label>
              <input
                id="agent-name"
                type="text"
                required
                placeholder={t('app.agentGate.agentNamePlaceholder')}
                value={agentName}
                onChange={(e) => setAgentName(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="agent-runtime" className="block font-medium text-foreground mb-1">
                {t('app.agentGate.runtimeLabel')}
              </label>
              <select id="agent-runtime" value={agentRuntime} onChange={(e) => setAgentRuntime(e.target.value)} className={inputClass}>
                {RUNTIMES.map((r) => (
                  <option key={r} value={r}>
                    {t(`app.agentGate.runtimes.${r}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="agent-risk" className="block font-medium text-foreground mb-1">
                {t('app.agentGate.maxRiskLabel')}
              </label>
              <select id="agent-risk" value={agentMaxRisk} onChange={(e) => setAgentMaxRisk(e.target.value)} className={inputClass}>
                {RISKS.map((r) => (
                  <option key={r} value={r}>
                    {t(`app.agentGate.risks.${r}`)}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowNewAgentModal(false)}
                className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-sm font-semibold"
              >
                {t('app.ui.cancel')}
              </button>
              <button
                type="submit"
                disabled={registerAgentMutation.isPending}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-50"
              >
                {t('app.agentGate.register')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
