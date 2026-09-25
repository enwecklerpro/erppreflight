'use client';

import React from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  FileText,
  Server,
  Download,
  Lock,
  ExternalLink,
  CheckCircle2,
  Cpu,
  Layers,
  HelpCircle,
} from 'lucide-react';

interface ProcurementDocument {
  title: string;
  category: string;
  format: string;
  size: string;
  summary: string;
  lastUpdated: string;
  details: string[];
}

const PROCUREMENT_DOCS: ProcurementDocument[] = [
  {
    title: 'Enterprise Information Security Overview',
    category: 'Security & Compliance',
    format: 'PDF',
    size: '1.4 MB',
    summary: 'Comprehensive audit overview of ERP Preflight tenant isolation, PostgreSQL Row-Level Security (RLS), and zero-retention artifact quarantine gates.',
    lastUpdated: 'September 2026',
    details: [
      'Multi-tenant architecture enforcing get_current_tenant_id() RLS on every database query',
      'Argon2id password hashing with timeCost=2, memoryCost=19456, parallelism=1',
      'Automated ClamAV daemon INSTREAM streaming scanning (TCP port 3310) fail-closed',
      'Encrypted transit via TLS 1.3 and AES-256 GCM storage encryption at rest',
    ],
  },
  {
    title: 'High-Level Architecture & End-to-End Data Flow Diagram',
    category: 'Architecture & Infrastructure',
    format: 'PDF / SVG',
    size: '2.1 MB',
    summary: 'Detailed network topology illustrating browser interaction, Next.js web frontend, NestJS API gateway, BullMQ Redis queues, and Python stateless engines.',
    lastUpdated: 'September 2026',
    details: [
      'Strict service boundaries: Web -> API -> Redis/BullMQ -> Python Analysis Service',
      'Stateless analysis microservice with zero direct database connection or credentials',
      'Pre-signed upload URLs restricted to quarantine S3 bucket with 15-minute TTL',
      'Non-root container execution across all Docker services with minimal scratch bases',
    ],
  },
  {
    title: 'Subprocessor & Infrastructure Directory',
    category: 'Privacy & Data Protection',
    format: 'PDF / JSON',
    size: '420 KB',
    summary: 'List of authorized cloud hosting infrastructure providers, data storage regions, and independent platform subprocessors.',
    lastUpdated: 'September 2026',
    details: [
      'Hostinger Cloud Infrastructure (Frankfurt, Germany - EU Data Residency)',
      'Self-hosted MinIO object storage cluster with multi-tenant namespace prefixes',
      'Self-hosted PostgreSQL 16 + pgvector instance with automated daily snapshots',
      'Zero third-party AI provider data sharing without explicit customer opt-in',
    ],
  },
  {
    title: 'Data Processing Agreement (DPA) Template',
    category: 'Legal & Procurement',
    format: 'DOCX / PDF',
    size: '650 KB',
    summary: 'Standard GDPR-compliant Data Processing Agreement including standard contractual clauses (SCCs) and customer data protection covenants.',
    lastUpdated: 'September 2026',
    details: [
      'Customer retains 100% intellectual property ownership of all analyzed SAP artifacts',
      'Immediate data erasure upon workspace or project deletion (Part 18.26)',
      'Deterministic-only execution mode completely bypassing LLM inference',
      'Comprehensive security breach notification policy within 24 hours of confirmation',
    ],
  },
  {
    title: 'Service Level Agreement (SLA) & Disaster Recovery Runbook',
    category: 'Operations & Reliability',
    format: 'PDF',
    size: '880 KB',
    summary: 'Operational uptime commitments (99.9% availability), disaster recovery RPO/RTO objectives, and automated failover runbooks.',
    lastUpdated: 'September 2026',
    details: [
      'Recovery Point Objective (RPO) <= 1 hour via continuous PostgreSQL WAL archiving',
      'Recovery Time Objective (RTO) <= 4 hours for full cluster restoration',
      '24/7 automated synthetic heartbeat probes across public health check endpoints',
      'Severity 1 incident response SLA within 15 minutes for enterprise accounts',
    ],
  },
  {
    title: 'Software Bill of Materials (SBOM) Summary',
    category: 'Software Supply Chain',
    format: 'CycloneDX JSON',
    size: '310 KB',
    summary: 'Machine-readable software inventory tracking all direct and transitive dependencies with license compliance and vulnerability status.',
    lastUpdated: 'September 2026',
    details: [
      'Automated Trivy container scanning with zero unaccepted CRITICAL vulnerabilities',
      'Gitleaks secret scanner active across every git commit and pull request pipeline',
      'Single curated library per concern (No-Dependency-Soup policy enforced by CI gate)',
      'Full lockfile verification across all pnpm workspace packages and Python wheels',
    ],
  },
];

export default function ProcurementPage() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
            Part 14.42 Enterprise Readiness
          </span>
          <span className="text-xs text-muted-foreground font-mono">SOC 2 & ISO 27001 Prepared</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Enterprise Procurement Documentation
        </h1>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Static reference of pre-approved security documentation, architecture whitepapers, DPA templates, and software supply chain attestations designed to accelerate enterprise vendor risk assessment.
        </p>
      </div>

      {/* Trust Highlights */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Data Residency</span>
          <p className="text-base font-bold text-foreground">European Union (Frankfurt)</p>
          <p className="text-xs text-muted-foreground">GDPR compliant hostinger VPS</p>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Tenant Isolation</span>
          <p className="text-base font-bold text-foreground">PostgreSQL RLS</p>
          <p className="text-xs text-muted-foreground">Deterministic row security</p>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Antivirus Gate</span>
          <p className="text-base font-bold text-foreground">ClamAV Fail-Closed</p>
          <p className="text-xs text-muted-foreground">Streaming TCP INSTREAM scan</p>
        </div>
        <div className="p-4 rounded-xl border border-border bg-card space-y-1">
          <span className="text-[11px] font-bold uppercase text-muted-foreground">Supply Chain</span>
          <p className="text-base font-bold text-foreground">CycloneDX SBOM</p>
          <p className="text-xs text-muted-foreground">Continuous Trivy + Gitleaks CI</p>
        </div>
      </div>

      {/* Document Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {PROCUREMENT_DOCS.map((doc, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-border bg-card p-6 flex flex-col justify-between hover:border-primary/50 transition-all shadow-sm space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                    {doc.category}
                  </span>
                  <h3 className="text-base font-bold text-foreground mt-0.5">{doc.title}</h3>
                </div>
                <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-muted text-foreground border border-border shrink-0">
                  {doc.format} • {doc.size}
                </span>
              </div>

              <p className="text-xs text-muted-foreground leading-relaxed">{doc.summary}</p>

              <div className="p-3 bg-muted/40 rounded-lg border border-border/60 text-xs space-y-1.5">
                <span className="font-semibold text-foreground text-[11px] uppercase tracking-wider">
                  Key Verification Points:
                </span>
                <ul className="space-y-1 text-muted-foreground text-[11px]">
                  {doc.details.map((item, dIdx) => (
                    <li key={dIdx} className="flex items-start gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="pt-4 border-t border-border flex items-center justify-between">
              <span className="text-[11px] text-muted-foreground">Last reviewed: {doc.lastUpdated}</span>
              <a
                href={`mailto:contact@erppreflight.com?subject=Procurement%20Document%20Request:%20${encodeURIComponent(
                  doc.title
                )}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-xs font-semibold hover:bg-blue-600 transition-colors shadow-sm"
              >
                <Download className="h-3 w-3" />
                <span>Request Package</span>
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
