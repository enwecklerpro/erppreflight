'use client';

import * as React from 'react';
import { ObjectTierBadge } from './object-tier-badge';
import { ObjectTypeBadge } from './object-type-badge';
import { SeverityBadge } from '../findings/severity-badge';
import { X, ShieldCheck, Download } from 'lucide-react';
import { exportRawData } from '../../lib/export';
import { ObjectDetailDrawerProps } from './types';
import { useFmt, useLabel, useT } from '../../i18n/client';

type Tab = 'findings' | 'dependencies' | 'metadata';
const TABS: Tab[] = ['findings', 'dependencies', 'metadata'];

export function ObjectDetailDrawer({ object, onClose }: ObjectDetailDrawerProps) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const [activeTab, setActiveTab] = React.useState<Tab>('findings');
  const panelRef = React.useRef<HTMLDivElement>(null);

  // Escape closes; focus moves into the drawer and returns to the trigger on close.
  React.useEffect(() => {
    if (!object) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [object, onClose]);

  if (!object) return null;

  const handleExportJson = () => {
    exportRawData([object as any], 'json', `${object.name}-inventory-detail.json`);
  };

  const tabLabel = (tab: Tab) =>
    tab === 'findings'
      ? t('app.objects.drawer.tabFindings', { count: object.findingSummary.totalCount })
      : tab === 'dependencies'
      ? t('app.objects.drawer.tabDependencies', { count: object.dependencies.length })
      : t('app.objects.drawer.tabMetadata');

  const onTabKey = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = TABS[(idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    setActiveTab(next);
    document.getElementById(`object-tab-${next}`)?.focus();
  };

  const level = t(`app.objects.complexityLevel.${object.complexity.level}`);
  const metadata: Array<[string, React.ReactNode]> = [
    [t('app.objects.drawer.objectId'), <span className="font-mono">{object.id}</span>],
    [t('app.objects.drawer.modificationStatus'), label('app.objects.modification', object.modificationStatus)],
    [
      t('app.objects.drawer.complexityScore'),
      t('app.objects.drawer.complexityScoreValue', { score: fmt.number(object.complexity.score), level }),
    ],
    [t('app.objects.drawer.cyclomatic'), fmt.number(object.complexity.cyclomaticComplexity)],
    [t('app.objects.drawer.statements'), fmt.number(object.complexity.statementsCount)],
    [t('app.objects.drawer.changedBy'), <span className="font-mono">{object.lastChangedBy}</span>],
    [t('app.objects.drawer.changedAt'), fmt.dateTime(object.lastChangedAt)],
  ];

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 flex justify-end" onClick={onClose}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="object-drawer-title"
        tabIndex={-1}
        className="w-full max-w-2xl bg-card border-l border-border h-full shadow-2xl flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 sm:px-6 py-4 border-b border-border bg-muted/40 flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <ObjectTypeBadge type={object.objectType} />
              <h2 id="object-drawer-title" className="text-base font-bold font-mono text-foreground break-all">
                {object.name}
              </h2>
            </div>
            {object.description && <p className="text-sm text-muted-foreground line-clamp-2">{object.description}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              title={t('app.objects.drawer.export')}
              aria-label={t('app.objects.drawer.export')}
            >
              <Download className="size-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
              aria-label={t('app.objects.drawer.close')}
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <dl className="px-4 sm:px-6 py-4 bg-muted/20 border-b border-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground font-medium">{t('app.objects.drawer.tier')}</dt>
            <dd className="mt-1">
              <ObjectTierBadge tier={object.cleanCoreTier} size="sm" />
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground font-medium">{t('app.objects.drawer.package')}</dt>
            <dd className="mt-1 font-mono font-bold text-foreground truncate">
              {object.package} ({object.softwareComponent})
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground font-medium">{t('app.objects.drawer.complexity')}</dt>
            <dd className="mt-1 font-semibold text-foreground">
              {level} · {t('app.objects.col.loc', { count: fmt.number(object.complexity.linesOfCode) })}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground font-medium">{t('app.objects.drawer.transport')}</dt>
            <dd className="mt-1 font-mono text-foreground">{object.transportRequest || t('app.objects.drawer.local')}</dd>
          </div>
        </dl>

        <div role="tablist" aria-label={t('app.objects.drawer.tabsLabel')} className="flex overflow-x-auto border-b border-border px-4 sm:px-6 gap-6 text-sm font-semibold">
          {TABS.map((tab, idx) => (
            <button
              key={tab}
              id={`object-tab-${tab}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls={`object-panel-${tab}`}
              tabIndex={activeTab === tab ? 0 : -1}
              onClick={() => setActiveTab(tab)}
              onKeyDown={(e) => onTabKey(e, idx)}
              className={`py-3 border-b-2 whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tabLabel(tab)}
            </button>
          ))}
        </div>

        <div
          id={`object-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`object-tab-${activeTab}`}
          className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6"
        >
          {activeTab === 'findings' && (
            <div className="space-y-4">
              {object.findingSummary.totalCount === 0 ? (
                <div className="p-8 text-center rounded-xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <ShieldCheck className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" aria-hidden="true" />
                  <h3 className="mt-2 text-sm font-bold text-foreground">{t('app.objects.drawer.cleanTitle')}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{t('app.objects.drawer.cleanBody')}</p>
                </div>
              ) : (
                object.findingSummary.findings.map((f) => (
                  <div key={f.id} className="p-4 rounded-xl border border-border bg-card space-y-3 shadow-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <SeverityBadge severity={f.severity} size="sm" />
                      <span className="font-mono text-xs font-bold text-primary break-all">{f.ruleId}</span>
                    </div>
                    <h3 className="text-sm font-bold text-foreground">{f.title}</h3>
                    <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
                      <span className="text-xs font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 block">
                        {t('app.objects.drawer.remediation')}
                      </span>
                      <p className="mt-1 text-sm text-blue-950 dark:text-blue-100">{f.remediation}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'dependencies' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{t('app.objects.drawer.dependenciesIntro')}</p>
              {object.dependencies.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground border border-dashed rounded-xl">
                  {t('app.objects.drawer.noDependencies')}
                </div>
              ) : (
                <ul className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card">
                  {object.dependencies.map((dep, idx) => (
                    <li key={idx} className="p-3 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-bold text-foreground break-all">{dep.targetName}</span>
                          <span className="text-xs text-muted-foreground font-mono">({dep.targetType})</span>
                          {dep.isCleanCoreHazard && (
                            <span className="px-1.5 rounded text-xs font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                              {t('app.objects.drawer.hazard')}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground font-mono">
                          <span>{dep.direction}</span>
                          <span aria-hidden="true">·</span>
                          <span>{dep.dependencyType}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold">{dep.releaseContract}</span>
                        </div>
                      </div>
                      {dep.recommendedSuccessor && (
                        <div className="text-right">
                          <span className="text-xs text-muted-foreground block">{t('app.objects.drawer.successor')}</span>
                          <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">{dep.recommendedSuccessor}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {activeTab === 'metadata' && (
            <dl className="bg-card border border-border rounded-xl px-4 divide-y divide-border text-sm">
              {metadata.map(([term, value]) => (
                <div key={term} className="py-2 flex flex-wrap justify-between gap-2">
                  <dt className="text-muted-foreground">{term}</dt>
                  <dd className="text-foreground text-right break-all">{value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      </div>
    </div>
  );
}
