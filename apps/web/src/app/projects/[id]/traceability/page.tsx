'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Download, ExternalLink, GitMerge, Layers, ListChecks, ShieldAlert, ShieldCheck } from 'lucide-react';
import {
  fetchCloudAlmProjects,
  fetchConnectors,
  fetchProjectLinks,
  fetchTraceability,
  importRequirements,
  linkProjectToCloudAlm,
} from '@/lib/api/integrations';
import { exportRawData } from '@/lib/export';
import { Button, PanelEmpty, PanelError, PanelLoading, RemediationBadge, errorMessage } from '@/components/integrations/ui';
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

/** Cloud ALM project mapping + requirements import (pull). */
function CloudAlmImport({ projectId }: { projectId: string }) {
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

  if (connectors.isLoading) return <PanelLoading rows={1} label="Loading connectors" />;
  if (!calm.length) {
    return (
      <p className="text-xs text-muted-foreground">
        Requirements come from SAP Cloud ALM.{' '}
        <Link href="/integrations?tab=connectors" className="text-primary hover:underline">
          Connect Cloud ALM
        </Link>{' '}
        to import them.
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label htmlFor="calm-conn" className="sr-only">Cloud ALM connector</label>
      <select id="calm-conn" value={selected?.id} onChange={(e) => setConnectorId(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
        {calm.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
      {link ? (
        <>
          <span className="text-muted-foreground">mapped to Cloud ALM project <code className="font-mono">{link.externalProjectId}</code> ({link.syncDirection})</span>
          <Button onClick={() => run.mutate()} busy={run.isPending}>
            <GitMerge className="size-3.5" aria-hidden="true" /> Import requirements
          </Button>
        </>
      ) : remoteProjects.isLoading ? (
        <span className="text-muted-foreground">Loading Cloud ALM projects…</span>
      ) : remoteProjects.isError ? (
        <span className="text-destructive">{errorMessage(remoteProjects.error)}</span>
      ) : (
        <>
          <label htmlFor="calm-project" className="sr-only">Cloud ALM project</label>
          <select id="calm-project" value={remote} onChange={(e) => setRemote(e.target.value)} className="rounded border border-border bg-background px-2 py-1">
            {(remoteProjects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <Button variant="secondary" onClick={() => mapProject.mutate()} busy={mapProject.isPending} disabled={!remoteProjects.data?.length}>
            Map project
          </Button>
        </>
      )}
      {run.isSuccess && <span role="status" className="text-muted-foreground">Imported {run.data.imported} requirement(s): {run.data.created} new, {run.data.updated} updated.</span>}
      {(run.isError || mapProject.isError) && <span role="alert" className="text-destructive">{errorMessage(run.error ?? mapProject.error)}</span>}
    </div>
  );
}

export default function TraceabilityMatrixPage() {
  const params = useParams();
  const projectId = params.id as string;
  const q = useQuery({ queryKey: ['projects', projectId, 'traceability'], queryFn: () => fetchTraceability(projectId) });
  const data = q.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <p className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-primary">
            <Layers className="size-3.5" aria-hidden="true" /> Delivery traceability
          </p>
          <h1 className="text-2xl font-bold text-foreground">Traceability matrix</h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Business process → requirement (SAP Cloud ALM) → preflight finding → remediation work item → test → transport → release. Built only from imported and
            recorded data.
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={!data?.nodes?.length}
          onClick={() =>
            exportRawData((data?.nodes ?? []) as unknown as Record<string, unknown>[], 'csv', `traceability-matrix-${projectId}-${new Date().toISOString().slice(0, 10)}.csv`)
          }
        >
          <Download className="size-3.5" aria-hidden="true" /> Export CSV
        </Button>
      </header>

      <section className="rounded-xl border border-border bg-card p-4 space-y-2">
        <h2 className="text-sm font-semibold">Requirements source</h2>
        <CloudAlmImport projectId={projectId} />
      </section>

      {q.isLoading ? (
        <PanelLoading rows={4} label="Loading traceability matrix" />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what="the traceability matrix" />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi label="Requirements" value={data!.summary.totalRequirements} hint={`${data!.summary.requirementsWithFindings} linked to findings`} icon={ListChecks} tone="border-border" />
            <Kpi label="Criticals without task" value={data!.summary.criticalFindingsWithoutTasks} hint={`${data!.summary.criticalFindingsInLatestRun} BLOCKER/CRITICAL in the latest run`} icon={AlertTriangle} tone="border-rose-500/30" />
            <Kpi label="Untested requirements" value={data!.summary.requirementsWithoutTests} hint="No regression test linked" icon={ShieldAlert} tone="border-amber-500/30" />
            <Kpi
              label="Verified remediation"
              value={data!.summary.remediationVerifiedPercent === null ? '—' : `${data!.summary.remediationVerifiedPercent}%`}
              hint={`${data!.summary.workItemsPendingVerification} pending verification · ${data!.summary.workItemsInConflict} in conflict`}
              icon={ShieldCheck}
              tone="border-emerald-500/30"
            />
          </div>

          {!data!.nodes.length ? (
            <PanelEmpty
              icon={Layers}
              title="No traceability data yet"
              body="Import requirements from SAP Cloud ALM, or create work items from findings — each linked finding appears here."
            />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border bg-card">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Traceability matrix</caption>
                <thead className="text-muted-foreground uppercase tracking-wider">
                  <tr>
                    <th className="p-3">Business process</th>
                    <th className="p-3">Requirement</th>
                    <th className="p-3">Finding</th>
                    <th className="p-3">Work item</th>
                    <th className="p-3">Test</th>
                    <th className="p-3">Transport</th>
                    <th className="p-3">Release</th>
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
                            <span className="text-muted-foreground">No finding linked</span>
                          )}
                        </td>
                        <td className="p-3">
                          {wi ? (
                            <div className="space-y-1">
                              {wi.externalUrl ? (
                                <a href={wi.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                                  {wi.externalKey ?? wi.externalId} <ExternalLink className="size-3" aria-hidden="true" />
                                  <span className="sr-only">(opens in new tab)</span>
                                </a>
                              ) : (
                                <span className="font-mono">{wi.externalKey ?? wi.externalId}</span>
                              )}
                              <RemediationBadge state={wi.remediationState} />
                            </div>
                          ) : n.remediationTaskId ? (
                            <span className="font-mono">{n.remediationTaskId} ({n.taskStatus})</span>
                          ) : n.findingId ? (
                            <Link href={`/projects/${projectId}/findings?id=${n.findingId}`} className="text-primary hover:underline">Create from finding</Link>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="p-3">{n.testCaseId ? `${n.testTitle ?? n.testCaseId} (${n.testStatus})` : <span className="text-muted-foreground">No test</span>}</td>
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
