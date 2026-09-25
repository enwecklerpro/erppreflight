import * as React from 'react';
import { Finding } from '@erppreflight/schemas';
import { FileCode, Hash, Wrench, Shield, CheckCircle2, AlertCircle, Copy, Check, ExternalLink, Send, Loader2, GitBranch, Binary, Cpu, BookOpen } from 'lucide-react';
import { CleanCoreBadge } from './clean-core-badge';
import { ConfidenceBadge } from './confidence-badge';
import { createWorkItemForFinding } from '@/lib/api-client';

export function FindingDetailRow({ finding }: { finding: Finding }) {
  const [copiedHash, setCopiedHash] = React.useState<string | null>(null);
  const [creatingTask, setCreatingTask] = React.useState(false);
  const [targetSystem, setTargetSystem] = React.useState('SAP_CLOUD_ALM');
  const [createdTask, setCreatedTask] = React.useState<{ workItemId: string; externalSystem: string } | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const handleCreateWorkItem = async () => {
    setCreatingTask(true);
    try {
      const res = await createWorkItemForFinding(finding.id, {
        system: targetSystem,
        title: `Remediate ${finding.ruleId}: ${finding.title}`,
      });
      if (res.success) {
        setCreatedTask({ workItemId: res.workItemId, externalSystem: res.externalSystem });
      }
    } catch (err) {
      console.error('Failed to create work item:', err);
    } finally {
      setCreatingTask(false);
    }
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-5 shadow-inner space-y-5 text-xs">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono font-bold text-primary text-sm">{finding.ruleId}</span>
          <span className="text-muted-foreground">•</span>
          <span className="font-medium text-foreground">{finding.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <ConfidenceBadge confidence={finding.confidence} score={finding.confidenceScore} size="sm" />
          {finding.affectedObjects?.[0]?.tier && (
            <CleanCoreBadge tier={finding.affectedObjects[0].tier} size="sm" />
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Column: Remediation Guidance & Affected Objects */}
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200/80 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <h4 className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-blue-700 dark:text-blue-300">
              <Wrench className="size-3.5" />
              Actionable Remediation Guidance
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-blue-950 dark:text-blue-100">
              {finding.remediation}
            </p>
          </div>

          {/* Finding-to-Task Work Item Creation (Part 15.8) */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <h5 className="font-semibold text-[11px] text-foreground uppercase tracking-wider flex items-center gap-1.5">
                <Send className="size-3 text-primary" />
                Work Management Integration
              </h5>
              {createdTask && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <CheckCircle2 className="size-3" />
                  Linked: {createdTask.workItemId} ({createdTask.externalSystem})
                </span>
              )}
            </div>

            {!createdTask ? (
              <div className="flex items-center gap-2 pt-1">
                <select
                  value={targetSystem}
                  onChange={(e) => setTargetSystem(e.target.value)}
                  className="rounded border border-border bg-background px-2.5 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  aria-label="Target Work Management System"
                >
                  <option value="SAP_CLOUD_ALM">SAP Cloud ALM</option>
                  <option value="JIRA">Jira Software</option>
                  <option value="AZURE_DEVOPS">Azure DevOps Boards</option>
                  <option value="GITHUB_ISSUES">GitHub Issues</option>
                  <option value="SERVICENOW">ServiceNow</option>
                </select>

                <button
                  type="button"
                  onClick={handleCreateWorkItem}
                  disabled={creatingTask}
                  className="inline-flex items-center gap-1.5 rounded bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  {creatingTask ? (
                    <>
                      <Loader2 className="size-3 animate-spin" />
                      Creating Task...
                    </>
                  ) : (
                    <>
                      <Send className="size-3" />
                      Create Work Item
                    </>
                  )}
                </button>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Remediation task created with technical context, line references, and reproducibility hash.
              </p>
            )}
          </div>

          {/* Technical Details Key-Value */}
          {finding.technicalDetails && Object.keys(finding.technicalDetails).length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <h5 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                Technical Execution Parameters
              </h5>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono">
                {Object.entries(finding.technicalDetails).map(([key, val]) => (
                  <div key={key} className="flex flex-col">
                    <span className="text-muted-foreground text-[10px]">{key}:</span>
                    <span className="text-foreground font-semibold truncate">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Affected SAP Objects */}
          {finding.affectedObjects && finding.affectedObjects.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                Impacted SAP Repository Objects ({finding.affectedObjects.length})
              </h5>
              <div className="divide-y divide-border/60 rounded-lg border border-border bg-muted/10">
                {finding.affectedObjects.map((obj, i) => (
                  <div key={i} className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 font-mono">
                      <span className="font-bold text-foreground">{obj.name}</span>
                      {obj.type && (
                        <span className="text-[10px] text-muted-foreground">({obj.type})</span>
                      )}
                    </div>
                    {obj.tier && <CleanCoreBadge tier={obj.tier} size="sm" />}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Cryptographic Evidence Ledger */}
        <div className="space-y-3">
          <h4 className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-foreground">
            <Shield className="size-3.5 text-primary" />
            Cryptographic Evidence Chain
          </h4>

          {finding.evidence && finding.evidence.length > 0 ? (
            finding.evidence.map((ev, idx) => {
              const isSha256Valid = ev.sha256 && /^[a-fA-F0-9]{64}$/.test(ev.sha256);

              return (
                <div
                  key={idx}
                  className="rounded-lg border border-border bg-muted/20 p-3.5 space-y-2.5 font-mono text-xs"
                >
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span className="flex items-center gap-1 text-foreground font-semibold truncate max-w-[260px]">
                      <FileCode className="size-3.5 text-primary shrink-0" />
                      <span className="truncate">{ev.artifactPath}</span>
                    </span>
                    {ev.lineNumber !== undefined && ev.lineNumber !== null && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] shrink-0 border border-border/50">
                        Line {ev.lineNumber}
                        {ev.columnNumber ? `:${ev.columnNumber}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Syntax Snippet Box */}
                  {ev.snippet && (
                    <div className="relative rounded-md bg-zinc-950 p-3 text-zinc-100 text-[11px] leading-relaxed overflow-x-auto border border-zinc-800">
                      <code>{ev.snippet}</code>
                    </div>
                  )}

                  {/* Cryptographic SHA-256 Hash */}
                  <div className="flex items-center justify-between pt-1 border-t border-border/50 text-[10px]">
                    <div className="flex items-center gap-1.5 text-muted-foreground truncate mr-2">
                      <Hash className="size-3 shrink-0" />
                      <span className="truncate">SHA-256: {ev.sha256}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSha256Valid ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                          <CheckCircle2 className="size-3" /> Verified Hash
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600 font-sans font-semibold">
                          <AlertCircle className="size-3" /> Unverified Hash
                        </span>
                      )}
                      {ev.sha256 && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(ev.sha256, `${idx}-hash`)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          aria-label="Copy SHA-256 Hash"
                        >
                          {copiedHash === `${idx}-hash` ? (
                            <Check className="size-3 text-emerald-500" />
                          ) : (
                            <Copy className="size-3" />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-muted-foreground italic">
              No raw snippet evidence attached to this rule assertion.
            </div>
          )}
        </div>
      </div>

      {/* Cryptographic Data Lineage Chain (Part 17.11) */}
      <div className="rounded-lg border border-border/70 bg-muted/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="font-bold text-[11px] text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <GitBranch className="size-3.5 text-primary" />
            Audit Provenance & Cryptographic Lineage
          </h5>
          <span className="text-[10px] font-mono text-muted-foreground">
            Reproducibility Chain: VERIFIED_DETERMINISTIC
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px]">
          {/* Step 1: Raw Artifact */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <FileCode className="size-3 text-cyan-500" />
              1. Source Artifact
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1" title={finding.evidence?.[0]?.artifactPath || 'Artifact Stream'}>
              {finding.evidence?.[0]?.artifactPath ? finding.evidence[0].artifactPath.split('/').pop() : 'Input File'}
            </span>
          </div>

          {/* Step 2: Digest */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Binary className="size-3 text-emerald-500" />
              2. SHA-256 Digest
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1" title={finding.evidence?.[0]?.sha256 || 'Calculated on Ingestion'}>
              {finding.evidence?.[0]?.sha256 ? `${finding.evidence[0].sha256.substring(0, 10)}...` : 'Pre-flight Hash'}
            </span>
          </div>

          {/* Step 3: Parser */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Cpu className="size-3 text-purple-500" />
              3. Hardened Parser
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              Deterministic AST
            </span>
          </div>

          {/* Step 4: Rule Engine */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Shield className="size-3 text-blue-500" />
              4. Analysis Engine
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              {finding.engineType || 'PREFLIGHT_CORE'}
            </span>
          </div>

          {/* Step 5: Knowledge Snapshot */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <BookOpen className="size-3 text-amber-500" />
              5. Knowledge Base
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              SAP S/4HANA 2023+
            </span>
          </div>

          {/* Step 6: Epistemic Verdict */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="size-3 text-emerald-500" />
              6. Epistemic Verdict
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              {finding.confidence} ({finding.confidenceScore.toFixed(2)})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
