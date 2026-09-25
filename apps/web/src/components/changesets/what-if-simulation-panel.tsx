'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  Play,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldCheck,
  FileCode,
  ArrowRight,
  Plus,
  Loader2,
  Copy,
  Layers,
  Sparkles,
  Info,
  Clock,
  KeyRound,
} from 'lucide-react';
import {
  fetchChangeSets,
  createChangeSet,
  simulateChangeSet,
  approveChangeSet,
  ChangeSetItem,
} from '@/lib/api-client';

interface WhatIfSimulationPanelProps {
  projectId: string;
}

export function WhatIfSimulationPanel({ projectId }: WhatIfSimulationPanelProps) {
  const queryClient = useQueryClient();
  const [selectedChangesetId, setSelectedChangesetId] = useState<string | null>(null);

  // New ChangeSet Modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [targetEnv, setTargetEnv] = useState('QA');
  const [changeType, setChangeType] = useState('REMOVE_CUSTOM_FIELD');
  const [targetObject, setTargetObject] = useState('YY1_CLASS');

  // Approval Modal
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approvalReason, setApprovalReason] = useState('');
  const [evidencePack, setEvidencePack] = useState<any | null>(null);

  // Queries
  const { data: changesets = [], isLoading, isError } = useQuery({
    queryKey: ['changesets', projectId],
    queryFn: () => fetchChangeSets(projectId),
    enabled: Boolean(projectId),
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (payload: any) => createChangeSet(projectId, payload),
    onSuccess: (newCs) => {
      queryClient.invalidateQueries({ queryKey: ['changesets', projectId] });
      setShowCreateModal(false);
      setName('');
      setDescription('');
      setSelectedChangesetId(newCs.id);
    },
  });

  const simulateMutation = useMutation({
    mutationFn: (csId: string) => simulateChangeSet(projectId, csId),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ['changesets', projectId] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ csId, reason }: { csId: string; reason: string }) =>
      approveChangeSet(projectId, csId, reason),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['changesets', projectId] });
      setShowApproveModal(false);
      setEvidencePack(data.evidencePack);
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    createMutation.mutate({
      name: name.trim(),
      description: description.trim(),
      targetEnvironment: targetEnv,
      proposedChanges: [
        {
          type: changeType,
          targetObject: targetObject.trim(),
          details: { requestedBy: 'Solution Architect' },
        },
      ],
    });
  };

  const handleApproveSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedChangesetId || !approvalReason.trim()) return;

    approveMutation.mutate({
      csId: selectedChangesetId,
      reason: approvalReason.trim(),
    });
  };

  const selectedChangeset = changesets.find((c) => c.id === selectedChangesetId) || changesets[0];
  const simResult = selectedChangeset?.simulation_result
    ? typeof selectedChangeset.simulation_result === 'string'
      ? JSON.parse(selectedChangeset.simulation_result)
      : selectedChangeset.simulation_result
    : null;

  if (isLoading) {
    return (
      <div className="p-12 text-center text-muted-foreground flex items-center justify-center gap-2 text-sm">
        <Loader2 className="size-4 animate-spin" />
        <span>Loading What-If Simulation Workspace...</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center text-destructive border border-destructive/20 rounded-xl bg-destructive/5 text-sm">
        Failed to load change simulation models.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card border border-border rounded-xl p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-wider">
            <GitBranch className="size-4" />
            <span>What-If Simulation Engine • Part 16.2</span>
          </div>
          <h2 className="text-xl font-bold tracking-tight text-foreground mt-1">
            Change Impact & Extensibility Simulation Workspace
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Simulate the blast radius of removing custom fields, altering OPD determination rules,
            or migrating APIs against the project digital baseline before touching any SAP system.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm shrink-0"
        >
          <Plus className="size-4" />
          <span>New ChangeSet</span>
        </button>
      </div>

      {changesets.length === 0 ? (
        <div className="border border-dashed border-border rounded-xl p-12 text-center space-y-3">
          <GitBranch className="size-8 mx-auto text-muted-foreground/60" />
          <h3 className="text-sm font-semibold text-foreground">No ChangeSets Configured</h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            Create a ChangeSet to simulate prospective Clean Core modifications, custom field removals,
            or transport splits without modifying your live SAP landscape.
          </p>
          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <Plus className="size-3.5" />
            <span>Create First ChangeSet</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: ChangeSets List */}
          <div className="lg:col-span-1 space-y-3">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Configured ChangeSets ({changesets.length})
            </h3>
            <div className="space-y-2">
              {changesets.map((cs) => {
                const isSelected = cs.id === (selectedChangeset?.id);
                const hasSim = Boolean(cs.simulation_result && Object.keys(cs.simulation_result).length > 0);

                return (
                  <div
                    key={cs.id}
                    onClick={() => setSelectedChangesetId(cs.id)}
                    className={`p-3.5 rounded-xl border text-xs cursor-pointer transition-all ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-border bg-card hover:border-border/80'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-foreground truncate">{cs.name}</span>
                      <span
                        className={`px-2 py-0.5 text-[10px] font-semibold rounded shrink-0 ${
                          cs.approval_status === 'APPROVED'
                            ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                            : hasSim
                            ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {cs.approval_status}
                      </span>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                      <span>Target: {cs.target_environment}</span>
                      <span>Release: {cs.target_release}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right Column: Simulation Workbench */}
          {selectedChangeset && (
            <div className="lg:col-span-2 space-y-4">
              <div className="border border-border rounded-xl bg-card p-5 space-y-5 shadow-sm">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border pb-4">
                  <div>
                    <h3 className="font-semibold text-foreground text-base">
                      {selectedChangeset.name}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {selectedChangeset.description || 'No description specified.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => simulateMutation.mutate(selectedChangeset.id)}
                      disabled={simulateMutation.isPending}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-all shadow-sm disabled:opacity-50"
                    >
                      {simulateMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      <span>Run Simulation</span>
                    </button>

                    {simResult && selectedChangeset.approval_status !== 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => setShowApproveModal(true)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white transition-all shadow-sm"
                      >
                        <ShieldCheck className="size-3.5" />
                        <span>Approve Change</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Simulation Output */}
                {!simResult ? (
                  <div className="py-12 text-center space-y-2">
                    <GitBranch className="size-8 mx-auto text-muted-foreground/40" />
                    <p className="text-xs text-muted-foreground">
                      Click <strong className="text-foreground">Run Simulation</strong> to calculate the deterministic blast radius against the project baseline.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-5 text-xs">
                    {/* Top KPI Cards */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="p-3 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                          Verdict
                        </span>
                        <div className="mt-1 flex items-center gap-1 font-semibold text-foreground">
                          {simResult.verdict === 'CLEAR' ? (
                            <CheckCircle2 className="size-3.5 text-emerald-500" />
                          ) : simResult.verdict === 'BLOCKED' ? (
                            <XCircle className="size-3.5 text-rose-500" />
                          ) : (
                            <AlertTriangle className="size-3.5 text-amber-500" />
                          )}
                          <span>{simResult.verdict}</span>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                          Risk Delta
                        </span>
                        <div className="mt-1 font-semibold text-foreground">
                          {simResult.riskDelta}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                          New Findings
                        </span>
                        <div className="mt-1 font-semibold text-rose-500">
                          +{simResult.newFindings?.length || 0}
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-muted/30 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase font-semibold">
                          Resolved
                        </span>
                        <div className="mt-1 font-semibold text-emerald-500">
                          {simResult.resolvedFindings?.length || 0}
                        </div>
                      </div>
                    </div>

                    {/* Blast Radius Impacted Objects */}
                    <div>
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Impacted Blast Radius Objects ({simResult.blastRadiusObjects?.length || 0})
                      </span>
                      <div className="mt-2 space-y-1.5">
                        {simResult.blastRadiusObjects?.map((obj: any, idx: number) => (
                          <div
                            key={idx}
                            className="p-2.5 rounded-lg border border-border bg-background flex items-center justify-between"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium text-foreground text-[11px]">
                                {obj.name}
                              </span>
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-muted text-muted-foreground">
                                {obj.type}
                              </span>
                            </div>
                            <span className="text-[10px] font-mono text-amber-500">
                              {obj.impact}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Newly Introduced Findings */}
                    {simResult.newFindings && simResult.newFindings.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Prospective Regressions Detected
                        </span>
                        <div className="mt-2 space-y-2">
                          {simResult.newFindings.map((f: any, idx: number) => (
                            <div
                              key={idx}
                              className="p-3 rounded-lg border border-rose-500/20 bg-rose-500/5 space-y-1 text-xs"
                            >
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-rose-500/20 text-rose-400">
                                  {f.severity}
                                </span>
                                <span className="font-mono text-[11px] text-foreground font-semibold">
                                  {f.ruleId}
                                </span>
                              </div>
                              <p className="text-foreground text-xs mt-1 font-medium">{f.title}</p>
                              <p className="text-muted-foreground text-[11px]">{f.description}</p>
                              <div className="mt-2 p-2 rounded bg-background border border-border text-[11px] text-emerald-400">
                                <strong>Remediation:</strong> {f.remediation}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Required Automated Regression Tests */}
                    {simResult.requiredTests && simResult.requiredTests.length > 0 && (
                      <div>
                        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                          Mandatory Regression Tests Generated
                        </span>
                        <ul className="mt-1.5 list-disc list-inside space-y-1 text-muted-foreground">
                          {simResult.requiredTests.map((t: any, idx: number) => (
                            <li key={idx}>
                              <span className="text-foreground font-medium">{t.title}</span> ({t.type})
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* New ChangeSet Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <GitBranch className="size-5 text-primary" />
              <span>Create Proposed ChangeSet</span>
            </h3>

            <form onSubmit={handleCreateSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-foreground mb-1">ChangeSet Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Unpublish YY1_CLASS from Core Logistics"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
              </div>

              <div>
                <label className="block font-medium text-foreground mb-1">Business Rationale</label>
                <textarea
                  rows={2}
                  placeholder="Explain why this change is proposed..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-medium text-foreground mb-1">Change Type</label>
                  <select
                    value={changeType}
                    onChange={(e) => setChangeType(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                  >
                    <option value="REMOVE_CUSTOM_FIELD">REMOVE_CUSTOM_FIELD</option>
                    <option value="MODIFY_OPD_RULE">MODIFY_OPD_RULE</option>
                    <option value="MIGRATE_API_VERSION">MIGRATE_API_VERSION</option>
                  </select>
                </div>

                <div>
                  <label className="block font-medium text-foreground mb-1">Target Object</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. YY1_CLASS"
                    value={targetObject}
                    onChange={(e) => setTargetObject(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve ChangeSet Modal */}
      {showApproveModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-md w-full space-y-4 shadow-xl">
            <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
              <ShieldCheck className="size-5 text-emerald-500" />
              <span>Approve ChangeSet & Issue Evidence Pack</span>
            </h3>

            <p className="text-xs text-muted-foreground">
              Approval issues a signed Change Evidence Pack verifying that the blast radius
              has been simulated and accepted by an authorized architect.
            </p>

            <form onSubmit={handleApproveSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-medium text-foreground mb-1">
                  Architect Approval Justification
                </label>
                <textarea
                  rows={3}
                  required
                  placeholder="e.g. Broken Adobe Form bindings verified and will be refactored concurrently."
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary text-xs"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowApproveModal(false)}
                  className="px-3 py-1.5 rounded-lg border border-border bg-background hover:bg-muted text-foreground text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={approveMutation.isPending}
                  className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-50"
                >
                  Approve Change
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Signed Evidence Pack Modal */}
      {evidencePack && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-card border border-border rounded-xl p-6 max-w-lg w-full space-y-4 shadow-xl">
            <div className="flex items-center gap-3 text-emerald-500">
              <ShieldCheck className="size-6" />
              <h3 className="text-base font-semibold text-foreground">
                Signed Change Evidence Pack Issued
              </h3>
            </div>

            <p className="text-xs text-muted-foreground">
              A cryptographic certificate has been generated and persisted for audit defense.
            </p>

            <div className="space-y-2 text-xs">
              <div>
                <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                  Audit Certificate Hash (SHA-256)
                </span>
                <div className="p-2 rounded bg-background border border-border font-mono text-[11px] break-all select-all text-primary">
                  {evidencePack.auditCertificate}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 text-muted-foreground pt-1">
                <div>
                  <span>Approved At:</span>{' '}
                  <span className="text-foreground font-mono font-medium">
                    {new Date(evidencePack.approvedAt).toLocaleString()}
                  </span>
                </div>
                <div>
                  <span>Target Environment:</span>{' '}
                  <span className="text-foreground font-mono font-medium">
                    {evidencePack.targetEnvironment}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEvidencePack(null)}
                className="px-4 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
