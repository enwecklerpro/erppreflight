'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Layers,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Download,
  RefreshCw,
  PlusCircle,
  ExternalLink,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';
import {
  fetchTraceabilityMatrix,
  syncTraceability,
  createTraceabilityTask,
  TraceabilityNodeItem,
  TraceabilityMatrixResponse,
} from '@/lib/api-client';

export default function TraceabilityMatrixPage() {
  const params = useParams();
  const projectId = params.id as string;

  const [data, setData] = useState<TraceabilityMatrixResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [creatingTask, setCreatingTask] = useState<string | null>(null);

  const loadMatrix = useCallback(async () => {
    try {
      const res = await fetchTraceabilityMatrix(projectId);
      setData(res);
    } catch (err) {
      console.error('Failed to load traceability matrix:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  async function handleSync() {
    setSyncing(true);
    try {
      await syncTraceability(projectId);
      await loadMatrix();
    } catch (err) {
      console.error('Sync failed:', err);
    } finally {
      setSyncing(false);
    }
  }

  async function handleCreateTask(findingId: string) {
    setCreatingTask(findingId);
    try {
      await createTraceabilityTask(projectId, findingId, 'SAP_CLOUD_ALM');
      await loadMatrix();
    } catch (err) {
      console.error('Failed to create ALM task:', err);
    } finally {
      setCreatingTask(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-2 border border-emerald-500/20">
              <Layers className="w-3.5 h-3.5" />
              End-to-End Delivery Traceability Graph
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              Migration Traceability Matrix
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Bidirectional governance mapping Business Processes → Requirements → Preflight Findings → ALM Remediation Tasks → Tests → Transports → Release.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 text-slate-200 text-xs font-semibold transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
              Sync Findings
            </button>
            <a
              href={`/api/v1/projects/${projectId}/export?format=XLSX`}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Download Matrix (XLSX)
            </a>
          </div>
        </div>

        {/* Gap & Risk Summary KPI Cards (Part 15.18) */}
        {data?.summary && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div className="text-xs text-slate-400 font-semibold uppercase tracking-wider mb-1">
                Requirements at Risk
              </div>
              <div className="text-2xl font-extrabold text-white">{data.summary.totalRequirements}</div>
              <div className="text-xs text-slate-500 mt-1">Total mapped transformational items</div>
            </div>

            <div className="bg-slate-900 border border-rose-500/20 rounded-xl p-5">
              <div className="text-xs text-rose-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <AlertTriangle className="w-3.5 h-3.5" />
                Criticals Without ALM Tasks
              </div>
              <div className="text-2xl font-extrabold text-rose-400">
                {data.summary.criticalFindingsWithoutTasks}
              </div>
              <div className="text-xs text-slate-500 mt-1">Requires work-item synchronization</div>
            </div>

            <div className="bg-slate-900 border border-amber-500/20 rounded-xl p-5">
              <div className="text-xs text-amber-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5" />
                Untested Requirements
              </div>
              <div className="text-2xl font-extrabold text-amber-400">
                {data.summary.requirementsWithoutTests}
              </div>
              <div className="text-xs text-slate-500 mt-1">Missing regression test verification</div>
            </div>

            <div className="bg-slate-900 border border-emerald-500/20 rounded-xl p-5">
              <div className="text-xs text-emerald-400 font-semibold uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                Delivery Readiness
              </div>
              <div className="text-2xl font-extrabold text-emerald-400">
                {data.summary.overallReadinessPercent}%
              </div>
              <div className="text-xs text-slate-500 mt-1">Cutover readiness index</div>
            </div>
          </div>
        )}

        {/* 8-Column Traceability Table */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-950 text-slate-400 font-bold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th className="p-3.5">Business Process</th>
                  <th className="p-3.5">Requirement</th>
                  <th className="p-3.5">Preflight Finding</th>
                  <th className="p-3.5">Remediation Task</th>
                  <th className="p-3.5">Test Case</th>
                  <th className="p-3.5">Defect</th>
                  <th className="p-3.5">Transport (CTS)</th>
                  <th className="p-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 text-slate-300">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      Loading traceability graph...
                    </td>
                  </tr>
                ) : !data?.nodes?.length ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-500">
                      No traceability nodes found. Click Sync Findings to auto-populate from project findings.
                    </td>
                  </tr>
                ) : (
                  data.nodes.map((node) => {
                    const isCritical = node.finding_severity === 'CRITICAL' || node.finding_severity === 'BLOCKER';
                    return (
                      <tr key={node.id} className="hover:bg-slate-800/40 transition-colors">
                        <td className="p-3.5 font-medium text-slate-200">{node.process_hierarchy}</td>
                        <td className="p-3.5">
                          <div className="font-mono font-bold text-white">{node.requirement_id}</div>
                          <div className="text-slate-400 text-[11px] truncate max-w-[180px]">{node.requirement_title}</div>
                        </td>
                        <td className="p-3.5">
                          {node.finding_id ? (
                            <div>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded border ${
                                    isCritical ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-slate-800 text-slate-300 border-slate-700'
                                  }`}
                                >
                                  {node.finding_severity}
                                </span>
                                <span className="font-mono text-white text-[11px]">{node.finding_rule_id}</span>
                              </div>
                              <div className="text-slate-400 text-[11px] truncate max-w-[200px] mt-0.5">{node.finding_title}</div>
                            </div>
                          ) : (
                            <span className="text-emerald-400 flex items-center gap-1 text-[11px]">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Clean Core Ready
                            </span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {node.remediation_task_id ? (
                            <div className="flex items-center gap-1.5 font-mono text-cyan-400">
                              <span>{node.remediation_task_id}</span>
                              <span className="text-[10px] text-slate-500">({node.task_status})</span>
                            </div>
                          ) : node.finding_id ? (
                            <button
                              onClick={() => handleCreateTask(node.finding_id!)}
                              disabled={creatingTask === node.finding_id}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-white font-semibold text-[10px] border border-slate-700 transition-colors"
                            >
                              <PlusCircle className="w-3 h-3 text-emerald-400" />
                              {creatingTask === node.finding_id ? 'Creating...' : 'Create ALM Task'}
                            </button>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>
                        <td className="p-3.5">
                          {node.test_case_id ? (
                            <span className="font-mono text-emerald-400">{node.test_status}</span>
                          ) : (
                            <span className="text-amber-400 text-[11px] flex items-center gap-1">
                              <AlertTriangle className="w-3 h-3" />
                              Untested
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 font-mono text-slate-400">
                          {node.defect_id || 'None'}
                        </td>
                        <td className="p-3.5 font-mono text-slate-300">
                          {node.transport_id || '—'}
                        </td>
                        <td className="p-3.5">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                            {node.release_id}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
