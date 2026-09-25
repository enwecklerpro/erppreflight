'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CheckCircle2,
  Search,
  Filter,
  Layers,
  ShieldCheck,
  ExternalLink,
  Cpu,
} from 'lucide-react';
import { fetchReleaseMatrix, ReleaseMatrixEntry } from '@/lib/api-client';

export default function ReleaseMatrixPage() {
  const { data: matrix = [], isLoading: loading } = useQuery({
    queryKey: ['matrix'],
    queryFn: fetchReleaseMatrix,
  });
  const [search, setSearch] = useState('');
  const [selectedDomain, setSelectedDomain] = useState('ALL');

  const domains = ['ALL', ...Array.from(new Set(matrix.map((m) => m.domain)))];

  const filtered = matrix.filter((item) => {
    const matchesDomain = selectedDomain === 'ALL' || item.domain === selectedDomain;
    const matchesSearch =
      item.engineName.toLowerCase().includes(search.toLowerCase()) ||
      item.engineId.toLowerCase().includes(search.toLowerCase()) ||
      item.targetRelease.toLowerCase().includes(search.toLowerCase());
    return matchesDomain && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Banner */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-3 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" />
            Part 17 Release Governance
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Canonical SAP Release Compatibility Matrix
          </h1>
          <p className="mt-2 text-sm text-slate-400 max-w-2xl mx-auto">
            Definitive verified coverage across all 19 preflight engines against SAP S/4HANA (2020..2025), S/4HANA Cloud (2408..2608), and ECC 6.0 EHP8.
          </p>
        </div>

        {/* Filter Controls */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mb-6">
          <div className="relative w-full sm:w-80">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search engine or release..."
              className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-800 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto pb-2 sm:pb-0">
            {domains.map((dom) => (
              <button
                key={dom}
                onClick={() => setSelectedDomain(dom)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                  selectedDomain === dom
                    ? 'bg-emerald-500 text-slate-950 font-bold'
                    : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                }`}
              >
                {dom}
              </button>
            ))}
          </div>
        </div>

        {/* Matrix Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <table className="w-full text-left text-xs border-collapse">
            <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
              <tr>
                <th className="p-3.5">Canonical Engine</th>
                <th className="p-3.5">Domain</th>
                <th className="p-3.5">Target SAP Release Scope</th>
                <th className="p-3.5">Supported Formats</th>
                <th className="p-3.5">Verification Status</th>
                <th className="p-3.5 text-right">Golden Fixtures</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-500">
                    Loading verified compatibility matrix...
                  </td>
                </tr>
              ) : (
                filtered.map((item) => (
                  <tr key={item.engineId} className="hover:bg-slate-800/40 transition-colors">
                    <td className="p-3.5">
                      <div className="font-bold text-white text-sm">{item.engineName}</div>
                      <div className="font-mono text-slate-500 text-[11px]">{item.engineId}</div>
                    </td>
                    <td className="p-3.5 text-slate-300 font-medium">{item.domain}</td>
                    <td className="p-3.5">
                      <span className="font-mono text-cyan-400 bg-cyan-950/40 px-2 py-0.5 rounded border border-cyan-800/40">
                        {item.targetRelease}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-wrap gap-1">
                        {item.supportedFormats.map((fmt) => (
                          <span
                            key={fmt}
                            className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700"
                          >
                            {fmt}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 text-[11px] font-bold border border-emerald-500/20">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        SUPPORTED_VERIFIED
                      </span>
                    </td>
                    <td className="p-3.5 text-right font-mono font-bold text-white">
                      {item.verifiedFixtures} fixtures
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
