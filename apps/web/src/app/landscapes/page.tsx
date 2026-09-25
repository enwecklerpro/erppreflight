'use client';

import React, { useState, useEffect } from 'react';
import {
  Server,
  Plus,
  Trash2,
  CheckCircle2,
  ExternalLink,
  ShieldAlert,
  Layers,
  ShieldCheck,
  Activity,
  Lock,
  X,
  Loader2,
} from 'lucide-react';
import {
  fetchLandscapes,
  createLandscape,
  removeLandscape,
  testLandscapeConnection,
  LandscapeItem,
} from '@/lib/api-client';

export default function LandscapesPage() {
  const [landscapes, setLandscapes] = useState<LandscapeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [handshakeResult, setHandshakeResult] = useState<any | null>(null);

  const [systemId, setSystemId] = useState('');
  const [product, setProduct] = useState('SAP S/4HANA');
  const [edition, setEdition] = useState('Private Cloud');
  const [release, setRelease] = useState('2023');
  const [environment, setEnvironment] = useState('DEV');
  const [criticality, setCriticality] = useState('HIGH');
  const [url, setUrl] = useState('');

  useEffect(() => {
    loadLandscapes();
  }, []);

  async function loadLandscapes() {
    try {
      const res = await fetchLandscapes();
      setLandscapes(res);
    } catch (err) {
      console.error('Failed to load landscapes:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!systemId.trim()) return;
    try {
      await createLandscape({
        systemId: systemId.trim(),
        product,
        edition,
        release,
        environment,
        criticality,
        url: url.trim() || undefined,
      });
      setShowAddModal(false);
      setSystemId('');
      setUrl('');
      await loadLandscapes();
    } catch (err) {
      console.error('Failed to add system:', err);
    }
  }

  async function handleTest(id: string) {
    setTestingId(id);
    try {
      const res = await testLandscapeConnection(id);
      setHandshakeResult(res);
      await loadLandscapes();
    } catch (err) {
      console.error('Handshake failed:', err);
    } finally {
      setTestingId(null);
    }
  }

  async function handleRemove(id: string) {
    try {
      await removeLandscape(id);
      await loadLandscapes();
    } catch (err) {
      console.error('Failed to remove system:', err);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-2 border border-cyan-500/20">
              <Server className="w-3.5 h-3.5" />
              Part 16 Landscape Registry
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              Enterprise System Landscape Model
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Register and govern development, staging, and production SAP systems for automated preflight environment routing.
            </p>
          </div>

          <button
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Register SAP System
          </button>
        </div>

        {/* Systems Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {['DEV', 'QA', 'PROD'].map((env) => {
            const envSystems = landscapes.filter((l) => l.environment === env);
            const isProd = env === 'PROD';
            return (
              <div key={env} className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-800">
                    <span className="font-bold text-sm text-white flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${isProd ? 'bg-rose-500' : env === 'QA' ? 'bg-amber-400' : 'bg-cyan-400'}`} />
                      {env} Environment Tier
                    </span>
                    <span className="text-xs text-slate-500 font-mono">{envSystems.length} systems</span>
                  </div>

                  <div className="space-y-3">
                    {envSystems.length === 0 ? (
                      <div className="text-center py-6 text-xs text-slate-500">No systems registered in {env}</div>
                    ) : (
                      envSystems.map((sys) => (
                        <div key={sys.id} className="p-3.5 bg-slate-950 rounded-lg border border-slate-800/80">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-mono font-bold text-white text-xs">{sys.system_id}</span>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.2 rounded border uppercase ${
                                sys.criticality === 'CRITICAL'
                                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {sys.criticality}
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-400">
                            {sys.product} ({sys.release}) • {sys.edition}
                          </div>
                          {sys.url && (
                            <div className="text-[10px] text-cyan-400 font-mono mt-1 truncate">
                              {sys.url}
                            </div>
                          )}
                          <div className="mt-2 pt-2 border-t border-slate-900 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => handleTest(sys.id)}
                              disabled={testingId === sys.id}
                              className="inline-flex items-center gap-1.5 px-2 py-1 bg-slate-900 hover:bg-slate-800 text-cyan-400 text-[10px] font-semibold rounded border border-slate-800 transition-colors disabled:opacity-50"
                            >
                              {testingId === sys.id ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                  Probing...
                                </>
                              ) : (
                                <>
                                  <Activity className="w-3 h-3" />
                                  Test Handshake
                                </>
                              )}
                            </button>

                            <button
                              type="button"
                              onClick={() => handleRemove(sys.id)}
                              className="text-rose-400 hover:text-rose-300 text-[10px] font-semibold flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" />
                              Remove
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Modal */}
        {showAddModal && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
              <h2 className="text-lg font-bold text-white mb-4">Register SAP System in Landscape</h2>
              <form onSubmit={handleCreate} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">System ID (e.g. S4H_PRD)</label>
                  <input
                    type="text"
                    required
                    value={systemId}
                    onChange={(e) => setSystemId(e.target.value)}
                    placeholder="S4H_DEV_100"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Environment Tier</label>
                    <select
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      <option value="DEV">DEV (Development)</option>
                      <option value="QA">QA (Quality Assurance)</option>
                      <option value="PROD">PROD (Production)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1">Release Scope</label>
                    <input
                      type="text"
                      value={release}
                      onChange={(e) => setRelease(e.target.value)}
                      placeholder="2023"
                      className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Internal Hostname / Gateway URL (Optional)</label>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://s4h-dev.internal:44300"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-3 border-t border-slate-800">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="px-4 py-2 rounded-lg text-xs text-slate-400 hover:text-white"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                  >
                    Save System
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Handshake Capability & Write-Safety Modal (Part 18.1 - 18.4) */}
        {handshakeResult && (
          <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      Connector Handshake Verified
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-mono">
                        {handshakeResult.handshakeStatus}
                      </span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      System {handshakeResult.systemId} ({handshakeResult.environment}) • {handshakeResult.protocol} • Latency {handshakeResult.latencyMs} ms
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setHandshakeResult(null)}
                  className="p-1 text-slate-400 hover:text-white rounded-lg transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Write Safety Verification Banner */}
              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-cyan-400">
                  <Lock className="w-4 h-4 text-cyan-400" />
                  Write Safety & Isolation Policy
                </div>
                <p className="text-xs text-slate-300">
                  {handshakeResult.writeSafety?.policyStatement}
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/80 text-[11px]">
                    <span className="text-slate-400 block text-[10px]">Read-Only Engine</span>
                    <span className="text-emerald-400 font-semibold">Active & Enforced</span>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/80 text-[11px]">
                    <span className="text-slate-400 block text-[10px]">Production Write Lock</span>
                    <span className="text-emerald-400 font-semibold">
                      {handshakeResult.writeSafety?.productionWriteLocked ? 'Permanently Locked' : 'N/A'}
                    </span>
                  </div>
                  <div className="bg-slate-900/60 p-2 rounded border border-slate-800/80 text-[11px]">
                    <span className="text-slate-400 block text-[10px]">Dual Approval Gate</span>
                    <span className={handshakeResult.writeSafety?.requiresDualApproval ? 'text-amber-400 font-semibold' : 'text-slate-400'}>
                      {handshakeResult.writeSafety?.requiresDualApproval ? 'Mandatory' : 'Optional'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Discovered APIs */}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" />
                  Discovered APIs & Catalog Services
                </h4>
                <div className="divide-y divide-slate-800/60 border border-slate-800 rounded-xl overflow-hidden">
                  {handshakeResult.discoveredApis?.map((api: any, idx: number) => (
                    <div key={idx} className="p-2.5 bg-slate-950/60 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-white font-medium">{api.name}</span>
                        <span className="text-slate-400 font-mono text-[10px] ml-2">v{api.version}</span>
                        <div className="text-[10px] font-mono text-slate-400 truncate max-w-md">{api.path}</div>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                        {api.status}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Supported Engines */}
              <div className="space-y-1.5">
                <h4 className="text-xs font-semibold text-slate-300">
                  Target Preflight Engines Enabled
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {handshakeResult.supportedEngines?.map((eng: string) => (
                    <span key={eng} className="px-2 py-0.5 bg-slate-950 text-slate-300 border border-slate-800 rounded text-[10px] font-mono">
                      {eng}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-slate-800 text-[11px] text-slate-400">
                <span>Handshake logged at {new Date(handshakeResult.handshakeTimestamp).toLocaleTimeString()}</span>
                <button
                  type="button"
                  onClick={() => setHandshakeResult(null)}
                  className="px-4 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
