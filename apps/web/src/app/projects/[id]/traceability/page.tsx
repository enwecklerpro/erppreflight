'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, GitMerge, Layers, ListChecks, RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  fetchCloudAlmProjects,
  fetchConnectors,
  fetchProjectLinks,
  fetchTraceability,
  importRequirements,
  linkProjectToCloudAlm,
} from '@/lib/api/integrations';
import { exportRawData } from '@/lib/export';
import { Button, PanelEmpty, PanelLoading, RemediationBadge } from '@/components/integrations/ui';
import { useErrorText, useFmt, useRichT, useT } from '@/i18n/client';
import { SeverityBadge } from '@/components/findings/severity-badge';

function Kpi({ label, value, hint, icon: Icon, tone }: { label: string; value: React.ReactNode; hint: string; icon: React.ElementType; tone: string }) {
  return (
    <div className={`rounded-xl border bg-card p-4 ${tone}`}>
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
        <Icon className="size-3.5" aria-hidden="true" /> {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function LoadError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const errText = useErrorText();
  return (
    <div role="alert" className="flex flex-col justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm sm:flex-row sm:items-center">
      <div className="flex items-start gap-2 text-destructive">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold">{t('app.traceability.loadError')}</p>
          <p className="opacity-90">{errText(error, t('app.traceability.unexpected'))}</p>
        </div>
      </div>
      <Button variant="secondary" onClick={onRetry}>
        <RefreshCw className="size-3.5" aria-hidden="true" /> {t('app.traceability.retry')}
      </Button>
    </div>
  );
}

/** Cloud ALM project mapping + requirements import (pull). */
function CloudAlmImport({ projectId }: { projectId: string }) {
  const t = useT();
  const rt = useRichT();
  const errText = useErrorText();
  const qc = useQueryClient();
  const connectors = useQuery({ queryKey: ['integrations', 'connectors'], queryFn: fetchConnectors });
  const calm = (connectors.data ?? []).filter((c) => c.type === 'SAP_CLOUD_ALM' && c.status === 'ACTIVE');
  const [connectorId, setConnectorId] = React.useState('');
  const selected = calm.find((c) => c.id === connectorId) ?? calm[0];
  const links = useQuery({ queryKey: ['integrations', 'project-links', selected?.id], queryFn: () => fetchProjectLinks(selected!.id), enabled: Boolean(selected) });
  const link = links.data?.find((l) => l.projectId === projectId);
  const remoteProjects = useQuery({ queryKey: ['integrations', 'calm-projects', selected?.id], queryFn: () => fetchCloudAlmProjects(selected!.id), enabled: Boolean(selected) && !link });
  const [remote, setRemote] = React.useState('');
  const mapProject = useMutation({
    mutationFn: () => linkProjectToCloudAlm(selected!.id, projectId, remote || remoteProjects.data![0].id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations', 'project-links', selected?.id] }),
  });
  const run = useMutation({
    mutationFn: () => importRequirements(projectId, selected!.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects', projectId, 'traceability'] }),
  });

  if (connectors.isLoading) return <PanelLoading rows={1} label={t('app.traceability.loadingConnectors')} />;
  if (!calm.length) {
    return (
      <p className="text-sm text-muted-foreground">
        {rt('app.traceability.noCalmRich', {
          link: (c) => (
            <Link href="/integrations?tab=connectors" className="text-primary hover:underline">
              {c}
            </Link>
          ),
        })}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="calm-conn" className="sr-only">{t('app.traceability.connector')}</label>
      <select id="calm-conn" value={selected?.id} onChange={(e) => setConnectorId(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
        {calm.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {link ? (
        <>
          <span className="text-muted-foreground">
            {rt('app.traceability.mappedRich', {
              project: link.externalProjectId,
              direction: link.syncDirection,
              code: (c) => <code className="font-mono">{c}</code>,
            })}
          </span>
          <Button onClick={() => run.mutate()} busy={run.isPending}>
            <GitMerge className="size-3.5" aria-hidden="true" /> {t('app.traceability.import')}
          </Button>
        </>
      ) : remoteProjects.isLoading ? (
        <span className="text-muted-foreground">{t('app.traceability.loadingProjects')}</span>
      ) : remoteProjects.isError ? (
        <span className="text-destructive">{errText(remoteProjects.error, t('app.traceability.unexpected'))}</span>
      ) : (
        <>
          <label htmlFor="calm-project" className="sr-only">{t('app.traceability.remoteProject')}</label>
          <select id="calm-project" value={remote} onChange={(e) => setRemote(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
            {(remoteProjects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => mapProject.mutate()} busy={mapProject.isPending} disabled={!remoteProjects.data?.length}>
            {t('app.traceability.mapProject')}
          </Button>
        </>
      )}
      {run.isSuccess && (
        <span role="status" className="text-muted-foreground">
          {t('app.traceability.imported', { imported: run.data.imported, created: run.data.created, updated: run.data.updated })}
        </span>
      )}
      {(run.isError || mapProject.isError) && (
        <span role="alert" className="text-destructive">{errText(run.error ?? mapProject.error, t('app.traceability.unexpected'))}</span>
      )}
    </div>
  );
}

export default function TraceabilityMatrixPage() {
  const t = useT();
  const fmt = useFmt();
  const params = useParams();
  const projectId = params.id as string;
  const q = useQuery({ queryKey: ['projects', projectId, 'traceability'], queryFn: () => fetchTraceability(projectId) });
  const data = q.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <Layers className="size-3.5" aria-hidden="true" /> {t('app.traceability.badge')}
          </p>
          <h1 className="text-2xl font-bold text-foreground">{t('app.traceability.title')}</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t('app.traceability.intro')}</p>
        </div>
        <Button
          variant="secondary"
          disabled={!data?.nodes?.length}
          onClick={() =>
            exportRawData((data?.nodes ?? []) as unknown as Record<string, unknown>[], 'csv', `traceability-matrix-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`)
          }
        >
          <Download className="size-3.5" aria-hidden="true" /> {t('app.traceability.exportCsv')}
        </Button>
      </header>

      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold">{t('app.traceability.sourceTitle')}</h2>
        <CloudAlmImport projectId={projectId} />
      </section>

      {q.isLoading ? (
        <PanelLoading rows={4} label={t('app.traceability.loading')} />
      ) : q.isError ? (
        <LoadError error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi
              label={t('app.traceability.kpi.requirements')}
              value={fmt.number(data!.summary.totalRequirements)}
              hint={t('app.traceability.kpi.requirementsHint', { count: data!.summary.requirementsWithFindings })}
              icon={ListChecks}
              tone="border-border"
            />
            <Kpi
              label={t('app.traceability.kpi.criticals')}
              value={fmt.number(data!.summary.criticalFindingsWithoutTasks)}
              hint={t('app.traceability.kpi.criticalsHint', { count: data!.summary.criticalFindingsInLatestRun })}
              icon={AlertTriangle}
              tone="border-rose-500/30"
            />
            <Kpi
              label={t('app.traceability.kpi.untested')}
              value={fmt.number(data!.summary.requirementsWithoutTests)}
              hint={t('app.traceability.kpi.untestedHint')}
              icon={ShieldAlert}
              tone="border-amber-500/30"
            />
            <Kpi
              label={t('app.traceability.kpi.verified')}
              value={data!.summary.remediationVerifiedPercent === null ? '—' : fmt.percent(data!.summary.remediationVerifiedPercent / 100)}
              hint={t('app.traceability.kpi.verifiedHint', {
                pending: data!.summary.workItemsPendingVerification,
                conflicts: data!.summary.workItemsInConflict,
              })}
              icon={ShieldCheck}
              tone="border-emerald-500/30"
            />
          </div>

          {!data!.nodes.length ? (
            <PanelEmpty
              icon={Layers}
              title={t('app.traceability.emptyTitle')}
              body={t('app.traceability.emptyBody')}
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full min-w-[900px] text-left text-sm">
                <caption className="sr-only">{t('app.traceability.caption')}</caption>
                <thead className="text-xs text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th scope="col" className="p-3">{t('app.traceability.col.process')}</th>
                    <th scope="col" className="p-3">{t('app.traceability.col.requirement')}</th>
                    <th scope="col" className="p-3">{t('app.traceability.col.finding')}</th>
                    <th scope="col" className="p-3">{t('app.traceability.col.workItem')}</th>
                    <th scope="col" className="p-3">{t('app.traceability.col.test')}</th>
                    <th scope="col" className="p-3">{t('app.traceability.col.transport')}</th>
                    <th scope="col" className="p-3">{t('app.traceability.col.release')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data!.nodes.map((n) => {
                    const wi = data!.workItems.find((w) => w.findingId && w.findingId === n.findingId);
                    return (
                      <tr key={n.id} className="border-t border-border align-top">
                        <td className="p-3">{n.processHierarchy}</td>
                        <td className="p-3">
                          <p className="font-mono font-semibold">{n.requirementId}</p>
                          <p className="text-muted-foreground max-w-[16rem]">{n.requirementTitle}</p>
                        </td>
                        <td className="p-3">
                          {n.findingId ? (
                            <div className="space-y-1">
                              {n.findingSeverity && <SeverityBadge severity={n.findingSeverity as any} />}
                              <p className="font-mono">{n.findingRuleId}</p>
                              <p className="text-muted-foreground max-w-[16rem]">{n.findingTitle}</p>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{t('app.traceability.noFinding')}</span>
                          )}
                        </td>
                        <td className="p-3">
                          {wi ? (
                            <div className="space-y-1">
                              {wi.externalUrl ? (
                                <a href={wi.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                                  {wi.externalKey ?? wi.externalId} <ExternalLink className="size-3" aria-hidden="true" />
                                  <span className="sr-only">{t('app.traceability.newTab')}</span>
                                </a>
                              ) : (
                                <span className="font-mono">{wi.externalKey ?? wi.externalId}</span>
                              )}
                              <RemediationBadge state={wi.remediationState} />
                            </div>
                          ) : n.remediationTaskId ? (
                            <span className="font-mono">{n.remediationTaskId} ({n.taskStatus})</span>
                          ) : n.findingId ? (
                            <Link href={`/projects/${projectId}/findings?id=${n.findingId}`} className="text-primary hover:underline">{t('app.traceability.createFromFinding')}</Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-3">{n.testCaseId ? `${n.testTitle ?? n.testCaseId} (${n.testStatus})` : <span className="text-muted-foreground">{t('app.traceability.noTest')}</span>}</td>
                        <td className="p-3 font-mono">{n.transportId ?? '—'}</td>
                        <td className="p-3 font-mono">{n.releaseId}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
