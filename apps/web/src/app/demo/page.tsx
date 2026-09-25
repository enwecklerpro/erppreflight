'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Sparkles,
  ShieldAlert,
  ArrowRight,
  Database,
  FileCode,
  FileSpreadsheet,
  Layers,
  Truck,
  Flame,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { exploreDemoProject } from '@/lib/api-client';

import { useQuery } from '@tanstack/react-query';
import { customInstance } from '@/lib/api/custom-instance';

export default function DemoSandboxPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const { data: scenarios, isLoading: scenariosLoading, isError } = useQuery({
    queryKey: ['demo', 'scenarios'],
    queryFn: async () => {
      const res = await customInstance('/api/v1/demo/scenarios');
      return res as any[];
    },
    retry: false,
  });

  async function handleLaunch() {
    setLoading(true);
    try {
      const res = await exploreDemoProject();
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      console.error('Failed to launch demo project:', err);
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header Banner */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            Interactive Synthetic Sandbox
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
            Explore Preflight Without Uploading Data
          </h1>
          <p className="max-w-2xl mx-auto text-slate-400 text-base sm:text-lg">
            Experience our 19 deterministic engines, cryptographic evidence chains, and What-If simulation using pre-seeded synthetic enterprise failure cases.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleLaunch}
              disabled={loading}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base shadow-xl shadow-emerald-500/20 transition-all hover:scale-105 disabled:opacity-50"
            >
              {loading ? 'Bootstrapping Sandbox...' : 'Launch Interactive Demo Sandbox'}
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              100% Synthetic Data • No Customer Credentials Required
            </div>
          </div>
        </div>

        {/* Scenarios Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-12">
          {scenariosLoading ? (
            <div className="col-span-full text-center py-12 text-slate-400">Loading demo scenarios...</div>
          ) : isError || !scenarios || scenarios.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-400">Demo scenarios are being configured. Please check back later.</div>
          ) : scenarios.map((sc, idx) => {
            const Icon = sc.icon || FileCode;
            const isBlocker = sc.severity === 'BLOCKER';
            const isCritical = sc.severity === 'CRITICAL';
            return (
              <div
                key={idx}
                className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 hover:border-slate-700 transition-all flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div className="flex items-center gap-2.5">
                      <div className="p-2 rounded-lg bg-slate-800 text-emerald-400">
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="font-bold text-sm text-white">{sc.title}</span>
                    </div>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                        isBlocker
                          ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          : isCritical
                          ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}
                    >
                      {sc.severity}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{sc.desc}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-[11px] text-slate-500">
                  <span>Engine: <strong className="text-slate-300 font-mono">{sc.engine}</strong></span>
                  <span className="flex items-center gap-1 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Verified Evidence
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer Note */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400">
          <p>
            Per Master Specification Part 14.2, no demo data represents actual customer confidential SAP records. All findings, SHA-256 evidence digests, and BRFplus XML decision tables are deterministically generated synthetic artifacts.
          </p>
        </div>
      </div>
    </div>
  );
}
