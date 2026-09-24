'use client';

import * as React from 'react';
import { SapObject } from '@erppreflight/schemas';
import { ObjectTierBadge } from './object-tier-badge';
import { ObjectTypeBadge } from './object-type-badge';
import { SeverityBadge } from '../findings/severity-badge';
import {
  X,
  ShieldCheck,
  AlertTriangle,
  OctagonAlert,
  ArrowRight,
  Database,
  ExternalLink,
  Layers,
  FileCode,
  Download,
  Info,
} from 'lucide-react';
import { exportRawData } from '../../lib/export';
import { ObjectDetailDrawerProps } from './types';

export function ObjectDetailDrawer({ object, onClose }: ObjectDetailDrawerProps) {
  const [activeTab, setActiveTab] = React.useState<'findings' | 'dependencies' | 'metadata'>('findings');

  // Keyboard escape listener
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!object) return null;

  const handleExportJson = () => {
    exportRawData([object as any], 'json', `${object.name}-inventory-detail.json`);
  };

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="object-drawer-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-card border-l border-border h-full shadow-2xl flex flex-col animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drawer Header */}
        <div className="px-6 py-4 border-b border-border bg-muted/40 flex items-center justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <ObjectTypeBadge type={object.objectType} />
              <h2 id="object-drawer-title" className="text-base font-bold font-mono text-foreground">
                {object.name}
              </h2>
            </div>
            {object.description && (
              <p className="text-xs text-muted-foreground line-clamp-1">{object.description}</p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              className="p-1.5 rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Export Object JSON"
              aria-label="Export Object JSON"
            >
              <Download className="size-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              aria-label="Close object details drawer"
            >
              <X className="size-5" />
            </button>
          </div>
        </div>

        {/* Clean Core Summary Banner */}
        <div className="px-6 py-4 bg-muted/20 border-b border-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-[11px] text-muted-foreground block font-medium">Extensibility Tier</span>
            <div className="mt-1">
              <ObjectTierBadge tier={object.cleanCoreTier} size="sm" />
            </div>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block font-medium">Package / Component</span>
            <span className="mt-1 font-mono font-bold text-foreground block truncate">
              {object.package} ({object.softwareComponent})
            </span>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block font-medium">Complexity / LOC</span>
            <span className="mt-1 font-semibold text-foreground block">
              {object.complexity.level} • {object.complexity.linesOfCode.toLocaleString()} LOC
            </span>
          </div>
          <div>
            <span className="text-[11px] text-muted-foreground block font-medium">Last CTS Transport</span>
            <span className="mt-1 font-mono text-foreground block">
              {object.transportRequest || 'LOCAL'}
            </span>
          </div>
        </div>

        {/* Drawer Tabs Navigation */}
        <div className="flex border-b border-border px-6 space-x-6 text-xs font-semibold">
          {[
            { id: 'findings', label: `Preflight Findings (${object.findingSummary.totalCount})` },
            { id: 'dependencies', label: `Dependencies (${object.dependencies.length})` },
            { id: 'metadata', label: 'Technical Metadata' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`py-3 border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Drawer Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Tab 1: Preflight Findings */}
          {activeTab === 'findings' && (
            <div className="space-y-4">
              {object.findingSummary.totalCount === 0 ? (
                <div className="p-8 text-center rounded-xl border border-dashed border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20">
                  <ShieldCheck className="size-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
                  <h3 className="mt-2 text-sm font-bold text-foreground">Clean Core Compliant Asset</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Zero preflight rule violations detected on this SAP asset.
                  </p>
                </div>
              ) : (
                object.findingSummary.findings.map((f) => (
                  <div
                    key={f.id}
                    className="p-4 rounded-xl border border-border bg-card space-y-3 shadow-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <SeverityBadge severity={f.severity} size="sm" />
                        <span className="font-mono text-xs font-bold text-primary">{f.ruleId}</span>
                      </div>
                    </div>

                    <h4 className="text-sm font-bold text-foreground">{f.title}</h4>

                    <div className="p-3 rounded-lg bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 block">
                        Remediation Action
                      </span>
                      <p className="mt-1 text-xs text-blue-950 dark:text-blue-100">{f.remediation}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab 2: Dependencies & Lineage */}
          {activeTab === 'dependencies' && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Inbound and outbound references analyzed across ABAP ASTs and CDS associations.
              </p>

              {object.dependencies.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
                  No direct external dependencies recorded.
                </div>
              ) : (
                <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-card">
                  {object.dependencies.map((dep, idx) => (
                    <div key={idx} className="p-3 flex items-center justify-between text-xs">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-foreground">{dep.targetName}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            ({dep.targetType})
                          </span>
                          {dep.isCleanCoreHazard && (
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-bold bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                              CLEAN CORE HAZARD
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{dep.direction}</span>
                          <span>•</span>
                          <span>{dep.dependencyType}</span>
                          <span>•</span>
                          <span className="font-semibold">{dep.releaseContract}</span>
                        </div>
                      </div>

                      {dep.recommendedSuccessor && (
                        <div className="text-right">
                          <span className="text-[10px] text-muted-foreground block">C1 Successor</span>
                          <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                            {dep.recommendedSuccessor}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Tab 3: Technical Metadata */}
          {activeTab === 'metadata' && (
            <div className="space-y-4 text-xs">
              <div className="bg-card border border-border rounded-xl p-4 divide-y divide-border">
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Internal Object ID</span>
                  <span className="font-mono text-foreground">{object.id}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Modification Status</span>
                  <span className="font-bold text-foreground">{object.modificationStatus}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Complexity Score</span>
                  <span className="font-mono text-foreground">
                    {object.complexity.score} / 100 ({object.complexity.level})
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Cyclomatic Complexity</span>
                  <span className="font-mono text-foreground">
                    {object.complexity.cyclomaticComplexity}
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Total Statements</span>
                  <span className="font-mono text-foreground">
                    {object.complexity.statementsCount.toLocaleString()}
                  </span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Last Changed By</span>
                  <span className="font-mono text-foreground">{object.lastChangedBy}</span>
                </div>
                <div className="py-2 flex justify-between">
                  <span className="text-muted-foreground">Last Changed Timestamp</span>
                  <span className="font-mono text-foreground">{object.lastChangedAt}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
