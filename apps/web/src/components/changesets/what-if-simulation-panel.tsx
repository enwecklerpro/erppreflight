'use client';

import { RuleRemediation, RuleTitle } from '@/components/findings/rule-text';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Play, CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Plus, Loader2, RefreshCw } from 'lucide-react';
import { fetchChangeSets, simulateChangeSet, type ChangeSetItem } from '@/lib/api-client';
import { useErrorText, useLabel, useT } from '@/i18n/client';
import {
  ApproveChangeSetDialog,
  CreateChangeSetDialog,
  EvidencePackDialog,
  type ChangeEvidencePack,
} from './change-set-dialogs';

interface WhatIfSimulationPanelProps {
  projectId: string;
}

type SimulationResult = NonNullable<ChangeSetItem['simulation_result']>;

function parseSimulation(cs: ChangeSetItem | undefined): SimulationResult | null {
  const raw = cs?.simulation_result as unknown;
  if (!raw) return null;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as SimulationResult;
    } catch {
      return null;
    }
  }
  return Object.keys(raw as object).length > 0 ? (raw as SimulationResult) : null;
}

function VerdictIcon({ verdict }: { verdict: string }) {
  if (verdict === 'CLEAR') return <CheckCircle2 className="size-3.5 text-emerald-600" aria-hidden="true" />;
  if (verdict === 'BLOCKED') return <XCircle className="size-3.5 text-rose-600" aria-hidden="true" />;
  return <AlertTriangle className="size-3.5 text-amber-600" aria-hidden="true" />;
}

export function WhatIfSimulationPanel({ projectId }: WhatIfSimulationPanelProps) {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const [selectedChangesetId, setSelectedChangesetId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showApprove, setShowApprove] = useState(false);
  const [evidencePack, setEvidencePack] = useState<ChangeEvidencePack | null>(null);

  const { data: changesets = [], isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['changesets', projectId],
    queryFn: () => fetchChangeSets(projectId),
    enabled: Boolean(projectId),
  });

  const simulateMutation = useMutation({
    mutationFn: (csId: string) => simulateChangeSet(projectId, csId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['changesets', projectId] }),
  });

  const selectedChangeset = changesets.find((c) => c.id === selectedChangesetId) || changesets[0];
  const simResult = parseSimulation(selectedChangeset);

  if (isLoading) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 p-12 text-center text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        <span>{t('app.changesets.loading')}</span>
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 p-8 text-center text-sm text-destructive">
        <span>{t('app.changesets.loadError')}</span>
        <button
          type="button"
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/40 px-3 py-1.5 font-semibold hover:bg-destructive/10"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" /> {t('app.changesets.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-card p-5 shadow-sm md:flex-row md:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <GitBranch className="size-4" aria-hidden="true" />
            <span>{t('app.changesets.badge')}</span>
          </div>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">{t('app.changesets.panelTitle')}</h2>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t('app.changesets.panelIntro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
        >
          <Plus className="size-4" aria-hidden="true" />
          <span>{t('app.changesets.newChangeSet')}</span>
        </button>
      </div>

      {changesets.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-dashed border-border p-12 text-center">
          <GitBranch className="mx-auto size-8 text-muted-foreground/60" aria-hidden="true" />
          <h3 className="text-sm font-semibold text-foreground">{t('app.changesets.emptyTitle')}</h3>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">{t('app.changesets.emptyBody')}</p>
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="mt-2 inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Plus className="size-3.5" aria-hidden="true" />
            <span>{t('app.changesets.createFirst')}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3 lg:col-span-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('app.changesets.listTitle', { count: changesets.length })}
            </h3>
            <ul className="space-y-2" aria-label={t('app.changesets.listLabel')}>
              {changesets.map((cs) => {
                const isSelected = cs.id === selectedChangeset?.id;
                const hasSim = parseSimulation(cs) !== null;
                return (
                  <li key={cs.id}>
                    <button
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => setSelectedChangesetId(cs.id)}
                      className={`w-full rounded-xl border p-3.5 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                        isSelected ? 'border-primary bg-primary/5 shadow-sm' : 'border-border bg-card hover:border-primary/40'
                      }`}
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="truncate font-semibold text-foreground">{cs.name}</span>
                        <span
                          className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${
                            cs.approval_status === 'APPROVED'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                              : hasSim
                              ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                              : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          {label('app.changesets.status', cs.approval_status)}
                        </span>
                      </span>
                      <span className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>{t('app.changesets.targetEnv', { env: cs.target_environment })}</span>
                        <span>{t('app.changesets.release', { release: cs.target_release })}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {selectedChangeset && (
            <div className="space-y-4 lg:col-span-2">
              <div className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-center">
                  <div className="min-w-0">
                    <h3 className="break-words text-base font-semibold text-foreground">{selectedChangeset.name}</h3>
                    <p className="mt-0.5 text-sm text-muted-foreground">{selectedChangeset.description || t('app.changesets.noDescription')}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => simulateMutation.mutate(selectedChangeset.id)}
                      disabled={simulateMutation.isPending}
                      className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {simulateMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                      ) : (
                        <Play className="size-3.5" aria-hidden="true" />
                      )}
                      <span>{simulateMutation.isPending ? t('app.changesets.running') : t('app.changesets.run')}</span>
                    </button>
                    {simResult && selectedChangeset.approval_status !== 'APPROVED' && (
                      <button
                        type="button"
                        onClick={() => setShowApprove(true)}
                        className="inline-flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-emerald-700"
                      >
                        <ShieldCheck className="size-3.5" aria-hidden="true" />
                        <span>{t('app.changesets.approve.open')}</span>
                      </button>
                    )}
                  </div>
                </div>

                {simulateMutation.isError && (
                  <p role="alert" className="text-sm text-destructive">
                    {errText(simulateMutation.error, t('app.changesets.simulateFailed'))}
                  </p>
                )}

                {!simResult ? (
                  <div className="space-y-2 py-12 text-center">
                    <GitBranch className="mx-auto size-8 text-muted-foreground/40" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">{t('app.changesets.runHint')}</p>
                  </div>
                ) : (
                  <div className="space-y-5 text-sm">
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">{t('app.changesets.verdictLabel')}</dt>
                        <dd className="mt-1 flex items-center gap-1 font-semibold text-foreground">
                          <VerdictIcon verdict={simResult.verdict} />
                          <span>{label('app.changesets.verdict', simResult.verdict)}</span>
                        </dd>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">{t('app.changesets.riskDeltaLabel')}</dt>
                        <dd className="mt-1 font-semibold text-foreground">{label('app.changesets.riskDelta', simResult.riskDelta)}</dd>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">{t('app.changesets.newFindings')}</dt>
                        <dd className="mt-1 font-semibold text-rose-700 dark:text-rose-400">+{simResult.newFindings?.length || 0}</dd>
                      </div>
                      <div className="rounded-lg border border-border bg-muted/30 p-3">
                        <dt className="text-xs font-semibold uppercase text-muted-foreground">{t('app.changesets.resolved')}</dt>
                        <dd className="mt-1 font-semibold text-emerald-700 dark:text-emerald-400">{simResult.resolvedFindings?.length || 0}</dd>
                      </div>
                    </dl>

                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('app.changesets.impactedTitle', { count: simResult.blastRadiusObjects?.length || 0 })}
                      </h4>
                      <ul className="mt-2 space-y-1.5">
                        {simResult.blastRadiusObjects?.map((obj, idx) => (
                          <li key={idx} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-background p-2.5">
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs font-medium text-foreground">{obj.name}</span>
                              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-muted-foreground">{obj.type}</span>
                            </span>
                            <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{label('app.changesets.impact', obj.impact)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {simResult.newFindings && simResult.newFindings.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                          {t('app.changesets.regressionsTitle', { count: simResult.newFindings.length })}
                        </h4>
                        <ul className="mt-2 space-y-2">
                          {simResult.newFindings.map((f, idx) => (
                            <li key={idx} className="space-y-1 rounded-lg border border-rose-500/20 bg-rose-500/5 p-3">
                              <span className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-rose-500/20 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300">{f.severity}</span>
                                <span className="font-mono text-xs font-semibold text-foreground">{f.ruleId}</span>
                              </span>
                              <p className="mt-1 text-sm font-medium text-foreground"><RuleTitle ruleId={f.ruleId} title={f.title} /></p>
                              {'description' in f && typeof (f as { description?: unknown }).description === 'string' && (
                                <p className="text-sm text-muted-foreground">{(f as { description: string }).description}</p>
                              )}
                              <p className="mt-2 rounded border border-border bg-background p-2 text-sm text-foreground">
                                <strong>{t('app.changesets.remediation')}</strong> <RuleRemediation ruleId={f.ruleId} title={f.title} remediation={f.remediation} />
                              </p>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {simResult.requiredTests && simResult.requiredTests.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t('app.changesets.testsTitle')}</h4>
                        <ul className="mt-1.5 list-inside list-disc space-y-1 text-muted-foreground">
                          {simResult.requiredTests.map((test, idx) => (
                            <li key={idx}>
                              <span className="font-medium text-foreground">{test.title}</span> ({test.type})
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

      {showCreate && (
        <CreateChangeSetDialog
          projectId={projectId}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            queryClient.invalidateQueries({ queryKey: ['changesets', projectId] });
            setShowCreate(false);
            setSelectedChangesetId(created.id);
          }}
        />
      )}

      {showApprove && selectedChangeset && (
        <ApproveChangeSetDialog
          projectId={projectId}
          changeSetId={selectedChangeset.id}
          onClose={() => setShowApprove(false)}
          onApproved={(res) => {
            queryClient.invalidateQueries({ queryKey: ['changesets', projectId] });
            setShowApprove(false);
            setEvidencePack(res.evidencePack ?? null);
          }}
        />
      )}

      {evidencePack && <EvidencePackDialog pack={evidencePack} onClose={() => setEvidencePack(null)} />}
    </div>
  );
}
