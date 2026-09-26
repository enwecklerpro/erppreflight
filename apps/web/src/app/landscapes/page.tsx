'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Server, Plus, Trash2, ShieldCheck, Activity, Lock, X, Loader2, AlertTriangle } from 'lucide-react';
import { fetchLandscapes, createLandscape, removeLandscape, testLandscapeConnection } from '@/lib/api-client';
import { Dialog } from '@/components/dialog';
import { ErrorState } from '@/components/commercial/states';
import { useErrorText, useFmt, useLabel, useT } from '@/i18n/client';

const ENVS = ['DEV', 'QA', 'PROD'] as const;
const input = 'w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

interface HandshakeResult {
  handshakeStatus?: string;
  systemId?: string;
  environment?: string;
  protocol?: string;
  latencyMs?: number;
  handshakeTimestamp?: string;
  writeSafety?: { policyStatement?: string; productionWriteLocked?: boolean; requiresDualApproval?: boolean };
  discoveredApis?: Array<{ name: string; version: string; path: string; status: string }>;
  supportedEngines?: string[];
}

export default function LandscapesPage() {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['landscapes'], queryFn: fetchLandscapes });
  const landscapes = query.data ?? [];

  const [showAddModal, setShowAddModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [handshakeResult, setHandshakeResult] = useState<HandshakeResult | null>(null);

  const [systemId, setSystemId] = useState('');
  const [release, setRelease] = useState('2023');
  const [environment, setEnvironment] = useState<string>('DEV');
  const [url, setUrl] = useState('');

  const createMutation = useMutation({
    mutationFn: (data: Parameters<typeof createLandscape>[0]) => createLandscape(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['landscapes'] });
      setShowAddModal(false);
      setSystemId('');
      setUrl('');
    },
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => testLandscapeConnection(id),
    onMutate: (id) => setTestingId(id),
    onSuccess: (res) => {
      setHandshakeResult(res as HandshakeResult);
      queryClient.invalidateQueries({ queryKey: ['landscapes'] });
    },
    onSettled: () => setTestingId(null),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => removeLandscape(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['landscapes'] }),
  });

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!systemId.trim()) return;
    createMutation.mutate({
      systemId: systemId.trim(),
      product: 'SAP S/4HANA',
      edition: 'Private Cloud',
      release,
      environment,
      criticality: 'HIGH',
      url: url.trim() || undefined,
    } as Parameters<typeof createLandscape>[0]);
  }

  const actionError = testMutation.error ?? removeMutation.error;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="min-w-0">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-semibold uppercase tracking-wider mb-2 border border-primary/20">
            <Server className="w-3.5 h-3.5" aria-hidden="true" />
            {t('app.landscapes.eyebrow')}
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-foreground">{t('app.landscapes.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('app.landscapes.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddModal(true)}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm shadow-sm hover:bg-primary/90 self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          {t('app.landscapes.register')}
        </button>
      </div>

      {actionError && <ErrorState title={t('app.landscapes.actionFailed')} error={actionError} />}

      {query.isError ? (
        <ErrorState title={t('app.landscapes.loadFailed')} error={query.error} onRetry={() => query.refetch()} />
      ) : query.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6" aria-busy="true" aria-label={t('app.landscapes.loading')}>
          {ENVS.map((e) => (
            <div key={e} className="h-48 rounded-xl border border-border bg-card animate-pulse motion-reduce:animate-none" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {ENVS.map((env) => {
            const envSystems = landscapes.filter((l) => l.environment === env);
            return (
              <section key={env} aria-labelledby={`env-${env}`} className="bg-card border border-border rounded-xl p-5 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-4 pb-2 border-b border-border">
                  <h2 id={`env-${env}`} className="font-bold text-sm text-foreground flex items-center gap-2">
                    <span className={`w-2.5 h-2.5 rounded-full ${env === 'PROD' ? 'bg-rose-500' : env === 'QA' ? 'bg-amber-400' : 'bg-cyan-500'}`} aria-hidden="true" />
                    {t('app.landscapes.envTitle', { env })}
                  </h2>
                  <span className="text-xs text-muted-foreground">{t('app.landscapes.systems', { count: envSystems.length })}</span>
                </div>
                {envSystems.length === 0 ? (
                  <p className="text-center py-6 text-sm text-muted-foreground">{t('app.landscapes.noSystems', { env })}</p>
                ) : (
                  <ul className="space-y-3">
                    {envSystems.map((sys) => (
                      <li key={sys.id} className="p-3.5 bg-background rounded-lg border border-border">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-mono font-bold text-foreground text-sm break-all">{sys.system_id}</span>
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded border ${
                              sys.criticality === 'CRITICAL' ? 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border-rose-500/30' : 'bg-muted text-muted-foreground border-border'
                            }`}
                          >
                            {sys.criticality === 'CRITICAL' && <AlertTriangle className="size-3" aria-hidden="true" />}
                            {label('app.landscapes.criticality', sys.criticality)}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {sys.product} ({sys.release}) • {sys.edition}
                        </div>
                        {sys.url && <div className="text-xs text-primary font-mono mt-1 truncate">{sys.url}</div>}
                        <div className="mt-2 pt-2 border-t border-border flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => testMutation.mutate(sys.id)}
                            disabled={testingId === sys.id}
                            aria-label={t('app.landscapes.testLabel', { system: sys.system_id })}
                            className="inline-flex items-center gap-1.5 px-2 py-1 bg-muted hover:bg-muted/70 text-primary text-xs font-semibold rounded border border-border disabled:opacity-50"
                          >
                            {testingId === sys.id ? (
                              <>
                                <Loader2 className="w-3 h-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                {t('app.landscapes.testing')}
                              </>
                            ) : (
                              <>
                                <Activity className="w-3 h-3" aria-hidden="true" />
                                {t('app.landscapes.test')}
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              if (window.confirm(t('app.landscapes.removeConfirm', { system: sys.system_id }))) removeMutation.mutate(sys.id);
                            }}
                            aria-label={t('app.landscapes.removeLabel', { system: sys.system_id })}
                            className="text-rose-700 hover:text-rose-600 dark:text-rose-400 text-xs font-semibold flex items-center gap-1"
                          >
                            <Trash2 className="w-3 h-3" aria-hidden="true" />
                            {t('app.landscapes.remove')}
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <Dialog labelledBy="add-system-title" onClose={() => setShowAddModal(false)} className="max-w-md">
          <h2 id="add-system-title" className="text-lg font-bold text-foreground">
            {t('app.landscapes.dialogTitle')}
          </h2>
          {createMutation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errText(createMutation.error, t('app.landscapes.createFailed'))}
            </p>
          )}
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label htmlFor="ls-system" className="block text-sm font-semibold text-foreground mb-1">{t('app.landscapes.systemId')}</label>
              <input id="ls-system" type="text" required value={systemId} onChange={(e) => setSystemId(e.target.value)} placeholder="S4H_DEV_100" className={`${input} font-mono`} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="ls-env" className="block text-sm font-semibold text-foreground mb-1">{t('app.landscapes.environment')}</label>
                <select id="ls-env" value={environment} onChange={(e) => setEnvironment(e.target.value)} className={input}>
                  {ENVS.map((e) => (
                    <option key={e} value={e}>
                      {t(`app.landscapes.env.${e}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="ls-release" className="block text-sm font-semibold text-foreground mb-1">{t('app.landscapes.release')}</label>
                <input id="ls-release" type="text" value={release} onChange={(e) => setRelease(e.target.value)} placeholder="2023" className={input} />
              </div>
            </div>
            <div>
              <label htmlFor="ls-url" className="block text-sm font-semibold text-foreground mb-1">{t('app.landscapes.url')}</label>
              <input id="ls-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://s4h-dev.example.com:44300" className={input} />
            </div>
            <div className="flex justify-end gap-3 pt-3 border-t border-border">
              <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground">
                {t('app.landscapes.cancel')}
              </button>
              <button type="submit" disabled={createMutation.isPending} className="px-5 py-2 rounded-lg bg-primary text-primary-foreground font-semibold text-sm disabled:opacity-50">
                {createMutation.isPending ? t('app.landscapes.saving') : t('app.landscapes.save')}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {handshakeResult && (
        <Dialog labelledBy="handshake-title" onClose={() => setHandshakeResult(null)} className="max-w-2xl">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-border">
            <div className="flex items-start gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 shrink-0">
                <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 id="handshake-title" className="text-base font-bold text-foreground flex flex-wrap items-center gap-2">
                  {t('app.landscapes.handshakeTitle')}
                  {handshakeResult.handshakeStatus && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20 font-mono">
                      {handshakeResult.handshakeStatus}
                    </span>
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {t('app.landscapes.handshakeSummary', {
                    system: handshakeResult.systemId ?? '—',
                    env: handshakeResult.environment ?? '—',
                    protocol: handshakeResult.protocol ?? '—',
                    ms: handshakeResult.latencyMs ?? 0,
                  })}
                </p>
              </div>
            </div>
            <button type="button" onClick={() => setHandshakeResult(null)} aria-label={t('app.landscapes.close')} className="p-1 text-muted-foreground hover:text-foreground rounded-lg">
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>

          <div className="p-3.5 bg-muted/40 rounded-xl border border-border space-y-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Lock className="w-4 h-4 text-primary" aria-hidden="true" />
              {t('app.landscapes.writeSafety')}
            </div>
            {handshakeResult.writeSafety?.policyStatement && <p className="text-sm text-muted-foreground">{handshakeResult.writeSafety.policyStatement}</p>}
            <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-sm">
              <div className="bg-card p-2 rounded border border-border">
                <dt className="text-muted-foreground text-xs">{t('app.landscapes.readOnly')}</dt>
                <dd className="font-semibold">{t('app.landscapes.readOnlyValue')}</dd>
              </div>
              <div className="bg-card p-2 rounded border border-border">
                <dt className="text-muted-foreground text-xs">{t('app.landscapes.prodLock')}</dt>
                <dd className="font-semibold">{handshakeResult.writeSafety?.productionWriteLocked ? t('app.landscapes.locked') : t('app.landscapes.notApplicable')}</dd>
              </div>
              <div className="bg-card p-2 rounded border border-border">
                <dt className="text-muted-foreground text-xs">{t('app.landscapes.dualApproval')}</dt>
                <dd className="font-semibold">{handshakeResult.writeSafety?.requiresDualApproval ? t('app.landscapes.mandatory') : t('app.landscapes.optional')}</dd>
              </div>
            </dl>
          </div>

          {!!handshakeResult.discoveredApis?.length && (
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Activity className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                {t('app.landscapes.apis')}
              </h3>
              <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden">
                {handshakeResult.discoveredApis.map((a, idx) => (
                  <li key={idx} className="p-2.5 flex items-center justify-between gap-2 text-sm">
                    <div className="min-w-0">
                      <span className="text-foreground font-medium">{a.name}</span>
                      <span className="text-muted-foreground font-mono text-xs ml-2">v{a.version}</span>
                      <div className="text-xs font-mono text-muted-foreground truncate">{a.path}</div>
                    </div>
                    <span className="px-2 py-0.5 rounded text-xs bg-muted border border-border font-semibold shrink-0">{a.status}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!handshakeResult.supportedEngines?.length && (
            <div className="space-y-1.5">
              <h3 className="text-sm font-semibold text-foreground">{t('app.landscapes.engines')}</h3>
              <div className="flex flex-wrap gap-1.5">
                {handshakeResult.supportedEngines.map((eng) => (
                  <span key={eng} className="px-2 py-0.5 bg-muted border border-border rounded text-xs font-mono break-all">
                    {eng}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap justify-between items-center gap-2 pt-3 border-t border-border text-xs text-muted-foreground">
            <span>{t('app.landscapes.loggedAt', { time: fmt.time(handshakeResult.handshakeTimestamp) })}</span>
            <button type="button" onClick={() => setHandshakeResult(null)} className="px-4 py-1.5 rounded-lg bg-muted hover:bg-muted/70 text-foreground font-semibold text-sm">
              {t('app.landscapes.close')}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
