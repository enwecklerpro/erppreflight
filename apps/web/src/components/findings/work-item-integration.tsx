'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Eye, Lock, Send } from 'lucide-react';
import {
  WorkItemPreview,
  createWorkItem,
  fetchConnectors,
  fetchWorkItems,
  previewWorkItem,
} from '@/lib/api/integrations';
import { Button, PanelError, RemediationBadge, errorMessage } from '@/components/integrations/ui';
import { connectorKeys } from '@/components/integrations/connectors-panel';
import { workItemKeys } from '@/components/integrations/work-items-panel';

const WORK_ITEM_TYPES = new Set(['SAP_CLOUD_ALM', 'JIRA', 'AZURE_DEVOPS', 'SERVICENOW']);

/**
 * Finding → work item (Part 15.8) using the organization's configured connectors.
 * Shows existing links with live status; creation requires a preview + explicit
 * confirmation and a connector with write access. Nothing is simulated.
 */
export function WorkItemIntegration({ findingId }: { findingId: string }) {
  const qc = useQueryClient();
  const connectors = useQuery({ queryKey: connectorKeys.all, queryFn: fetchConnectors });
  const linked = useQuery({ queryKey: workItemKeys.forFinding(findingId), queryFn: () => fetchWorkItems({ findingId }) });
  const candidates = (connectors.data ?? []).filter((c) => WORK_ITEM_TYPES.has(c.type) && c.status === 'ACTIVE');
  const [connectorId, setConnectorId] = React.useState('');
  const [preview, setPreview] = React.useState<WorkItemPreview | null>(null);
  const selected = candidates.find((c) => c.id === connectorId) ?? candidates[0];

  const doPreview = useMutation({
    mutationFn: () => previewWorkItem(findingId, selected!.id),
    onSuccess: (r) => {
      if ('dryRun' in r) setPreview(r);
      else qc.invalidateQueries({ queryKey: workItemKeys.forFinding(findingId) });
    },
  });
  const create = useMutation({
    mutationFn: () => createWorkItem(findingId, selected!.id),
    onSuccess: () => {
      setPreview(null);
      qc.invalidateQueries({ queryKey: workItemKeys.forFinding(findingId) });
      qc.invalidateQueries({ queryKey: workItemKeys.all });
    },
  });

  if (connectors.isLoading || linked.isLoading) {
    return <div role="status" aria-label="Loading work item connectors" className="h-8 rounded bg-muted/60 dark:bg-muted-dark/60 motion-safe:animate-pulse" />;
  }
  if (connectors.isError || linked.isError) {
    return <PanelError error={connectors.error ?? linked.error} onRetry={() => { connectors.refetch(); linked.refetch(); }} what="work item connectors" />;
  }

  const alreadyLinked = new Set((linked.data ?? []).map((w) => w.connectorId));

  return (
    <div className="space-y-2">
      {(linked.data ?? []).length > 0 && (
        <ul className="space-y-1" aria-label="Linked work items">
          {linked.data!.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-2 text-[11px]">
              {w.externalUrl ? (
                <a href={w.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
                  {w.externalKey ?? w.externalId} <ExternalLink className="size-3" aria-hidden="true" />
                  <span className="sr-only">(opens in new tab)</span>
                </a>
              ) : (
                <span className="font-mono">{w.externalKey ?? w.externalId}</span>
              )}
              <span className="text-muted-foreground">{w.connectorName} · {w.externalStatus ?? '—'}</span>
              <RemediationBadge state={w.remediationState} />
            </li>
          ))}
        </ul>
      )}
      {candidates.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No work item connector is configured.{' '}
          <Link href="/integrations?tab=connectors" className="text-primary hover:underline">
            Connect SAP Cloud ALM, Jira, Azure DevOps or ServiceNow
          </Link>
          .
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`wi-connector-${findingId}`} className="sr-only">Target work management system</label>
          <select
            id={`wi-connector-${findingId}`}
            value={selected?.id ?? ''}
            onChange={(e) => {
              setConnectorId(e.target.value);
              setPreview(null);
            }}
            className="rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {alreadyLinked.has(c.id) ? ' (linked)' : ''}
              </option>
            ))}
          </select>
          {selected && selected.accessMode === 'READ_ONLY' ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Lock className="size-3" aria-hidden="true" /> Read-only connector —{' '}
              <Link href="/integrations?tab=connectors" className="text-primary hover:underline">allow writes</Link> to create items
            </span>
          ) : selected && !alreadyLinked.has(selected.id) ? (
            <Button variant="secondary" onClick={() => doPreview.mutate()} busy={doPreview.isPending}>
              <Eye className="size-3" aria-hidden="true" /> Preview work item
            </Button>
          ) : null}
        </div>
      )}
      {preview && (
        <div className="rounded-md border border-border bg-background p-2 space-y-2">
          <p className="text-[11px] font-semibold">
            {preview.preview.title}
            <span className="font-normal text-muted-foreground"> → {preview.connector.name}{preview.preview.externalProjectId ? ` (project ${preview.preview.externalProjectId})` : ''}</span>
          </p>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">{preview.preview.body}</pre>
          <div className="flex gap-2">
            <Button onClick={() => create.mutate()} busy={create.isPending}>
              <Send className="size-3" aria-hidden="true" /> Create work item in {preview.connector.name}
            </Button>
            <Button variant="ghost" onClick={() => setPreview(null)}>Cancel</Button>
          </div>
        </div>
      )}
      {(doPreview.isError || create.isError) && (
        <p role="alert" className="text-[11px] text-destructive">{errorMessage(doPreview.error ?? create.error)}</p>
      )}
    </div>
  );
}
