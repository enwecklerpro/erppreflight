'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ExternalLink, ListChecks, RefreshCw } from 'lucide-react';
import { fetchWorkItems, resolveWorkItemConflict, syncWorkItem, WorkItem } from '@/lib/api/integrations';
import { Button, Card, ConfirmButton, PanelEmpty, PanelError, PanelLoading, RemediationBadge, StatusBadge, useIntegrationText } from './ui';

export const workItemKeys = {
  all: ['integrations', 'work-items'] as const,
  forFinding: (findingId: string) => ['integrations', 'work-items', 'finding', findingId] as const,
};

function Row({ w }: { w: WorkItem }) {
  const { t, errorText, relative } = useIntegrationText();
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: workItemKeys.all });
  const sync = useMutation({ mutationFn: () => syncWorkItem(w.id), onSuccess: invalidate });
  const resolve = useMutation({ mutationFn: (r: 'ACCEPT_REMOTE' | 'OVERWRITE_REMOTE') => resolveWorkItemConflict(w.id, r), onSuccess: invalidate });
  const err = sync.error ?? resolve.error;
  return (
    <tr className="border-t border-border align-top">
      <td className="py-2 pr-3">
        {w.externalUrl ? (
          <a href={w.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 font-mono text-primary hover:underline">
            {w.externalKey ?? w.externalId} <ExternalLink className="size-3" aria-hidden="true" />
            <span className="sr-only">{t('app.integrations.common.opensInNewTab')}</span>
          </a>
        ) : (
          <span className="font-mono">{w.externalKey ?? w.externalId}</span>
        )}
        <p className="text-[11px] text-muted-foreground">{w.connectorName ?? w.externalSystem}</p>
      </td>
      <td className="py-2 pr-3">
        <span className="text-xs">{w.externalStatus ?? '—'}</span>
      </td>
      <td className="py-2 pr-3">
        <RemediationBadge state={w.remediationState} />
      </td>
      <td className="py-2 pr-3 text-xs text-muted-foreground whitespace-nowrap">{relative(w.lastSyncedAt)}</td>
      <td className="py-2">
        <div className="flex flex-wrap gap-1">
          <Button variant="secondary" onClick={() => sync.mutate()} busy={sync.isPending}>
            <RefreshCw className="size-3.5" aria-hidden="true" /> {t('app.integrations.workItems.sync')}
          </Button>
          {w.conflictState === 'CONFLICT' && (
            <>
              <StatusBadge tone="warn" icon={AlertTriangle} label={t('app.integrations.workItems.conflict')} title={t('app.integrations.workItems.conflictHint')} />
              <Button variant="secondary" onClick={() => resolve.mutate('ACCEPT_REMOTE')} busy={resolve.isPending}>
                {t('app.integrations.workItems.keepRemote')}
              </Button>
              <ConfirmButton
                label={t('app.integrations.workItems.overwriteRemote')}
                confirmLabel={t('app.integrations.workItems.confirmOverwrite')}
                onConfirm={() => resolve.mutate('OVERWRITE_REMOTE')}
              />
            </>
          )}
        </div>
        {err != null && <p role="alert" className="mt-1 text-xs text-destructive">{errorText(err)}</p>}
      </td>
    </tr>
  );
}

export function WorkItemsPanel() {
  const { t } = useIntegrationText();
  const q = useQuery({ queryKey: workItemKeys.all, queryFn: () => fetchWorkItems() });
  return (
    <Card title={t('app.integrations.workItems.title')} description={t('app.integrations.workItems.description')}>
      {q.isLoading ? (
        <PanelLoading label={t('app.integrations.workItems.loading')} />
      ) : q.isError ? (
        <PanelError error={q.error} onRetry={() => q.refetch()} what={t('app.integrations.workItems.what')} />
      ) : !q.data?.length ? (
        <PanelEmpty icon={ListChecks} title={t('app.integrations.workItems.emptyTitle')} body={t('app.integrations.workItems.emptyBody')} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <caption className="sr-only">{t('app.integrations.workItems.caption')}</caption>
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{t('app.integrations.workItems.item')}</th>
                <th className="py-1 pr-3 font-medium">{t('app.integrations.workItems.remoteStatus')}</th>
                <th className="py-1 pr-3 font-medium">{t('app.integrations.workItems.remediation')}</th>
                <th className="py-1 pr-3 font-medium">{t('app.integrations.workItems.lastSync')}</th>
                <th className="py-1 font-medium">{t('app.integrations.workItems.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((w) => (
                <Row key={w.id} w={w} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
