'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  FileCode,
  ShieldCheck,
  DownloadCloud,
  FileSpreadsheet,
  Terminal,
  HelpCircle,
  ExternalLink,
  Lock,
  Layers,
  Search,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';

interface ArtifactFamily {
  id: string;
  name: string;
  category: string;
  formats: string[];
  engines: string[];
  transactions: string[];
  summary: string;
  exportSteps: string[];
  sanitizationNote: string;
}

const ARTIFACT_FAMILIES: ArtifactFamily[] = [
  {
    id: 'opd-matrix',
    name: 'Output Parameter Determination (OPD) Decision Tables',
    category: 'Output & Extensibility',
    formats: ['.xml', '.xlsx', '.json'],
    engines: ['OPD_GUARD', 'FORM_DOCTOR'],
    transactions: ['BRF+', 'OPD'],
    summary: 'Decision table rules for document types, dispatch channels (EMAIL, PRINT, EDI), email recipients, and sender addresses.',
    exportSteps: [
      'Execute transaction OPD in S/4HANA.',
      'Select the target application business object (e.g. BILLING_DOCUMENT or PURCHASE_ORDER).',
      'Under table operations, select Export -> Decision Table to XML / Excel format.',
      'Ensure all decision steps (Output Type, Receiver, Channel, Printer Settings, Email Settings) are included.',
    ],
    sanitizationNote: 'Recipients and email domains undergo automatic client-side SHA-256 HMAC pseudonymization prior to analysis.',
  },
  {
    id: 'form-xdp',
    name: 'Adobe Document Services (ADS) Form Layouts & XML',
    category: 'Output & Extensibility',
    formats: ['.xml', '.xdp', '.pdf'],
    engines: ['FORM_DOCTOR', 'CUSTOM_FIELD_FLOW_DOCTOR'],
    transactions: ['SFP', 'SE80'],
    summary: 'Interactive and print Adobe LiveCycle XDP form templates with field data bindings, subforms, and font definitions.',
    exportSteps: [
      'Open transaction SFP (Form Builder).',
      'Enter Form Name (e.g. S4H_INVOICE_LAYOUT).',
      'Navigate to Layout -> Tools -> Export Layout as XDP XML.',
      'Alternatively, export the interface context schema XML via Context -> Export XML Schema.',
    ],
    sanitizationNote: 'Sensitive test invoice values and customer PII are redacted using Shannon entropy and pattern scrubbers.',
  },
  {
    id: 'custom-code-abapgit',
    name: 'Custom Code Repository (abapGit Export)',
    category: 'Migration & Clean Core',
    formats: ['.zip', '.abap', '.xml'],
    engines: ['CLEAN_CORE_OBJECT_GUARD', 'EXTENSION_IMPACT_GUARD'],
    transactions: ['SE80', 'abapGit', 'SE38'],
    summary: 'Custom Z and Y packages, BAdI implementations, CDS views, and ABAP classes for Clean Core tier compliance verification.',
    exportSteps: [
      'Install or launch abapGit in development system (transaction SE38 -> ZABAPGIT).',
      'Select the target custom development package (e.g. ZCORE_MIGRATION).',
      'Select "Export as ZIP" from the repository menu.',
      'Save the resulting archive locally.',
    ],
    sanitizationNote: 'Embedded database credentials, RFC passwords, and hardcoded tokens are automatically replaced with deterministic tokens.',
  },
  {
    id: 'spro-cbc-config',
    name: 'SPRO / IMG Configuration Tables',
    category: 'Migration & Clean Core',
    formats: ['.csv', '.xlsx', '.json'],
    engines: ['SPRO2CLOUD', 'SAP_GAP_RADAR'],
    transactions: ['SPRO', 'SE16N', 'SCU3'],
    summary: 'Customizing configuration tables (e.g. T001G, T005, TVKO, T161) mapping legacy business rules to Cloud CBC / SSCUI.',
    exportSteps: [
      'In transaction SPRO, navigate to the target customizing activity.',
      'Choose Table View -> Print / Export -> Local File (Spreadsheet or Delimited text).',
      'Alternatively, use SE16N with the customizing table name and export all non-SAP client records.',
    ],
    sanitizationNote: 'Client-specific business entity identifiers can be masked via organization privacy settings.',
  },
  {
    id: 'api-metadata',
    name: 'OData & SOAP API Service Metadata',
    category: 'Integration',
    formats: ['.edmx', '.xml', '.wsdl', '.yaml'],
    engines: ['API_CHANGE_GUARD'],
    transactions: ['/IWFND/GW_CLIENT', 'SOAMANAGER', 'SE80'],
    summary: 'Complete Entity Data Model (EDMX) or WSDL specifications defining API contracts, entity sets, and mandatory parameters.',
    exportSteps: [
      'In transaction /IWFND/GW_CLIENT, enter service URL with $metadata query (e.g. /sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata).',
      'Execute request and select File -> Export Response Body as XML.',
      'For SOAP services, open SOAMANAGER, select the web service, and download the WSDL file.',
    ],
    sanitizationNote: 'Authentication headers, API keys, and session cookies are stripped during file ingestion validation.',
  },
  {
    id: 'transport-requests',
    name: 'CTS Transport Request Object List',
    category: 'Release & Transport',
    formats: ['.csv', '.txt', '.json'],
    engines: ['TRANSPORT_DEPENDENCY_ANALYZER', 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD'],
    transactions: ['SE09', 'SE10', 'STMS'],
    summary: 'Transport request headers, task item lists (E070 / E071), and target release software collection manifests.',
    exportSteps: [
      'In transaction SE01 or SE09, enter transport request numbers (e.g. TRK900100 through TRK900110).',
      'Select Display -> Request -> Object List -> Export to Local File (Tab-delimited text or CSV).',
      'Include all sub-tasks and piece-list entries for comprehensive cross-transport dependency preflight.',
    ],
    sanitizationNote: 'Developer usernames and system names are preserved for dependency tracing but excluded from public summaries.',
  },
  {
    id: 'mfs-telegrams',
    name: 'SAP EWM MFS Telegram Buffers & Logs',
    category: 'Warehouse Automation',
    formats: ['.csv', '.log', '.txt'],
    engines: ['MFS_BLACKBOX'],
    transactions: ['/SCWM/MFS_TELE', '/SCWM/MON'],
    summary: 'High-speed PLC telegram transmissions between SAP EWM and automated warehouse conveyor/stacker crane controllers.',
    exportSteps: [
      'Open SAP EWM Warehouse Management Monitor (transaction /SCWM/MON).',
      'Navigate to Material Flow System (MFS) -> Telegrams.',
      'Specify the relevant time window (e.g. 15 minutes before and during the warehouse stall incident).',
      'Select List -> Export -> Spreadsheet or Delimited text file.',
    ],
    sanitizationNote: 'Handling unit barcodes and warehouse personnel IDs can be scrambled using deterministic SHA-256 tokens.',
  },
  {
    id: 'change-pointer-tbd52',
    name: 'BD21 / BD52 Change Pointer Configuration',
    category: 'Integration',
    formats: ['.csv', '.json', '.xml'],
    engines: ['CHANGE_POINTER_COVERAGE_AUDITOR'],
    transactions: ['BD52', 'BD21', 'BD50'],
    summary: 'Change document object and table field triggers configuring asynchronous event notifications for external systems.',
    exportSteps: [
      'In transaction BD52, enter Message Type (e.g. MATMAS or DEBMAS).',
      'Export the configured field list (Table Name, Field Name) to a CSV or Excel file.',
      'Ensure active message type status in transaction BD50 is captured.',
    ],
    sanitizationNote: 'Only structural table and field names are required; zero business payload values are ingested.',
  },
];

export default function ArtifactsPage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('ALL');

  const categories = [
    'ALL',
    'Output & Extensibility',
    'Migration & Clean Core',
    'Integration',
    'Release & Transport',
    'Warehouse Automation',
  ];

  const filteredArtifacts = ARTIFACT_FAMILIES.filter((art) => {
    const matchesCategory = selectedCategory === 'ALL' || art.category === selectedCategory;
    const matchesSearch =
      art.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      art.transactions.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())) ||
      art.engines.some((e) => e.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
            Part 15.20 SAP-Native Artifact Center
          </span>
          <span className="text-xs text-muted-foreground font-mono">Zero Customer PII Retention</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Supported Artifact Formats (Documentation)
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          This reference guide outlines the supported SAP artifacts, extraction procedures, and security redaction policies for the preflight engines. Actual artifact ingestion is performed dynamically within individual project workspaces.
        </p>
      </div>

      {/* Security Banner */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-emerald-500 shrink-0" />
          <div className="text-xs space-y-0.5">
            <span className="font-bold text-foreground">Automated Secret & PII Redaction Active</span>
            <p className="text-muted-foreground">
              Every uploaded artifact undergoes streaming ClamAV antivirus scanning, magic bytes format verification, and Shannon entropy credential scrubbing before parsing.
            </p>
          </div>
        </div>
        <Link
          href="/trust"
          className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline shrink-0"
        >
          View Enterprise Trust Center →
        </Link>
      </div>

      {/* Search and Category Filter */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search artifacts, transaction codes (e.g. SFP, OPD)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedCategory === cat
                  ? 'bg-primary text-white font-semibold shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {cat === 'ALL' ? 'All Categories' : cat}
            </button>
          ))}
        </div>
      </div>

      {/* Artifact Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {filteredArtifacts.map((art) => (
          <div
            key={art.id}
            className="rounded-xl border border-border bg-card p-6 flex flex-col justify-between hover:border-primary/50 transition-all shadow-sm space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    {art.category}
                  </span>
                  <h3 className="text-base font-bold text-foreground mt-0.5">{art.name}</h3>
                </div>
                <div className="flex gap-1 shrink-0">
                  {art.formats.map((fmt) => (
                    <span
                      key={fmt}
                      className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                    >
                      {fmt}
                    </span>
                  ))}
                </div>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">{art.summary}</p>

              {/* Transactions */}
              <div className="flex items-center gap-2 pt-1">
                <span className="text-[10px] font-bold uppercase text-muted-foreground">SAP T-Codes:</span>
                <div className="flex gap-1">
                  {art.transactions.map((t) => (
                    <span
                      key={t}
                      className="font-mono text-[11px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-900/50"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>

              {/* Export Steps Accordion / Details */}
              <div className="p-3 bg-muted/40 rounded-lg border border-border/60 text-xs space-y-1.5">
                <div className="font-semibold text-foreground flex items-center gap-1.5">
                  <Terminal className="h-3.5 w-3.5 text-primary" />
                  <span>How to Export from SAP</span>
                </div>
                <ol className="list-decimal pl-4 space-y-1 text-muted-foreground text-[11px]">
                  {art.exportSteps.map((step, idx) => (
                    <li key={idx}>{step}</li>
                  ))}
                </ol>
              </div>

              {/* Redaction Guarantee */}
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground pt-1">
                <Lock className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <span className="italic">{art.sanitizationNote}</span>
              </div>
            </div>

            {/* Target Engines & Action */}
            <div className="pt-4 border-t border-border flex items-center justify-between">
              <div className="flex items-center gap-1">
                <span className="text-[10px] font-bold text-muted-foreground uppercase">Engines:</span>
                <span className="font-mono text-[10px] text-foreground font-semibold">
                  {art.engines.join(', ')}
                </span>
              </div>
              <Link
                href="/projects"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-blue-600 transition-colors shadow-sm"
              >
                <span>Upload in Workspace</span>
                <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
