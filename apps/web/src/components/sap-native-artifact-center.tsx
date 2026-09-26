'use client';

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  FileText,
  Upload,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Layers,
  ArrowRight,
  FileCheck2,
  Boxes,
  Loader2,
  Sparkles,
} from 'lucide-react';
import {
  importAtcArtifact,
  importReadinessCheckArtifact,
  importFioriUsageArtifact,
} from '@/lib/api-client';
import { useErrorText, useFmt, useT } from '@/i18n/client';

interface SapNativeArtifactCenterProps {
  projectId: string;
}

export function SapNativeArtifactCenter({ projectId }: SapNativeArtifactCenterProps) {
  const t = useT();
  const fmt = useFmt();
  const errText = useErrorText();
  const queryClient = useQueryClient();

  const [activeSubTab, setActiveSubTab] = useState<'atc' | 'readiness' | 'fiori'>('atc');

  // ATC state
  const [atcContent, setAtcContent] = useState('');
  const [atcFileName, setAtcFileName] = useState('atc_findings.xml');
  const [atcResult, setAtcResult] = useState<any | null>(null);
  const [atcError, setAtcError] = useState<string | null>(null);

  // Readiness Check state
  const [rcContent, setRcContent] = useState('');
  const [rcFileName, setRcFileName] = useState('sap_readiness_check.json');
  const [rcResult, setRcResult] = useState<any | null>(null);
  const [rcError, setRcError] = useState<string | null>(null);

  // Fiori usage state
  const [fioriContent, setFioriContent] = useState('');
  const [fioriFileName, setFioriFileName] = useState('fiori_usage.csv');
  const [fioriResult, setFioriResult] = useState<any | null>(null);
  const [fioriError, setFioriError] = useState<string | null>(null);

  // Mutations
  const atcMutation = useMutation({
    mutationFn: (payload: { rawContent: string; fileName: string }) =>
      importAtcArtifact(projectId, payload),
    onSuccess: (data) => {
      setAtcResult(data);
      setAtcError(null);
      queryClient.invalidateQueries({ queryKey: ['findingsStats', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projectObjects', projectId] });
      queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    },
    onError: (err: Error) => {
      setAtcError(errText(err, t('app.sapNative.atcFailed')));
    },
  });

  const rcMutation = useMutation({
    mutationFn: (payload: { rawContent: string; fileName: string }) =>
      importReadinessCheckArtifact(projectId, payload),
    onSuccess: (data) => {
      setRcResult(data);
      setRcError(null);
      queryClient.invalidateQueries({ queryKey: ['findingsStats', projectId] });
      queryClient.invalidateQueries({ queryKey: ['analyses', projectId] });
    },
    onError: (err: Error) => {
      setRcError(errText(err, t('app.sapNative.rcFailed')));
    },
  });

  const fioriMutation = useMutation({
    mutationFn: (payload: { rawContent: string; fileName: string }) =>
      importFioriUsageArtifact(projectId, payload),
    onSuccess: (data) => {
      setFioriResult(data);
      setFioriError(null);
    },
    onError: (err: Error) => {
      setFioriError(errText(err, t('app.sapNative.fioriFailed')));
    },
  });

  const handleFileUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    type: 'atc' | 'readiness' | 'fiori'
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (type === 'atc') {
        setAtcContent(text);
        setAtcFileName(file.name);
      } else if (type === 'readiness') {
        setRcContent(text);
        setRcFileName(file.name);
      } else {
        setFioriContent(text);
        setFioriFileName(file.name);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Banner */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <FileCheck2 className="h-5 w-5 text-primary" aria-hidden="true" />
              {t('app.sapNative.title')}
            </h3>
            <p className="text-sm text-muted-foreground mt-1">{t('app.sapNative.intro')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              {t('app.sapNative.baseline')}
            </span>
          </div>
        </div>
      </div>

      {/* Subtabs */}
      <div className="flex flex-wrap border-b border-border gap-x-4 gap-y-2 text-sm font-semibold" role="tablist" aria-label={t('app.sapNative.tabsLabel')}>
        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'atc'}
          onClick={() => setActiveSubTab('atc')}
          className={`pb-3 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeSubTab === 'atc'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Boxes className="size-4" aria-hidden="true" />
          {t('app.sapNative.tabAtc')}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'readiness'}
          onClick={() => setActiveSubTab('readiness')}
          className={`pb-3 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeSubTab === 'readiness'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Layers className="size-4" aria-hidden="true" />
          {t('app.sapNative.tabReadiness')}
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={activeSubTab === 'fiori'}
          onClick={() => setActiveSubTab('fiori')}
          className={`pb-3 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeSubTab === 'fiori'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="size-4" aria-hidden="true" />
          {t('app.sapNative.tabFiori')}
        </button>
      </div>

      {/* Tab: ATC Import */}
      {activeSubTab === 'atc' && (
        <div className="space-y-5 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h4 className="text-sm font-bold text-foreground">{t('app.sapNative.atcTitle')}</h4>
              <p className="text-sm text-muted-foreground mt-0.5">{t('app.sapNative.atcIntro')}</p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              <Upload className="size-3.5" aria-hidden="true" />
              {t('app.sapNative.chooseFile', { types: '.xml, .json, .csv' })}
              <input
                type="file"
                accept=".xml,.json,.csv,.txt"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'atc')}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{t('app.sapNative.content', { file: atcFileName })}</span>
              <button
                type="button"
                onClick={() => {
                  setAtcContent(`<ATC_RESULTS>\n  <FINDING>\n    <OBJECT_NAME>ZCL_PAYMENT_PROCESSOR</OBJECT_NAME>\n    <OBJECT_TYPE>CLAS</OBJECT_TYPE>\n    <PACKAGE>ZFIN</PACKAGE>\n    <CHECK_ID>DB_MUTATION_CHECK</CHECK_ID>\n    <PRIORITY>1</PRIORITY>\n    <MESSAGE>Direct insert into table BKPF forbidden in Clean Core</MESSAGE>\n    <LINE>142</LINE>\n    <COLUMN>5</COLUMN>\n    <SNIPPET>INSERT INTO bkpf VALUES @ls_header.</SNIPPET>\n  </FINDING>\n</ATC_RESULTS>`);
                  setAtcFileName('sample_atc.xml');
                }}
                className="text-primary hover:underline text-xs"
              >
                {t('app.sapNative.atcSample')}
              </button>
            </div>
            <textarea
              value={atcContent}
              onChange={(e) => setAtcContent(e.target.value)}
              placeholder={t('app.sapNative.atcPlaceholder')}
              aria-label={t('app.sapNative.content', { file: atcFileName })}
              rows={8}
              className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {atcError && (
            <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              <span>{atcError}</span>
            </div>
          )}

          {atcResult && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
                <CheckCircle2 className="size-4" />
                <span>{t('app.sapNative.atcDone')}</span>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-muted-foreground">
                <div><dt>{t('app.sapNative.totalParsed')}</dt><dd className="text-foreground font-bold">{fmt.number(atcResult.totalParsed)}</dd></div>
                <div><dt>{t('app.sapNative.objectsImported')}</dt><dd className="text-foreground font-bold">{fmt.number(atcResult.objectsImported)}</dd></div>
                <div><dt>{t('app.sapNative.findingsCreated')}</dt><dd className="text-foreground font-bold">{fmt.number(atcResult.findingsCreated)}</dd></div>
                <div><dt>{t('app.sapNative.baselined')}</dt><dd className="text-foreground font-bold">{fmt.number(atcResult.baselinedCount)}</dd></div>
              </dl>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => atcMutation.mutate({ rawContent: atcContent, fileName: atcFileName })}
              disabled={!atcContent.trim() || atcMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {atcMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t('app.sapNative.atcImporting')}
                </>
              ) : (
                <>
                  <Upload className="size-3.5" aria-hidden="true" />
                  {t('app.sapNative.atcImport')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Tab: Readiness Check Import */}
      {activeSubTab === 'readiness' && (
        <div className="space-y-5 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h4 className="text-sm font-bold text-foreground">{t('app.sapNative.rcTitle')}</h4>
              <p className="text-sm text-muted-foreground mt-0.5">{t('app.sapNative.rcIntro')}</p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              <Upload className="size-3.5" aria-hidden="true" />
              {t('app.sapNative.chooseFile', { types: '.json' })}
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'readiness')}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{t('app.sapNative.rcContent', { file: rcFileName })}</span>
              <button
                type="button"
                onClick={() => {
                  setRcContent(JSON.stringify({
                    sourceSystem: 'PRD',
                    targetRelease: 'S4H_2023',
                    analysisId: 'RC-ENTERPRISE-2026',
                    simplificationItems: [
                      {
                        id: 'SI25',
                        title: 'Business Partner / Customer-Vendor Integration (CVI)',
                        description: 'CVI synchronization required prior to conversion.',
                        status: 'BLOCKING',
                        note: 'SAP Note 2265093',
                      },
                      {
                        id: 'SI01',
                        title: 'Material Number Field Length Extension',
                        description: 'Compatibility review for 40-character material numbers.',
                        status: 'ACTION_REQUIRED',
                        criticality: 'HIGH',
                        note: 'SAP Note 2267140',
                      }
                    ]
                  }, null, 2));
                  setRcFileName('sample_readiness_check.json');
                }}
                className="text-primary hover:underline text-xs"
              >
                {t('app.sapNative.rcSample')}
              </button>
            </div>
            <textarea
              value={rcContent}
              onChange={(e) => setRcContent(e.target.value)}
              placeholder={t('app.sapNative.rcPlaceholder')}
              aria-label={t('app.sapNative.rcContent', { file: rcFileName })}
              rows={8}
              className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {rcError && (
            <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 text-sm">
              <AlertCircle className="size-4 shrink-0" />
              <span>{rcError}</span>
            </div>
          )}

          {rcResult && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
                <CheckCircle2 className="size-4" />
                <span>{t('app.sapNative.rcDone')}</span>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-muted-foreground">
                <div><dt>{t('app.sapNative.sourceSystem')}</dt><dd className="text-foreground font-bold font-mono">{rcResult.sourceSystem}</dd></div>
                <div><dt>{t('app.sapNative.targetRelease')}</dt><dd className="text-foreground font-bold font-mono">{rcResult.targetRelease}</dd></div>
                <div><dt>{t('app.sapNative.simplificationItems')}</dt><dd className="text-foreground font-bold">{fmt.number(rcResult.simplificationItemsCount)}</dd></div>
                <div><dt>{t('app.sapNative.criticalBlockers')}</dt><dd className="text-rose-600 font-bold">{fmt.number(rcResult.criticalIssuesCount)}</dd></div>
              </dl>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => rcMutation.mutate({ rawContent: rcContent, fileName: rcFileName })}
              disabled={!rcContent.trim() || rcMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {rcMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t('app.sapNative.rcImporting')}
                </>
              ) : (
                <>
                  <Upload className="size-3.5" aria-hidden="true" />
                  {t('app.sapNative.rcImport')}
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Tab: Fiori App Recommendations */}
      {activeSubTab === 'fiori' && (
        <div className="space-y-5 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h4 className="text-sm font-bold text-foreground">{t('app.sapNative.fioriTitle')}</h4>
              <p className="text-sm text-muted-foreground mt-0.5">{t('app.sapNative.fioriIntro')}</p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              <Upload className="size-3.5" aria-hidden="true" />
              {t('app.sapNative.chooseFile', { types: '.csv' })}
              <input
                type="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => handleFileUpload(e, 'fiori')}
              />
            </label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <span>{t('app.sapNative.fioriContent', { file: fioriFileName })}</span>
              <button
                type="button"
                onClick={() => {
                  setFioriContent(`TCODE,FIORI_ID,TITLE,USAGE,CRITICALITY\nVA01,F0842A,Create Sales Orders,15420,CRITICAL\nME21N,F0843,Create Purchase Order,8920,HIGH\nFB01,F0717,Post General Journal Entry,12400,CRITICAL`);
                  setFioriFileName('sample_fiori_usage.csv');
                }}
                className="text-primary hover:underline text-xs"
              >
                {t('app.sapNative.fioriSample')}
              </button>
            </div>
            <textarea
              value={fioriContent}
              onChange={(e) => setFioriContent(e.target.value)}
              placeholder="TCODE,FIORI_ID,TITLE,USAGE,CRITICALITY"
              aria-label={t('app.sapNative.fioriContent', { file: fioriFileName })}
              rows={6}
              className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {fioriError && (
            <div role="alert" className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 text-sm">
              <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
              <span>{fioriError}</span>
            </div>
          )}

          {fioriResult && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-300 font-bold">
                <CheckCircle2 className="size-4" />
                <span>{t('app.sapNative.fioriDone', { count: fioriResult.recordsProcessed ?? 0 })}</span>
              </div>
              <div className="divide-y divide-border/60 font-mono text-xs">
                {fioriResult.recommendations?.map((r: any, idx: number) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between">
                    <span className="font-bold text-foreground">{r.legacyTCode} → {r.fioriAppId} ({r.fioriAppTitle})</span>
                    <span className="text-muted-foreground">{t('app.sapNative.executions', { count: r.usageCount ?? 0 })} • {r.businessCriticality}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => fioriMutation.mutate({ rawContent: fioriContent, fileName: fioriFileName })}
              disabled={!fioriContent.trim() || fioriMutation.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
            >
              {fioriMutation.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                  {t('app.sapNative.fioriImporting')}
                </>
              ) : (
                <>
                  <Upload className="size-3.5" aria-hidden="true" />
                  {t('app.sapNative.fioriImport')}
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
