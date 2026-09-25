'use client';

import React from 'react';
import {
  ShieldCheck,
  Lock,
  Database,
  Cpu,
  Server,
  FileText,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react';

const CONTROLS = [
  {
    title: 'Tenant Data Isolation (PostgreSQL RLS)',
    desc: 'Every tenant database query executes inside a dedicated transaction setting app.current_tenant_id. Cross-tenant leakage is prevented at the database kernel level.',
    status: 'ACTIVE_ENFORCED',
  },
  {
    title: 'Fail-Closed Antivirus Ingestion Gate',
    desc: 'Uploaded customer files pass through streaming ClamAV INSTREAM inspection. Any connection loss or error immediately fails closed with quarantine rejection.',
    status: 'ACTIVE_ENFORCED',
  },
  {
    title: 'Deterministic Logic & Epistemic Ceiling',
    desc: 'Analysis engines rely on pure AST/XML rules and SHA-256 evidence. AI is strictly capped at INFERRED (0.60) confidence and never overrides deterministic findings.',
    status: 'ACTIVE_ENFORCED',
  },
  {
    title: 'Zero Customer AI Training Policy',
    desc: 'Customer artifacts, code snippets, and logs are never used to train foundational AI models. Enterprise settings allow pure deterministic-only execution.',
    status: 'ACTIVE_ENFORCED',
  },
  {
    title: 'Argon2id Cryptographic Authentication',
    desc: 'Passwords are protected with Argon2id (memoryCost: 19456 KB, timeCost: 2) with HttpOnly, Secure, SameSite=Lax session cookies.',
    status: 'ACTIVE_ENFORCED',
  },
];

const SUBPROCESSORS = [
  { name: 'Hostinger Cloud VPS', purpose: 'Primary SaaS Compute & Container Hosting', region: 'European Union (Frankfurt)', dpaSigned: true },
  { name: 'MinIO / AWS S3', purpose: 'Encrypted Multi-Tenant Artifact & Report Storage', region: 'European Union / Tenant Scoped', dpaSigned: true },
  { name: 'Anthropic / OpenAI (Optional)', purpose: 'Secondary Explanatory & Translation Assistance (When Enabled)', region: 'EU / US (Zero-Retention)', dpaSigned: true },
];

export default function TrustCenterPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Enterprise Assurance & Security Standards
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">
            ERP Preflight Trust Center
          </h1>
          <p className="mt-3 text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">
            Transparent security architecture, deterministic epistemic boundaries, and data handling governance for enterprise transformation teams.
          </p>
        </div>

        {/* Security Controls Grid */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4">Core Security & Privacy Controls</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {CONTROLS.map((ctrl) => (
              <div key={ctrl.title} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-sm text-white">{ctrl.title}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    <CheckCircle2 className="w-3 h-3" />
                    ENFORCED
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">{ctrl.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Authorized Subprocessors Table */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-white mb-4">Authorized Enterprise Subprocessors</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3.5">Subprocessor</th>
                  <th className="p-3.5">Operational Purpose</th>
                  <th className="p-3.5">Data Hosting Region</th>
                  <th className="p-3.5">DPA Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {SUBPROCESSORS.map((sp) => (
                  <tr key={sp.name} className="hover:bg-slate-800/40">
                    <td className="p-3.5 font-bold text-white">{sp.name}</td>
                    <td className="p-3.5">{sp.purpose}</td>
                    <td className="p-3.5 font-mono text-cyan-400">{sp.region}</td>
                    <td className="p-3.5 text-emerald-400 font-semibold">Active & Executed</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Downloads / Legal */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-white text-sm">Need our Enterprise Security Package or Custom DPA?</h3>
            <p className="text-xs text-slate-400 mt-0.5">Download our complete Architecture Overview, Data Flow Diagrams, and SBOM summary.</p>
          </div>
          <a
            href="mailto:contact@erppreflight.com?subject=Enterprise%20Security%20Packet%20Request"
            className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 whitespace-nowrap transition-colors"
          >
            Request Security Package
          </a>
        </div>
      </div>
    </div>
  );
}
