'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  FolderGit2,
  UploadCloud,
  History,
  Play,
  Layers,
  CheckCircle,
  FileText,
  ShieldAlert,
  Boxes,
  ArrowRight,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';
import { ALL_18_ENGINES } from '../../../lib/api-client';

export default function ProjectWorkspacePage() {
  const params = useParams();
  const rawId = params?.id as string;
  const projectId = rawId || '1a91cf25-87a4-4a41-b0db-6e69001b9201';

  const [activeTab, setActiveTab] = useState<
    'overview' | 'findings' | 'objects' | 'artifacts' | 'history' | 'launcher'
  >('overview');
  const [selectedEngines, setSelectedEngines] = useState<string[]>([
    'OPD_GUARD',
    'CLEAN_CORE_OBJECT_GUARD',
    'FORM_DOCTOR',
  ]);
  const [isLaunching, setIsLaunching] = useState(false);
  const [launchSuccess, setLaunchSuccess] = useState(false);

  const toggleEngine = (id: string) => {
    setSelectedEngines((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]
    );
  };

  const handleLaunch = () => {
    setIsLaunching(true);
    setTimeout(() => {
      setIsLaunching(false);
      setLaunchSuccess(true);
      setTimeout(() => setLaunchSuccess(false), 5000);
    }, 1200);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-border pb-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-6 w-6 text-primary" />
              <h1 className="text-xl sm:text-2xl font-extrabold text-foreground">
                S/4HANA 2023 Enterprise Migration Preflight
              </h1>
            </div>
            <p className="text-xs text-muted-foreground mt-1 font-mono">
              Workspace ID: {projectId} • Target Release: S/4HANA 2023
            </p>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('launcher')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition-colors shadow-sm"
            >
              <Play className="h-3.5 w-3.5" />
              Launch Analysis
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border mt-6 space-x-4 sm:space-x-6 text-xs font-medium overflow-x-auto">
          {[
            { id: 'overview', label: 'Overview', icon: Layers },
            { id: 'findings', label: 'Findings', icon: ShieldAlert },
            { id: 'objects', label: 'Objects', icon: Boxes },
            { id: 'artifacts', label: 'Artifact Dropzone', icon: UploadCloud },
            { id: 'history', label: 'Run History', icon: History },
            { id: 'launcher', label: 'Analysis Launcher', icon: Play },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`pb-3 flex items-center gap-2 font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  active
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab: Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Clean Core Health Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Clean Core Health Score
              </h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">87.4%</span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  Target: &gt;85%
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Tier 1 / Tier 2 cloud extensibility compliance across custom repository.
              </p>
            </div>

            {/* Findings Link Card */}
            <Link
              href={`/projects/${projectId}/findings`}
              className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/60 transition-all group block"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Preflight Findings
                </h3>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">3</span>
                <span className="text-xs font-semibold text-amber-700 bg-amber-50 dark:bg-amber-950 dark:text-amber-300 px-2 py-0.5 rounded flex items-center gap-1 border border-amber-200 dark:border-amber-800">
                  1 Blocker • 1 Critical
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                View cryptographic SHA-256 evidence ledger & Clean Core remediation &rarr;
              </p>
            </Link>

            {/* Objects Link Card */}
            <Link
              href={`/projects/${projectId}/objects`}
              className="bg-card border border-border rounded-xl p-5 shadow-sm hover:border-primary/60 transition-all group block"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                  Object Inventory
                </h3>
                <ArrowRight className="size-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground font-mono">10,000+</span>
                <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 dark:bg-emerald-950 dark:text-emerald-300 px-2 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                  74.2% Clean
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Browse virtualized catalog & Clean Core tier classifications &rarr;
              </p>
            </Link>

            {/* Staged Artifacts Card */}
            <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
              <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
                Staged Artifacts
              </h3>
              <div className="mt-3 flex items-baseline gap-2">
                <span className="text-3xl font-bold text-foreground">4</span>
                <span className="text-xs font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
                  Clean Quarantine
                </span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                BRFplus XML, Smart Forms XML, and custom ABAP packages.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Findings (Navigation Card & Direct Links) */}
      {activeTab === 'findings' && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-red-50 dark:bg-red-950/60 text-red-600 rounded-xl border border-red-200 dark:border-red-900">
                  <ShieldAlert className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    Preflight Findings Ledger & Cryptographic Evidence
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Explore all detected violations, Clean Core deviations, and cryptographic proofs.
                  </p>
                </div>
              </div>

              <Link
                href={`/projects/${projectId}/findings`}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-dark transition-colors shadow-sm shrink-0"
              >
                <span>Open Full Findings Ledger</span>
                <ExternalLink className="size-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Blockers Detected</span>
                <span className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1 block">1</span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  OPD channel missing in decision table
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Critical Defects</span>
                <span className="text-2xl font-bold text-orange-600 dark:text-orange-400 mt-1 block">1</span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Direct UPDATE to standard table ACDOCA
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Major Deprecations</span>
                <span className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1 block">1</span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Obsolete non-Unicode script elements in Smart Form
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Objects (Navigation Card & Direct Links) */}
      {activeTab === 'objects' && (
        <div className="space-y-6">
          <div className="bg-card border border-border rounded-2xl p-6 sm:p-8 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-6">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-blue-50 dark:bg-blue-950/60 text-primary rounded-xl border border-blue-200 dark:border-blue-900">
                  <Boxes className="size-6" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-foreground">
                    SAP Custom Object Inventory & Clean Core Catalog
                  </h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Virtualized high-capacity catalog of 10,000+ custom SAP development assets.
                  </p>
                </div>
              </div>

              <Link
                href={`/projects/${projectId}/objects`}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-dark transition-colors shadow-sm shrink-0"
              >
                <span>Open Virtualized Inventory</span>
                <ExternalLink className="size-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Catalog Scale</span>
                <span className="text-2xl font-bold text-foreground font-mono mt-1 block">10,000+</span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  PROG, CLAS, TABL, CDS, FUGR, INTF, FORM
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Clean Core Rate</span>
                <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1 block">74.2%</span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Tier 1 Cloud & Tier 2 Developer Extensibility
                </span>
              </div>
              <div className="p-4 rounded-xl border border-border bg-muted/20">
                <span className="text-xs font-semibold text-muted-foreground block">Classic Modifications</span>
                <span className="text-2xl font-bold text-rose-600 dark:text-rose-400 mt-1 block">142</span>
                <span className="text-[11px] text-muted-foreground mt-1 block">
                  Direct database mutations requiring refactoring
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab: Artifact Dropzone */}
      {activeTab === 'artifacts' && (
        <div className="space-y-6">
          <div className="border-2 border-dashed border-border hover:border-primary/60 transition-colors rounded-2xl p-8 text-center bg-card flex flex-col items-center justify-center">
            <div className="p-4 bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 rounded-full">
              <UploadCloud className="h-8 w-8" />
            </div>
            <h3 className="text-base font-bold text-foreground mt-4">
              Drag & Drop SAP Artifacts
            </h3>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Supports XML, JSON, CSV, ZIP, ABAP text, XDP, and WSDL. Automatic magic-byte validation, XXE defense, and credential redaction.
            </p>
            <button
              onClick={() => alert('Artifact upload simulated')}
              className="mt-5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition-colors shadow-sm"
            >
              Browse Local Files
            </button>
          </div>

          <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-bold text-foreground mb-4">
              Staged Artifacts
            </h3>
            <div className="divide-y divide-border text-xs">
              {[
                { name: 'billing_opd_rules.xml', size: '1.2 MB', status: 'CLEAN', sha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08' },
                { name: 'zgl_posting.prog.abap', size: '48 KB', status: 'CLEAN', sha256: '5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8' },
                { name: 'zinvoice_v2.xml', size: '340 KB', status: 'CLEAN', sha256: '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' },
              ].map((art, idx) => (
                <div key={idx} className="py-3 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <span className="font-semibold text-foreground">{art.name}</span>
                      <span className="text-[10px] text-muted-foreground ml-2 font-mono">
                        ({art.size})
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-mono text-muted-foreground hidden md:inline">
                      SHA-256: {art.sha256.slice(0, 16)}...
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                      {art.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab: Run History */}
      {activeTab === 'history' && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h3 className="text-sm font-bold text-foreground mb-4">
            Analysis Execution Ledger
          </h3>
          <div className="divide-y divide-border text-xs">
            {[
              { id: 'run-9021', date: '2026-09-24 01:15 UTC', engines: 3, findings: 3, status: 'COMPLETED', user: 'Lead Architect' },
              { id: 'run-8994', date: '2026-09-23 18:40 UTC', engines: 18, findings: 14, status: 'COMPLETED', user: 'Migration Consultant' },
            ].map((run) => (
              <div key={run.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground">{run.id}</span>
                    <span className="text-muted-foreground">• {run.date}</span>
                  </div>
                  <p className="text-muted-foreground mt-0.5">
                    Evaluated {run.engines} engines • {run.findings} findings detected • Triggered by {run.user}
                  </p>
                </div>
                <span className="px-2.5 py-0.5 text-xs font-semibold rounded bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300">
                  {run.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Analysis Launcher */}
      {activeTab === 'launcher' && (
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm space-y-6">
          <div>
            <h3 className="text-base font-bold text-foreground">
              Configure & Trigger Preflight Assessment
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Select which engines to execute against the staged customer artifacts.
            </p>
          </div>

          {launchSuccess && (
            <div className="p-4 rounded-lg bg-green-50 border border-green-200 text-green-800 text-xs flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Preflight analysis job enqueued successfully! Results are populated in findings ledger.
            </div>
          )}

          <div>
            <label className="text-xs font-bold text-foreground">
              Select Preflight Engines ({selectedEngines.length} of {ALL_18_ENGINES.length} selected)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 mt-3">
              {ALL_18_ENGINES.map((eng) => {
                const selected = selectedEngines.includes(eng.id);
                return (
                  <button
                    type="button"
                    key={eng.id}
                    onClick={() => toggleEngine(eng.id)}
                    className={`p-3 rounded-lg border text-left transition-all text-xs flex items-start justify-between ${
                      selected
                        ? 'border-primary bg-blue-50/60 dark:bg-blue-950/40 text-foreground font-semibold'
                        : 'border-border bg-background text-muted-foreground hover:border-border/80'
                    }`}
                  >
                    <div>
                      <div className="text-foreground">{eng.name}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">{eng.domain}</div>
                    </div>
                    {selected && <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0 ml-2" />}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="pt-4 border-t border-border flex justify-end">
            <button
              onClick={handleLaunch}
              disabled={isLaunching || selectedEngines.length === 0}
              className="px-5 py-2.5 bg-primary text-white text-xs font-bold rounded-lg hover:bg-primary-dark transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
            >
              <Play className="h-3.5 w-3.5" />
              {isLaunching ? 'Dispatching to Queue...' : 'Execute Preflight Run'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
