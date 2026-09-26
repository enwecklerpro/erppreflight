'use client';

import { RuleTitle } from '@/components/findings/rule-text';
import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import { ReactFlow, Background, Controls, MiniMap, Node, Edge, useNodesState, useEdgesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  GitCompare,
  Play,
  CheckCircle2,
  AlertTriangle,
  ShieldAlert,
  RefreshCw,
  Table as TableIcon,
  Network,
  Lock,
  XCircle,
} from 'lucide-react';
import { fetchChangeSets, simulateChangeSet, fetchProject, type ChangeSetItem } from '@/lib/api-client';
import {
  ApproveChangeSetDialog,
  CreateChangeSetDialog,
  EvidencePackDialog,
  type ChangeEvidencePack,
} from '@/components/changesets/change-set-dialogs';
import { useErrorText, useLabel, useT } from '@/i18n/client';

export default function ChangeSimulationPage() {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const params = useParams();
  const projectId = params.id as string;
  const listKey = ['projects', projectId, 'changesets'];

  const [selectedChangeSet, setSelectedChangeSet] = useState<ChangeSetItem | null>(null);
  const [approvedEvidencePack, setApprovedEvidencePack] = useState<ChangeEvidencePack | null>(null);
  const [showPack, setShowPack] = useState(false);
  const [viewMode, setViewMode] = useState<'canvas' | 'table'>('canvas');
  const [showCreate, setShowCreate] = useState(false);
  const [showApprove, setShowApprove] = useState(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Read-only list query: a GET must never create data as a side effect.
  const {
    data: changesets = [],
    isLoading: loading,
    isError: isChangesetsError,
    refetch: refetchChangesets,
    isFetching,
  } = useQuery({
    queryKey: listKey,
    queryFn: () => fetchChangeSets(projectId),
    enabled: Boolean(projectId),
  });

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => fetchProject(projectId),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (changesets.length > 0 && !selectedChangeSet) setSelectedChangeSet(changesets[0]);
  }, [changesets, selectedChangeSet]);

  // Graph of the proposed change and every affected object.
  useEffect(() => {
    if (!selectedChangeSet?.simulation_result) {
      setNodes([
        {
          id: 'root',
          position: { x: 250, y: 50 },
          data: { label: selectedChangeSet?.name || t('app.changesets.pendingNode') },
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
        data: { label: t('app.changesets.proposedNode', { name: selectedChangeSet.name }) },
        style: { background: '#0f172a', color: '#38bdf8', border: '2px solid #0284c7', borderRadius: 10, fontWeight: 'bold', padding: 12, width: 280 },
      },
    ];
    const newEdges: Edge[] = [];
    (sim.blastRadiusObjects || []).forEach((obj, idx) => {
      const nodeId = `obj_${idx}`;
      const broken = obj.impact.includes('BROKEN');
      newNodes.push({
        id: nodeId,
        position: { x: 50 + (idx % 3) * 260, y: 180 + Math.floor(idx / 3) * 120 },
        data: { label: `${obj.name}\n[${obj.type}] → ${label('app.changesets.impact', obj.impact)}` },
        style: {
          background: '#1e293b',
          color: '#f1f5f9',
          border: broken ? '1px solid #f43f5e' : '1px solid #eab308',
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
        style: { stroke: broken ? '#f43f5e' : '#38bdf8' },
      });
    });
    setNodes(newNodes);
    setEdges(newEdges);
  }, [selectedChangeSet, setNodes, setEdges, t, label]);

  const simulateMutation = useMutation({
    mutationFn: (changesetId: string) => simulateChangeSet(projectId, changesetId),
    onSuccess: (updated) => {
      setSelectedChangeSet(updated);
      queryClient.invalidateQueries({ queryKey: listKey });
    },
  });

  const simulating = simulateMutation.isPending;
  const sim = selectedChangeSet?.simulation_result ?? null;
  const status = selectedChangeSet?.approval_status || 'DRAFT';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      <div className="border-b border-slate-800 bg-slate-900/60 px-4 sm:px-6 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-semibold uppercase tracking-wider mb-1 border border-cyan-500/20">
            <GitCompare className="w-3.5 h-3.5" aria-hidden="true" />
            {t('app.changesets.badge')}
          </div>
          <h1 className="text-xl font-bold text-white">{t('app.changesets.title')}</h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div role="group" aria-label={t('app.changesets.viewLabel')} className="bg-slate-950 border border-slate-800 rounded-lg p-1 flex">
            {(['canvas', 'table'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={viewMode === mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1 text-sm font-semibold rounded flex items-center gap-1.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                  viewMode === mode ? 'bg-emerald-500 text-slate-950' : 'text-slate-300 hover:text-white'
                }`}
              >
                {mode === 'canvas' ? <Network className="w-3.5 h-3.5" aria-hidden="true" /> : <TableIcon className="w-3.5 h-3.5" aria-hidden="true" />}
                {mode === 'canvas' ? t('app.changesets.viewGraph') : t('app.changesets.viewTable')}
              </button>
            ))}
          </div>

          {changesets.length > 0 && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="px-3 py-2 rounded-lg border border-slate-700 text-slate-200 text-sm font-semibold hover:bg-slate-800"
            >
              {t('app.changesets.newChangeSet')}
            </button>
          )}
          <button
            type="button"
            onClick={() => selectedChangeSet && simulateMutation.mutate(selectedChangeSet.id)}
            disabled={simulating || !selectedChangeSet}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
          >
            {simulating ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
            )}
            {simulating ? t('app.changesets.running') : t('app.changesets.run')}
          </button>
        </div>
      </div>

      {simulateMutation.isError && (
        <p role="alert" className="px-4 sm:px-6 py-3 text-sm text-rose-300 border-b border-slate-800">
          {errText(simulateMutation.error, t('app.changesets.simulateFailed'))}
        </p>
      )}

      {(isChangesetsError || (!loading && changesets.length === 0)) && (
        <div className="px-4 sm:px-6 py-8 border-b border-slate-800">
          {isChangesetsError ? (
            <div role="alert" className="max-w-xl mx-auto text-center text-sm space-y-2">
              <AlertTriangle className="w-6 h-6 mx-auto text-rose-400" aria-hidden="true" />
              <p className="font-semibold text-white">{t('app.changesets.loadError')}</p>
              <button type="button" onClick={() => refetchChangesets()} disabled={isFetching} className="font-semibold underline">
                {t('app.changesets.retry')}
              </button>
            </div>
          ) : (
            <div className="max-w-xl mx-auto text-center space-y-3">
              <GitCompare className="w-8 h-8 mx-auto text-slate-400" aria-hidden="true" />
              <h2 className="text-base font-bold text-white">{t('app.changesets.emptyTitle')}</h2>
              <p className="text-sm text-slate-400">{t('app.changesets.emptyBody')}</p>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-slate-950 font-bold text-sm"
              >
                {t('app.changesets.createFirst')}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        <div className="flex-1 h-[550px] lg:h-auto border-b lg:border-b-0 lg:border-r border-slate-800 relative bg-slate-950">
          {viewMode === 'canvas' ? (
            <div className="h-full" role="img" aria-label={t('app.changesets.graphLabel')}>
              <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} fitView>
                <Background color="#1e293b" gap={16} />
                <Controls className="bg-slate-900 border border-slate-700 text-white fill-white" />
                <MiniMap nodeColor={(n) => (n.id.includes('root') ? '#0284c7' : '#e11d48')} className="bg-slate-900 border border-slate-800 rounded-lg" />
              </ReactFlow>
            </div>
          ) : (
            <div className="p-4 sm:p-6 overflow-auto h-full">
              <h2 className="text-base font-bold text-white mb-4">{t('app.changesets.tableTitle')}</h2>
              <table className="w-full text-left text-sm border border-slate-800 rounded-lg overflow-hidden">
                <caption className="sr-only">{t('app.changesets.tableCaption')}</caption>
                <thead className="bg-slate-900 text-slate-300 font-semibold border-b border-slate-800">
                  <tr>
                    <th scope="col" className="p-3">{t('app.changesets.colObject')}</th>
                    <th scope="col" className="p-3">{t('app.changesets.colType')}</th>
                    <th scope="col" className="p-3">{t('app.changesets.colImpact')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800 text-slate-300">
                  {(sim?.blastRadiusObjects || []).map((o, idx) => (
                    <tr key={idx}>
                      <td className="p-3 font-mono font-bold text-white">{o.name}</td>
                      <td className="p-3 font-mono">{o.type}</td>
                      <td className="p-3 font-semibold text-rose-300">{label('app.changesets.impact', o.impact)}</td>
                    </tr>
                  ))}
                  {!sim?.blastRadiusObjects?.length && (
                    <tr>
                      <td colSpan={3} className="p-4 text-center text-slate-400">
                        {t('app.changesets.runHint')}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="w-full lg:w-96 bg-slate-900 p-4 sm:p-6 overflow-y-auto flex flex-col justify-between gap-6">
          <div>
            {changesets.length > 1 && (
              <div className="mb-4">
                <label htmlFor="changeset-select" className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">
                  {t('app.changesets.listLabel')}
                </label>
                <select
                  id="changeset-select"
                  value={selectedChangeSet?.id ?? ''}
                  onChange={(e) => setSelectedChangeSet(changesets.find((c) => c.id === e.target.value) ?? null)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-lg text-sm text-white"
                >
                  {changesets.map((cs) => (
                    <option key={cs.id} value={cs.id}>
                      {cs.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{t('app.changesets.statusLabel')}</span>
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded border ${
                  status === 'APPROVED'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : status === 'SIMULATED'
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {label('app.changesets.status', status)}
              </span>
            </div>

            <h2 className="text-lg font-bold text-white mb-2 break-words">{selectedChangeSet?.name}</h2>
            {selectedChangeSet?.description && <p className="text-sm text-slate-400 mb-6">{selectedChangeSet.description}</p>}

            {sim && (
              <div className="space-y-4 mb-6">
                <div className={`p-4 rounded-xl border ${sim.verdict === 'CLEAR' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-amber-500/10 border-amber-500/30'}`}>
                  <div className="flex items-center gap-2 mb-1">
                    {sim.verdict === 'CLEAR' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                    ) : sim.verdict === 'BLOCKED' ? (
                      <XCircle className="w-4 h-4 text-rose-400" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-amber-400" aria-hidden="true" />
                    )}
                    <span className="font-bold text-sm text-white">
                      {t('app.changesets.verdictLabel')}: {label('app.changesets.verdict', sim.verdict)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300">
                    {t('app.changesets.riskDeltaLabel')}: <strong>{label('app.changesets.riskDelta', sim.riskDelta)}</strong> ·{' '}
                    {t('app.changesets.affected', { count: sim.blastRadiusObjects.length })}
                  </p>
                </div>

                {sim.newFindings.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-rose-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                      <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('app.changesets.regressionsTitle', { count: sim.newFindings.length })}
                    </h3>
                    <ul className="space-y-2">
                      {sim.newFindings.map((nf, idx) => (
                        <li key={idx} className="p-3 bg-slate-950/80 border border-rose-500/20 rounded-lg text-sm">
                          <div className="font-mono font-bold text-white mb-0.5 break-all">{nf.ruleId}</div>
                          <div className="text-slate-400"><RuleTitle ruleId={nf.ruleId} title={nf.title} /></div>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-slate-800">
            {status !== 'APPROVED' ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowApprove(true)}
                  disabled={!sim || !selectedChangeSet}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50"
                >
                  <Lock className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('app.changesets.approve.open')}
                </button>
                {!sim && selectedChangeSet && <p className="text-xs text-slate-400">{t('app.changesets.approve.needsSimulation')}</p>}
              </div>
            ) : (
              <div className="p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-sm">
                <div className="font-bold text-emerald-400 flex items-center gap-1.5 mb-1">
                  <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  {t('app.changesets.approve.approvedTitle')}
                </div>
                <div className="text-xs text-slate-400 font-mono break-all">
                  {t('app.changesets.approve.certificate', {
                    hash: approvedEvidencePack?.auditCertificate || selectedChangeSet?.proposal_hash || '—',
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {showCreate && (
        <CreateChangeSetDialog
          projectId={projectId}
          targetRelease={project?.targetRelease ?? null}
          onClose={() => setShowCreate(false)}
          onCreated={(created) => {
            setShowCreate(false);
            setSelectedChangeSet(created);
            queryClient.invalidateQueries({ queryKey: listKey });
          }}
        />
      )}

      {showApprove && selectedChangeSet && (
        <ApproveChangeSetDialog
          projectId={projectId}
          changeSetId={selectedChangeSet.id}
          onClose={() => setShowApprove(false)}
          onApproved={(res) => {
            setShowApprove(false);
            if (res.changeset) setSelectedChangeSet(res.changeset);
            setApprovedEvidencePack(res.evidencePack ?? null);
            setShowPack(Boolean(res.evidencePack));
            queryClient.invalidateQueries({ queryKey: listKey });
          }}
        />
      )}

      {showPack && approvedEvidencePack && <EvidencePackDialog pack={approvedEvidencePack} onClose={() => setShowPack(false)} />}
    </div>
  );
}
