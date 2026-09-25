import React from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  FileCode,
  FileSpreadsheet,
  Database,
  ExternalLink,
} from 'lucide-react';

interface KnowledgeArticle {
  title: string;
  problemSummary: string;
  targetRelease: string;
  engine: string;
  rootCause: string;
  remediationSteps: string[];
  evidenceSnippet: string;
  toolCta: string;
  toolCtaLink: string;
}

const KNOWLEDGE_ARTICLES: Record<string, KnowledgeArticle> = {
  'sap-purchase-order-email-not-sent': {
    title: 'Troubleshooting: SAP S/4HANA Purchase Order Email Not Sent via OPD',
    problemSummary: 'Output determination in S/4HANA fails to trigger outbound email dispatch for newly created purchase orders, leaving the output item in state "In Preparation" or unmapped.',
    targetRelease: 'SAP S/4HANA 2020..2025, Cloud 2408/2502',
    engine: 'OPD_GUARD',
    rootCause: 'BRFplus Output Parameter Determination decision table rules evaluate in strict top-to-bottom sequence. A missing condition row for purchasing organization or an unassigned email template channel drops the dispatch step.',
    remediationSteps: [
      'Execute transaction OPD in your SAP system.',
      'Select Show Rules for "Purchase Order" and Determination Step "Email Recipient".',
      'Verify condition rows for your Purchasing Organization (e.g. 1010). Ensure rule entry exists mapping Buyer to recipient type TO.',
      'Check Determination Step "Output Channel" to confirm EMAIL is designated as active.',
      'Validate email template assignment in step "Email Settings" (default: MMPUR_PO_BUYER_DEFAULT).',
    ],
    evidenceSnippet: `<DecisionTableRow id="ROW_42">\n  <Condition>PURCHASING_ORG=1010</Condition>\n  <Channel>NONE</Channel> <!-- Output channel missing -->\n</DecisionTableRow>`,
    toolCta: 'Run OPD Guard Preflight',
    toolCtaLink: '/login',
  },
  'sap-custom-field-not-showing-in-invoice-pdf': {
    title: 'Fix: SAP Custom Field (YY1_) Not Showing in Customer Invoice PDF',
    problemSummary: 'A custom field created via the Custom Fields and Logic app appears on the SAP Fiori Manage Billing Documents screen, but fails to print on the generated Adobe Form PDF output.',
    targetRelease: 'SAP S/4HANA 2021, 2022, 2023',
    engine: 'FORM_DOCTOR',
    rootCause: 'The custom field was unpublished in the Form Interface context or the Adobe Document Services (ADS) XDP schema binding is referencing an obsolete XML namespace.',
    remediationSteps: [
      'In the Custom Fields and Logic Fiori app, locate custom field YY1_*.',
      'Navigate to the "Form Templates" tab and enable usage for Billing Document Form Template.',
      'Click "Publish" to regenerate the active dictionary includes.',
      'In transaction SFP, open form interface SD_INVOICE_INTERFACE and drag the new field from the ABAP dictionary into the active Form Context.',
      'In Adobe LiveCycle Designer, ensure the dataRef attribute points directly to $.Invoice.Header.YY1_*.',
    ],
    evidenceSnippet: `<field name="CustomClassification" access="readOnly">\n  <bind match="dataRef" ref="$.Invoice.Header.YY1_CLASS"/>\n</field>`,
    toolCta: 'Analyze with FormDoctor',
    toolCtaLink: '/login',
  },
  'is-mara-released-in-abap-cloud': {
    title: 'Clean Core Guide: Is Table MARA Released in ABAP Cloud / Tier 1 Extensibility?',
    problemSummary: 'Direct SQL queries (SELECT, INSERT, UPDATE) against standard table MARA in modern SAP development trigger Clean Core and ATC governance violations.',
    targetRelease: 'SAP S/4HANA 2022, 2023, 2025 (ABAP Cloud)',
    engine: 'CLEAN_CORE_OBJECT_GUARD',
    rootCause: 'Under SAP Clean Core Tier 1 (ABAP Cloud Development Language Version), classic database tables like MARA, VBAK, and BKPF are not released for direct access to preserve cloud upgrade stability.',
    remediationSteps: [
      'Replace direct MARA queries with released CDS View Entity I_Product.',
      'For plant-specific data, join with released CDS View Entity I_ProductPlant.',
      'For creating or modifying products, utilize released RAP Business Object I_ProductTP via EML (Entity Manipulation Language).',
    ],
    evidenceSnippet: `// Classic Tier 3 Violation:\nSELECT * FROM mara INTO TABLE @DATA(lt_mara) WHERE matnr = @p_matnr.\n\n// Clean Core Tier 1 Replacement:\nSELECT * FROM I_Product INTO TABLE @DATA(lt_product) WHERE Product = @p_product.`,
    toolCta: 'Scan ABAP for Clean Core',
    toolCtaLink: '/login',
  },
  'sap-ecc-spro-to-sscui': {
    title: 'Migration Reference: Mapping Legacy ECC SPRO Customizing to S/4HANA Cloud SSCUI',
    problemSummary: 'During migration from SAP ECC 6.0 to S/4HANA Cloud Public Edition, traditional SPRO transaction codes and IMG paths are superseded by Central Business Configuration (CBC) activities.',
    targetRelease: 'SAP S/4HANA Cloud Public Edition 2408, 2502',
    engine: 'SPRO2CLOUD',
    rootCause: 'Many classic customizing tables (e.g. T001, T001G) are managed via cloud configuration activities (SSCUI) with restricted schema scopes.',
    remediationSteps: [
      'Export custom configuration tables via transaction SE16 or SPRO extract.',
      'Upload the CSV extract into ERP Preflight SPRO2Cloud engine.',
      'Review deterministic mappings from IMG nodes to SSCUI activity IDs (e.g. SSCUI 100135 for Accounting Principles).',
      'For gap activities with no 1:1 successor, apply approved Cloud BAdI workarounds.',
    ],
    evidenceSnippet: `Legacy IMG Node: SPRO -> Financial Accounting -> General Ledger -> Master Data -> G/L Accounts\nSuccessor SSCUI: 100135 (Define Settings for Accounting Principles)\nCoverage Status: VERIFIED_MAPPED`,
    toolCta: 'Run SPRO2Cloud Migration Scan',
    toolCtaLink: '/login',
  },
};

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = KNOWLEDGE_ARTICLES[slug];

  if (!article) {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-6 font-medium">
          <Link href="/" className="hover:text-emerald-400">Home</Link>
          <span>/</span>
          <Link href="/matrix" className="hover:text-emerald-400">Knowledge</Link>
          <span>/</span>
          <span className="text-slate-300 truncate">{slug}</span>
        </div>

        {/* Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8 shadow-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            <BookOpen className="w-3.5 h-3.5" />
            Verified Preflight Resolution Guide
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-3">
            {article.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-4">
            <span>Target Scope: <strong className="text-cyan-400 font-mono">{article.targetRelease}</strong></span>
            <span>•</span>
            <span>Engine: <strong className="text-emerald-400 font-mono">{article.engine}</strong></span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            {article.problemSummary}
          </p>
        </div>

        {/* Root Cause & Remediation */}
        <div className="space-y-6 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Technical Root Cause
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">{article.rootCause}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Verified Technical Remediation Steps
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300">
              {article.remediationSteps.map((step, idx) => (
                <li key={idx} className="leading-relaxed">{step}</li>
              ))}
            </ol>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-cyan-400" />
              Deterministic Evidence Pattern
            </h2>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-400 overflow-x-auto">
              {article.evidenceSnippet}
            </pre>
          </div>
        </div>

        {/* CTA Card */}
        <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Verify Your Own SAP Landscape</h3>
            <p className="text-xs text-slate-300">Run our automated {article.engine} preflight scan with cryptographic evidence.</p>
          </div>
          <Link
            href={article.toolCtaLink}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 whitespace-nowrap transition-colors"
          >
            {article.toolCta}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
