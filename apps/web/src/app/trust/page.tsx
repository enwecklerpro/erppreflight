'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck, CheckCircle2, PackageCheck, Mail, Info } from 'lucide-react';

const CONTROLS = [
  {
    title: 'Tenant Data Isolation (PostgreSQL RLS)',
    desc: 'Every tenant database query executes inside a dedicated transaction setting app.current_tenant_id. Cross-tenant leakage is prevented at the database kernel level.',
    status: 'ACTIVE_ENFORCED',
  },
  {
    title: 'Antivirus Ingestion Gate',
    desc: 'Uploaded files are scanned with ClamAV (INSTREAM) before they can be analysed; only files with status CLEAN are accepted as analysis input. Whether the scanner is live or running in mock mode on a given deployment is shown on the public status page.',
    status: 'DEPLOYMENT_DEPENDENT',
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
    title: 'Argon2id Password Hashing & Token Sessions',
    desc: 'Passwords are hashed with Argon2id (memoryCost 19456 KiB, timeCost 2). The web application authenticates API calls with a signed bearer token held in browser local storage; it is removed from the browser on sign-out.',
    status: 'ACTIVE_ENFORCED',
  },
];

const SUBPROCESSORS = [
  { name: 'Hostinger Cloud VPS', purpose: 'Primary SaaS Compute & Container Hosting', region: 'European Union (Frankfurt)' },
  { name: 'MinIO / AWS S3', purpose: 'Multi-Tenant Artifact & Report Storage', region: 'European Union / Tenant Scoped' },
  { name: 'Anthropic / OpenAI (Optional)', purpose: 'Secondary Explanatory & Translation Assistance (When Enabled)', region: 'EU / US' },
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
                  {ctrl.status === 'ACTIVE_ENFORCED' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                      ENFORCED
                    </span>
                  ) : (
                    <Link
                      href="/status"
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20"
                    >
                      <Info className="w-3 h-3" aria-hidden="true" />
                      SEE STATUS
                    </Link>
                  )}
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
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {SUBPROCESSORS.map((sp) => (
                  <tr key={sp.name} className="hover:bg-slate-800/40">
                    <td className="p-3.5 font-bold text-white">{sp.name}</td>
                    <td className="p-3.5">{sp.purpose}</td>
                    <td className="p-3.5 font-mono text-cyan-400">{sp.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Software Bill of Materials & container hardening — only verifiable facts */}
        <div className="mb-12">
          <h2 className="text-xl font-bold text-white flex items-center gap-2 mb-2">
            <PackageCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            Software Bill of Materials & Container Hardening
          </h2>
          <ul className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-xs text-slate-300 space-y-2 list-disc list-inside">
            <li>
              A machine-readable SBOM is not yet published on this page. It can be requested through the security package contact below.
            </li>
            <li>Production web and API containers run as a dedicated non-root user (UID 1001).</li>
          </ul>
        </div>

        {/* Responsible Disclosure Program (Part 20.12) */}
        <div className="mb-12 bg-slate-900 border border-slate-800 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-white text-base">Responsible Vulnerability Disclosure</h3>
              <p className="text-xs text-slate-400">
                We welcome reports from enterprise customers and independent security researchers. No paying account required.
              </p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Reporting Channel</span>
              <span className="font-mono text-cyan-400 font-semibold">security@erppreflight.com</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Triage Commitment</span>
              <span className="text-white font-semibold">Response within 24–48 hours</span>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <span className="text-slate-500 block text-[10px]">Safe Harbor Policy</span>
              <span className="text-emerald-400 font-semibold">Active & Legally Binding</span>
            </div>
          </div>
        </div>

        {/* Downloads / Legal */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-white text-sm">Need our Enterprise Security Package or Custom DPA?</h3>
            <p className="text-xs text-slate-400 mt-0.5">Request our architecture overview, data flow documentation, and dependency inventory by email.</p>
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
