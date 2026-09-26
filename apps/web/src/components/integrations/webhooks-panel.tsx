'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Power, RotateCcw, Webhook } from 'lucide-react';
import {
  WebhookRow,
  fetchDeliveries,
  fetchWebhookEvents,
  fetchWebhooksWithStats,
  replayDelivery,
  rotateWebhookSecret,
  setWebhookStatus,
} from '@/lib/api/integrations';
import { Button, Card, ConfirmButton, OneTimeSecret, OutcomeBadge, PanelEmpty, PanelError, PanelLoading, StatusBadge, useIntegrationText } from './ui';

const keys = {
  hooks: ['integrations', 'webhooks'] as const,
  events: ['integrations', 'webhook-events'] as const,
  deliveries: (id: string) => ['integrations', 'webhooks', id, 'deliveries'] as const,
};

function DeliveryLog({ hook }: { hook: WebhookRow }) {
  const { t, errorText, formatDate } = useIntegrationText();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: keys.deliveries(hook.id), queryFn: () => fetchDeliveries(hook.id), refetchInterval: 15_000 });
  const replay = useMutation({
    mutationFn: (deliveryId: string) => replayDelivery(hook.id, deliveryId),
    onSettled: () => qc.invalidateQueries({ queryKey: keys.deliveries(hook.id) }),
  });
  if (q.isLoading) return <PanelLoading rows={2} label={t('app.integrations.webhooks.deliveries.loading')} />;
  if (q.isError) return <PanelError error={q.error} onRetry={() => q.refetch()} what={t('app.integrations.webhooks.deliveries.what')} />;
  if (!q.data?.length) return <p className="text-xs text-muted-foreground">{t('app.integrations.webhooks.deliveries.empty')}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">{t('app.integrations.webhooks.deliveries.caption', { url: hook.url })}</caption>
        <thead className="text-left text-muted-foreground">
          <tr>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.webhooks.deliveries.created')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.webhooks.deliveries.event')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.webhooks.deliveries.status')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.webhooks.deliveries.attempts')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.webhooks.deliveries.http')}</th>
            <th className="py-1 pr-3 font-medium">{t('app.integrations.webhooks.deliveries.nextRetry')}</th>
            <th className="py-1 font-medium">{t('app.integrations.webhooks.deliveries.replay')}</th>
          </tr>
        </thead>
        <tbody>
          {q.data.map((d) => (
            <tr key={d.id} className="border-t border-border align-top">
              <td className="py-1 pr-3 whitespace-nowrap">{formatDate(d.createdAt)}</td>
              <td className="py-1 pr-3 font-mono">
                {d.eventType}
                {d.replayOf && <span className="ml-1 text-muted-foreground">{t('app.integrations.webhooks.deliveries.replayOf')}</span>}
              </td>
              <td className="py-1 pr-3">
                <OutcomeBadge outcome={d.status} />
              </td>
              <td className="py-1 pr-3">
                {d.attempts}/{d.maxAttempts}
              </td>
              <td className="py-1 pr-3">{d.lastHttpStatus ?? (d.lastError ? '—' : '')}{d.lastError ? <span className="block text-destructive">{d.lastError}</span> : null}</td>
              <td className="py-1 pr-3 whitespace-nowrap">{formatDate(d.nextAttemptAt)}</td>
              <td className="py-1">
                <Button
                  variant="ghost"
                  onClick={() => replay.mutate(d.id)}
                  busy={replay.isPending && replay.variables === d.id}
                  aria-label={t('app.integrations.webhooks.deliveries.replayLabel', { event: d.eventType })}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" /> {t('app.integrations.webhooks.deliveries.replay')}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {replay.isError && <p role="alert" className="mt-1 text-xs text-destructive">{errorText(replay.error)}</p>}
    </div>
  );
}

function HookItem({ hook }: { hook: WebhookRow }) {
  const { t, errorText } = useIntegrationText();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [secret, setSecret] = React.useState<string | null>(null);
  const rotate = useMutation({ mutationFn: () => rotateWebhookSecret(hook.id), onSuccess: (r) => setSecret(r.secret) });
  const toggle = useMutation({
    mutationFn: () => setWebhookStatus(hook.id, hook.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE'),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.hooks }),
  });
  return (
    <li className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
        <div className="min-w-0">
          <p className="font-mono text-xs break-all">{hook.url}</p>
          <p className="text-[11px] text-muted-foreground">{(hook.events || []).join(', ')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5 items-center">
          {hook.status === 'ACTIVE' ? (
            <StatusBadge tone="ok" icon={Power} label={t('app.integrations.common.active')} />
          ) : (
            <StatusBadge tone="neutral" icon={Power} label={t('app.integrations.common.disabled')} />
          )}
          <StatusBadge tone="ok" icon={Webhook} label={t('app.integrations.webhooks.delivered', { count: hook.delivered })} />
          {hook.failed > 0 && <StatusBadge tone="bad" icon={Webhook} label={t('app.integrations.webhooks.failed', { count: hook.failed })} />}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? t('app.integrations.webhooks.hideLog') : t('app.integrations.webhooks.showLog')}
        </Button>
        <ConfirmButton
          label={<><KeyRound className="size-3.5" aria-hidden="true" /> {t('app.integrations.webhooks.rotateSecret')}</>}
          confirmLabel={t('app.integrations.webhooks.confirmRotate')}
          variant="secondary"
          onConfirm={() => rotate.mutate()}
          busy={rotate.isPending}
        />
        <Button variant="ghost" onClick={() => toggle.mutate()} busy={toggle.isPending}>
          <Power className="size-3.5" aria-hidden="true" />{' '}
          {hook.status === 'ACTIVE' ? t('app.integrations.common.disable') : t('app.integrations.common.enable')}
        </Button>
      </div>
      {secret && <OneTimeSecret label={t('app.integrations.webhooks.newSecret')} value={secret} onDismiss={() => setSecret(null)} />}
      {(rotate.isError || toggle.isError) && <p role="alert" className="text-xs text-destructive">{errorText(rotate.error ?? toggle.error)}</p>}
      {open && <DeliveryLog hook={hook} />}
    </li>
  );
}

export function WebhooksPanel() {
  const { t } = useIntegrationText();
  const hooks = useQuery({ queryKey: keys.hooks, queryFn: fetchWebhooksWithStats });
  const events = useQuery({ queryKey: keys.events, queryFn: fetchWebhookEvents, staleTime: 10 * 60_000 });
  return (
    <div className="space-y-4">
      <Card
        title={t('app.integrations.webhooks.title')}
        description={t('app.integrations.webhooks.description')}
        actions={
          <Link href="/settings" className="text-xs font-semibold text-primary hover:underline">
            {t('app.integrations.webhooks.registerInSettings')}
          </Link>
        }
      >
        {hooks.isLoading ? (
          <PanelLoading label={t('app.integrations.webhooks.loading')} />
        ) : hooks.isError ? (
          <PanelError error={hooks.error} onRetry={() => hooks.refetch()} what={t('app.integrations.webhooks.what')} />
        ) : !hooks.data?.length ? (
          <PanelEmpty icon={Webhook} title={t('app.integrations.webhooks.emptyTitle')} body={t('app.integrations.webhooks.emptyBody')} />
        ) : (
          <ul className="space-y-2">
            {hooks.data.map((h) => (
              <HookItem key={h.id} hook={h} />
            ))}
          </ul>
        )}
      </Card>
      <Card title={t('app.integrations.webhooks.catalogTitle')} description={t('app.integrations.webhooks.catalogDescription')}>
        {events.isLoading ? (
          <PanelLoading rows={2} label={t('app.integrations.webhooks.catalogLoading')} />
        ) : events.isError ? (
          <PanelError error={events.error} onRetry={() => events.refetch()} what={t('app.integrations.webhooks.catalogWhat')} />
        ) : (
          <dl className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
            {events.data?.map((e) => (
              <div key={e.type} className="rounded-md border border-border p-2">
                <dt className="font-mono font-semibold">{e.type}</dt>
                <dd className="text-muted-foreground">{e.description}</dd>
                <dd className="mt-0.5 text-[11px] text-muted-foreground">
                  {t('app.integrations.webhooks.payloadFields', { fields: e.payloadFields.join(', ') })}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}
