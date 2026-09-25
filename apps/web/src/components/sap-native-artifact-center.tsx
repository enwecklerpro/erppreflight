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

interface SapNativeArtifactCenterProps {
  projectId: string;
}

export function SapNativeArtifactCenter({ projectId }: SapNativeArtifactCenterProps) {
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
      setAtcError(err.message || 'Failed to import ATC findings.');
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
      setRcError(err.message || 'Failed to import SAP Readiness Check.');
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
      setFioriError(err.message || 'Failed to import Fiori usage profile.');
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
              <FileCheck2 className="h-5 w-5 text-primary" />
              SAP-Native Artifact Center (Part 15.20)
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Directly ingest official SAP exports: ABAP Test Cockpit (ATC) findings, SAP Readiness Check 2.0 simplification items, and Fiori App Recommendations.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2.5 py-1 rounded-md border border-emerald-200 dark:border-emerald-800 flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />
              Baseline Aware (Part 15.13)
            </span>
          </div>
        </div>
      </div>

      {/* Subtabs */}
      <div className="flex border-b border-border space-x-4 text-xs font-semibold">
        <button
          onClick={() => setActiveSubTab('atc')}
          className={`pb-3 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeSubTab === 'atc'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Boxes className="size-4" />
          ATC / Custom Code Analysis (XML/JSON)
        </button>

        <button
          onClick={() => setActiveSubTab('readiness')}
          className={`pb-3 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeSubTab === 'readiness'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Layers className="size-4" />
          SAP Readiness Check 2.0 (JSON)
        </button>

        <button
          onClick={() => setActiveSubTab('fiori')}
          className={`pb-3 flex items-center gap-1.5 border-b-2 transition-colors ${
            activeSubTab === 'fiori'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <Sparkles className="size-4" />
          Fiori App Recommendations (CSV)
        </button>
      </div>

      {/* Tab: ATC Import */}
      {activeSubTab === 'atc' && (
        <div className="space-y-5 bg-card border border-border rounded-xl p-6">
          <div className="flex items-center justify-between border-b border-border pb-4">
            <div>
              <h4 className="text-sm font-bold text-foreground">Import ABAP Test Cockpit Findings</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Upload exported ATC XML or JSON results. Automatically updates Clean Core Object inventory and dedupes findings.
              </p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              <Upload className="size-3.5" />
              Choose File (.xml, .json, .csv)
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
              <span>Payload Content ({atcFileName})</span>
              <button
                type="button"
                onClick={() => {
                  setAtcContent(`<ATC_RESULTS>\n  <FINDING>\n    <OBJECT_NAME>ZCL_PAYMENT_PROCESSOR</OBJECT_NAME>\n    <OBJECT_TYPE>CLAS</OBJECT_TYPE>\n    <PACKAGE>ZFIN</PACKAGE>\n    <CHECK_ID>DB_MUTATION_CHECK</CHECK_ID>\n    <PRIORITY>1</PRIORITY>\n    <MESSAGE>Direct insert into table BKPF forbidden in Clean Core</MESSAGE>\n    <LINE>142</LINE>\n    <COLUMN>5</COLUMN>\n    <SNIPPET>INSERT INTO bkpf VALUES @ls_header.</SNIPPET>\n  </FINDING>\n</ATC_RESULTS>`);
                  setAtcFileName('sample_atc.xml');
                }}
                className="text-primary hover:underline text-[11px]"
              >
                Load Sample ATC Payload
              </button>
            </div>
            <textarea
              value={atcContent}
              onChange={(e) => setAtcContent(e.target.value)}
              placeholder="Paste raw ATC XML, JSON, or CSV content here..."
              rows={8}
              className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {atcError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
              <AlertCircle className="size-4 shrink-0" />
              <span>{atcError}</span>
            </div>
          )}

          {atcResult && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="size-4" />
                <span>ATC Import Successfully Completed</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-slate-300 font-mono">
                <div>Total Parsed: <span className="text-white font-bold">{atcResult.totalParsed}</span></div>
                <div>Objects Cataloged: <span className="text-white font-bold">{atcResult.objectsImported}</span></div>
                <div>Findings Created: <span className="text-white font-bold">{atcResult.findingsCreated}</span></div>
                <div>Baselined / Exempted: <span className="text-white font-bold">{atcResult.baselinedCount}</span></div>
              </div>
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
                  <Loader2 className="size-3.5 animate-spin" />
                  Processing Ingestion...
                </>
              ) : (
                <>
                  <Upload className="size-3.5" />
                  Import ATC Findings
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
              <h4 className="text-sm font-bold text-foreground">Import SAP Readiness Check 2.0</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ingest official JSON export from SAP Readiness Check. Maps Simplification Items and Financial Data Quality.
              </p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              <Upload className="size-3.5" />
              Choose File (.json)
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
              <span>Readiness Check JSON ({rcFileName})</span>
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
                className="text-primary hover:underline text-[11px]"
              >
                Load Sample Readiness JSON
              </button>
            </div>
            <textarea
              value={rcContent}
              onChange={(e) => setRcContent(e.target.value)}
              placeholder="Paste raw SAP Readiness Check JSON content here..."
              rows={8}
              className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {rcError && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs">
              <AlertCircle className="size-4 shrink-0" />
              <span>{rcError}</span>
            </div>
          )}

          {rcResult && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="size-4" />
                <span>Readiness Check Ingestion Successful</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 text-slate-300 font-mono">
                <div>Source System: <span className="text-white font-bold">{rcResult.sourceSystem}</span></div>
                <div>Target Release: <span className="text-white font-bold">{rcResult.targetRelease}</span></div>
                <div>Simplification Items: <span className="text-white font-bold">{rcResult.simplificationItemsCount}</span></div>
                <div>Critical Blockers: <span className="text-rose-400 font-bold">{rcResult.criticalIssuesCount}</span></div>
              </div>
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
                  <Loader2 className="size-3.5 animate-spin" />
                  Correlating Simplification Items...
                </>
              ) : (
                <>
                  <Upload className="size-3.5" />
                  Import Readiness Check
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
              <h4 className="text-sm font-bold text-foreground">Import Fiori App Recommendations & Usage</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Ingest ST03N transaction usage CSV to correlate legacy transactions with target Fiori apps.
              </p>
            </div>
            <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg border border-border transition-colors">
              <Upload className="size-3.5" />
              Choose File (.csv)
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
              <span>Usage Profile CSV ({fioriFileName})</span>
              <button
                type="button"
                onClick={() => {
                  setFioriContent(`TCODE,FIORI_ID,TITLE,USAGE,CRITICALITY\nVA01,F0842A,Create Sales Orders,15420,CRITICAL\nME21N,F0843,Create Purchase Order,8920,HIGH\nFB01,F0717,Post General Journal Entry,12400,CRITICAL`);
                  setFioriFileName('sample_fiori_usage.csv');
                }}
                className="text-primary hover:underline text-[11px]"
              >
                Load Sample Fiori Usage CSV
              </button>
            </div>
            <textarea
              value={fioriContent}
              onChange={(e) => setFioriContent(e.target.value)}
              placeholder="TCODE,FIORI_ID,TITLE,USAGE,CRITICALITY"
              rows={6}
              className="w-full rounded-lg border border-border bg-background p-3 text-xs font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {fioriResult && (
            <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs space-y-2">
              <div className="flex items-center gap-2 text-emerald-400 font-bold">
                <CheckCircle2 className="size-4" />
                <span>Fiori Usage Profile Processed ({fioriResult.recordsProcessed} mappings)</span>
              </div>
              <div className="divide-y divide-border/60 font-mono text-xs">
                {fioriResult.recommendations?.map((r: any, idx: number) => (
                  <div key={idx} className="py-1.5 flex items-center justify-between">
                    <span className="font-bold text-white">{r.legacyTCode} → {r.fioriAppId} ({r.fioriAppTitle})</span>
                    <span className="text-muted-foreground">{r.usageCount} executions • {r.businessCriticality}</span>
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
                  <Loader2 className="size-3.5 animate-spin" />
                  Processing Mappings...
                </>
              ) : (
                <>
                  <Upload className="size-3.5" />
                  Import Fiori Mappings
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
