'use client';

import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Node,
  Edge,
  Position,
  useNodesState,
  useEdgesState,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  GitCompare,
  Play,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  ArrowRight,
  Layers,
  FileCode,
  FileSpreadsheet,
  Cpu,
  RefreshCw,
  Table as TableIcon,
  Network,
  Lock,
} from 'lucide-react';
import {
  fetchChangeSets,
  createChangeSet,
  simulateChangeSet,
  approveChangeSet,
  ChangeSetItem,
} from '@/lib/api-client';

const INITIAL_PROPOSED_CHANGES = [
  {
    type: 'REMOVE_CUSTOM_FIELD' as const,
    targetObject: 'YY1_CLASS',
    details: { entity: 'I_PurchaseOrderAPI01' },
  },
];

export default function ChangeSimulationPage() {
  const queryClient = useQueryClient();
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [selectedChangeSet, setSelectedChangeSet] = useState<ChangeSetItem | null>(null);
  const [approvalReason, setApprovalReason] = useState('Architect approved after What-If impact analysis.');
  const [approvedEvidencePack, setApprovedEvidencePack] = useState<any | null>(null);
  const [viewMode, setViewMode] = useState<'canvas' | 'table'>('canvas');

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { data: changesets = [], isLoading: loading } = useQuery({
    queryKey: ['projects', projectId, 'changesets'],
    queryFn: async () => {
      let list = await fetchChangeSets(projectId);
      if (list.length === 0) {
        const initial = await createChangeSet(projectId, {
          name: 'What-If: Deprecate Custom Field YY1_CLASS',
          description: 'Simulate blast radius of removing custom purchasing classification field',
          targetEnvironment: 'QA',
          targetRelease: 'S4H_2023',
          proposedChanges: INITIAL_PROPOSED_CHANGES,
        });
        list = [initial];
      }
      return list;
    }
  });

  useEffect(() => {
    if (changesets.length > 0 && !selectedChangeSet) {
      setSelectedChangeSet(changesets[0]);
    }
  }, [changesets, selectedChangeSet]);

  // Construct DAG nodes & edges based on simulation result
  useEffect(() => {
    if (!selectedChangeSet?.simulation_result) {
      setNodes([
        {
          id: 'root',
          position: { x: 250, y: 50 },
          data: { label: `${selectedChangeSet?.name || 'ChangeSet Pending Simulation'}` },
          style: { background: '#1e293b', color: '#f8fafc', border: '1px solid #475569', borderRadius: 8, padding: 12 },
        },
      ]);
      setEdges([]);
      return;
    }

    const sim = selectedChangeSet.simulation_result;
    const newNodes: Node[] = [
      {
        id: 'change_root',
        position: { x: 300, y: 40 },
        data: { label: `Proposed Change: ${selectedChangeSet.name}` },
        style: {
          background: '#0f172a',
          color: '#38bdf8',
          border: '2px solid #0284c7',
          borderRadius: 10,
          fontWeight: 'bold',
          padding: 12,
          width: 280,
        },
      },
    ];

    const newEdges: Edge[] = [];
    const blastObjects = sim.blastRadiusObjects || [];

    blastObjects.forEach((obj, idx) => {
      const nodeId = `obj_${idx}`;
      const xPos = 50 + (idx % 3) * 260;
      const yPos = 180 + Math.floor(idx / 3) * 120;

      newNodes.push({
        id: nodeId,
        position: { x: xPos, y: yPos },
        data: {
          label: `${obj.name}\n[${obj.type}] -> ${obj.impact}`,
        },
        style: {
          background: '#1e293b',
          color: '#f1f5f9',
          border: obj.impact.includes('BROKEN') ? '1px solid #f43f5e' : '1px solid #eab308',
          borderRadius: 8,
          fontSize: 11,
          padding: 8,
          width: 220,
        },
      });

      newEdges.push({
        id: `e_${nodeId}`,
        source: 'change_root',
        target: nodeId,
        animated: true,
        style: { stroke: obj.impact.includes('BROKEN') ? '#f43f5e' : '#38bdf8' },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [selectedChangeSet, setNodes, setEdges]);

  const simulateMutation = useMutation({
    mutationFn: (changesetId: string) => simulateChangeSet(projectId, changesetId),
    onSuccess: (updated) => {
      setSelectedChangeSet(updated);
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'changesets'] });
    }
  });

  const approveMutation = useMutation({
    mutationFn: (changesetId: string) => approveChangeSet(projectId, changesetId, approvalReason),
    onSuccess: (res) => {
      setSelectedChangeSet(res.changeset);
      setApprovedEvidencePack(res.evidencePack);
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'changesets'] });
    }
  });

  function handleSimulate() {
    if (!selectedChangeSet) return;
    simulateMutation.mutate(selectedChangeSet.id);
  }

  function handleApprove() {
    if (!selectedChangeSet) return;
    approveMutation.mutate(selectedChangeSet.id);
  }

  const simulating = simulateMutation.isPending;
  const approving = approveMutation.isPending;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Top Banner */}
      <div className="border-b border-slate-800 bg-slate-900/60 px-6 py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1 border border-cyan-500/20">
            <GitCompare className="w-3.5 h-3.5" />
            What-If Change Simulation Engine
          </div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            ChangeSet Impact & Blast Radius Canvas
          </h1>
        </div>

        <div className="flex items-center gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-1 flex">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
                viewMode === 'canvas' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Network className="w-3.5 h-3.5" />
              Graph Canvas
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-1 text-xs font-semibold rounded flex items-center gap-1.5 transition-colors ${
                viewMode === 'table' ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              Accessible Table
            </button>
          </div>

          <button
            onClick={handleSimulate}
            disabled={simulating}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
          >
            {simulating ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            {simulating ? 'Simulating...' : 'Run What-If Simulation'}
          </button>
        </div>
      </div>

      {/* Main Split Layout */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side: Graph Canvas or Table Fallback */}
        <div className="flex-1 h-[550px] lg:h-auto border-b lg:border-b-0 lg:border-r border-slate-800 relative bg-slate-950">
          {viewMode === 'canvas' ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              fitView
            >
              <Background color="#1e293b" gap={16} />
              <Controls className="bg-slate-900 border border-slate-700 text-white fill-white" />
              <MiniMap
                nodeColor={(n) => (n.id.includes('root') ? '#0284c7' : '#e11d48')}
                className="bg-slate-900 border border-slate-800 rounded-lg"
              />
            </ReactFlow>
          ) : (
            <div className="p-6 overflow-y-auto h-full">
              <h3 className="text-base font-bold text-white mb-4">Blast Radius Impact Breakdown (Accessible Table)</h3>
              <table className="w-full text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
                <thead className="bg-slate-900 text-slate-400 font-semibold border-b border-slate-800">
                  <tr>
                    <th className="p-3">Target SAP Object</th>
                    <th className="p-3">Component Type</th>
                    <th className="p-3">Simulated Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {(selectedChangeSet?.simulation_result?.blastRadiusObjects || []).map((o, idx) => (
                    <tr key={idx} className="hover:bg-slate-900/50">
                      <td className="p-3 font-mono font-bold text-white">{o.name}</td>
                      <td className="p-3">{o.type}</td>
                      <td className="p-3 font-semibold text-rose-400">{o.impact}</td>
                    </tr>
                  ))}
                  {(!selectedChangeSet?.simulation_result?.blastRadiusObjects?.length) && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-slate-500">Run simulation to calculate blast radius objects.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Side: Simulation Inspector & Approval Panel */}
        <div className="w-full lg:w-96 bg-slate-900 p-6 overflow-y-auto flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ChangeSet Status</span>
              <span
                className={`text-[10px] font-bold px-2 py-0.5 rounded border uppercase ${
                  selectedChangeSet?.approval_status === 'APPROVED'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : selectedChangeSet?.approval_status === 'SIMULATED'
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                    : 'bg-slate-800 text-slate-400 border-slate-700'
                }`}
              >
                {selectedChangeSet?.approval_status || 'DRAFT'}
              </span>
            </div>

            <h2 className="text-lg font-bold text-white mb-2">{selectedChangeSet?.name}</h2>
            <p className="text-xs text-slate-400 mb-6">{selectedChangeSet?.description}</p>

            {/* Verdict Card */}
            {selectedChangeSet?.simulation_result && (
              <div className="space-y-4 mb-6">
                <div
                  className={`p-4 rounded-xl border ${
                    selectedChangeSet.simulation_result.verdict === 'CLEAR'
                      ? 'bg-emerald-500/10 border-emerald-500/30'
                      : 'bg-amber-500/10 border-amber-500/30'
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    {selectedChangeSet.simulation_result.verdict === 'CLEAR' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" />
                    )}
                    <span className="font-bold text-sm text-white">
                      Verdict: {selectedChangeSet.simulation_result.verdict}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Risk Delta: <strong>{selectedChangeSet.simulation_result.riskDelta}</strong> •{' '}
                    {selectedChangeSet.simulation_result.blastRadiusObjects.length} downstream components affected.
                  </p>
                </div>

                {/* Newly Introduced Findings */}
                {selectedChangeSet.simulation_result.newFindings.length > 0 && (
                  <div>
                    <h4 className="text-xs font-bold text-rose-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Newly Introduced Preflight Risks ({selectedChangeSet.simulation_result.newFindings.length})
                    </h4>
                    <div className="space-y-2">
                      {selectedChangeSet.simulation_result.newFindings.map((nf, idx) => (
                        <div key={idx} className="p-3 bg-slate-950/80 border border-rose-500/20 rounded-lg text-xs">
                          <div className="font-bold text-white mb-0.5">{nf.ruleId}</div>
                          <div className="text-slate-400">{nf.title}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Approval Action */}
          <div className="pt-6 border-t border-slate-800">
            {selectedChangeSet?.approval_status !== 'APPROVED' ? (
              <div className="space-y-3">
                <label className="block text-xs font-semibold text-slate-400">Approval Justification</label>
                <input
                  type="text"
                  value={approvalReason}
                  onChange={(e) => setApprovalReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs text-white focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={handleApprove}
                  disabled={approving || !selectedChangeSet?.simulation_result}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 transition-all disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" />
                  {approving ? 'Signing Evidence Pack...' : 'Approve & Issue Change Pack'}
                </button>
              </div>
            ) : (
              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-xs">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  ChangeSet Approved & Signed
                </div>
                <div className="text-[11px] text-slate-400 font-mono break-all">
                  Cert: {approvedEvidencePack?.auditCertificate || selectedChangeSet.proposal_hash}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
