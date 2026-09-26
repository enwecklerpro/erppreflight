import * as React from 'react';
import { Finding } from '@erppreflight/schemas';
import { FileCode, Hash, Wrench, Shield, CheckCircle2, AlertCircle, Copy, Check, ExternalLink, Send, Loader2, GitBranch, Binary, Cpu, BookOpen, UserCheck, ShieldAlert } from 'lucide-react';
import { CleanCoreBadge } from './clean-core-badge';
import { ConfidenceBadge } from './confidence-badge';
import { useT } from '@/i18n/client';
import type { FindingWithLifecycle } from '@/lib/api/findings-lifecycle';
import { FindingEvidenceSummary, FindingLifecyclePanel } from './finding-lifecycle-panel';
import { FindingStatusBadge } from './finding-status-badge';
import { WorkItemIntegration } from './work-item-integration';
import { useLocalizedRule } from '@/i18n/rule-catalog/client';

export function FindingDetailRow({ finding }: { finding: Finding }) {
  const t = useT();
  const rule = useLocalizedRule(finding.ruleId, finding.title, finding.remediation);
  const lifecycleFinding = finding as FindingWithLifecycle;
  // Part 01 §1.8: "show only evidence" mode hides status, collaboration and remediation.
  const [evidenceOnly, setEvidenceOnly] = React.useState(false);
  const [copiedHash, setCopiedHash] = React.useState<string | null>(null);

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopiedHash(id);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  return (
    <div className="rounded-xl border border-border/70 bg-card/60 p-5 shadow-inner space-y-5 text-xs">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-bold text-primary text-sm">{finding.ruleId}</span>
            <span className="text-muted-foreground" aria-hidden="true">•</span>
            <span className="font-medium text-foreground" data-testid="finding-rule-title">{rule.title}</span>
          </div>
          {rule.engineTitle && (
            <p className="text-[11px] text-muted-foreground break-words" data-testid="finding-engine-title" translate="no">
              {t('app.findings.rule.engineTitle', { title: rule.engineTitle })}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <FindingStatusBadge status={lifecycleFinding.lifecycle?.status ?? 'OPEN'} size="sm" />
          <ConfidenceBadge confidence={finding.confidence} score={finding.confidenceScore} size="sm" />
          {finding.affectedObjects?.[0]?.tier && (
            <CleanCoreBadge tier={finding.affectedObjects[0].tier} size="sm" />
          )}
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-muted-foreground" title={t('findingLifecycle.evidenceCard.showOnlyEvidenceHint')}>
        <input
          type="checkbox"
          role="switch"
          aria-checked={evidenceOnly}
          checked={evidenceOnly}
          onChange={(e) => setEvidenceOnly(e.target.checked)}
          className="size-3.5 accent-primary"
          data-testid="evidence-only-toggle"
        />
        <span className="font-semibold text-foreground">{t('findingLifecycle.evidenceCard.showOnlyEvidence')}</span>
        <span className="hidden sm:inline">— {t('findingLifecycle.evidenceCard.showOnlyEvidenceHint')}</span>
      </label>

      <FindingEvidenceSummary finding={lifecycleFinding} />

      {!evidenceOnly && <FindingLifecyclePanel finding={lifecycleFinding} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Column: Remediation Guidance & Affected Objects */}
        {!evidenceOnly && (
        <div className="space-y-4">
          <div className="rounded-lg border border-blue-200/80 bg-blue-50/50 p-4 dark:border-blue-900/50 dark:bg-blue-950/30">
            <h4 className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-blue-700 dark:text-blue-300">
              <Wrench className="size-3.5" />
              {t('findingLifecycle.evidenceCard.suggestedNextAction')}
            </h4>
            <p className="mt-2 text-xs leading-relaxed text-blue-950 dark:text-blue-100" data-testid="finding-remediation">
              {rule.remediation}
            </p>
            {rule.engineRemediation && (
              <div className="mt-2 border-t border-blue-200/70 pt-2 dark:border-blue-900/50">
                <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-200">{t('app.findings.rule.engineRemediation')}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-blue-950 dark:text-blue-100" lang="en" translate="no">
                  {rule.engineRemediation}
                </p>
              </div>
            )}
          </div>

          {/* Spec 10.14: report an incorrect result straight from the finding */}
          <a
            href={`/settings/support?findingId=${encodeURIComponent(finding.id)}${
              (finding as { analysisId?: string }).analysisId
                ? `&analysisId=${encodeURIComponent((finding as { analysisId?: string }).analysisId as string)}`
                : ''
            }`}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            <ShieldAlert className="size-3" aria-hidden="true" />
            {t('app.findings.detail.reportIncorrect')}
          </a>

          {/* Finding-to-Task Work Item Creation (Part 15.8) — configured connectors only */}
          <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2.5">
            <h5 className="font-semibold text-[11px] text-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Send className="size-3 text-primary" aria-hidden="true" />
              {t('app.findings.detail.workManagement')}
            </h5>
            <WorkItemIntegration findingId={finding.id} />
          </div>

          {/* Technical Details Key-Value */}
          {finding.technicalDetails && Object.keys(finding.technicalDetails).length > 0 && (
            <div className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
              <h5 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                {t('app.findings.detail.technicalParameters')}
              </h5>
              <div className="grid grid-cols-2 gap-2 text-xs font-mono" translate="no">
                {Object.entries(finding.technicalDetails).map(([key, val]) => (
                  <div key={key} className="flex flex-col">
                    <span className="text-muted-foreground text-[10px]">{key}:</span>
                    <span className="text-foreground font-semibold break-all whitespace-pre-wrap">
                      {val !== null && typeof val === 'object' ? JSON.stringify(val) : String(val)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Affected SAP Objects */}
          {finding.affectedObjects && finding.affectedObjects.length > 0 && (
            <div className="space-y-2">
              <h5 className="font-semibold text-[11px] text-muted-foreground uppercase tracking-wider">
                {t('app.findings.detail.impactedObjects', { count: finding.affectedObjects.length })}
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

        )}

        {/* Right Column: Cryptographic Evidence Ledger */}
        <div className={evidenceOnly ? 'space-y-3 lg:col-span-2' : 'space-y-3'}>
          <h4 className="flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] text-foreground">
            <Shield className="size-3.5 text-primary" />
            {t('app.findings.detail.evidenceChain')}
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
                        {t('app.findings.detail.line', { line: `${ev.lineNumber}${ev.columnNumber ? `:${ev.columnNumber}` : ''}` })}
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
                      <span className="truncate">{t('app.findings.detail.sha256', { hash: ev.sha256 ?? '' })}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {isSha256Valid ? (
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-sans font-semibold">
                          <CheckCircle2 className="size-3" aria-hidden="true" /> {t('app.findings.detail.verifiedHash')}
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-600 font-sans font-semibold">
                          <AlertCircle className="size-3" aria-hidden="true" /> {t('app.findings.detail.unverifiedHash')}
                        </span>
                      )}
                      {ev.sha256 && (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(ev.sha256, `${idx}-hash`)}
                          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                          aria-label={t('app.findings.detail.copyHash')}
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
              {t('app.findings.detail.noEvidence')}
            </div>
          )}
        </div>
      </div>

      {/* Cryptographic Data Lineage Chain (Part 17.11) */}
      <div className="rounded-lg border border-border/70 bg-muted/10 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h5 className="font-bold text-[11px] text-foreground uppercase tracking-wider flex items-center gap-1.5">
            <GitBranch className="size-3.5 text-primary" />
            {t('app.findings.detail.lineage')}
          </h5>
          <span className="text-[10px] font-mono text-muted-foreground">
            {finding.evidence &&
            finding.evidence.length > 0 &&
            finding.evidence.every(
              (ev) =>
                Boolean(ev.artifactPath) &&
                ev.lineNumber !== undefined &&
                ev.lineNumber !== null &&
                typeof ev.sha256 === 'string' &&
                /^[a-fA-F0-9]{64}$/.test(ev.sha256)
            )
              ? t('app.findings.detail.chainComplete')
              : t('app.findings.detail.chainIncomplete')}
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-[10px]">
          {/* Step 1: Raw Artifact */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <FileCode className="size-3 text-cyan-500" />
              {t('app.findings.detail.stepArtifact')}
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1" title={finding.evidence?.[0]?.artifactPath || t('app.findings.detail.notRecorded')}>
              {finding.evidence?.[0]?.artifactPath ? finding.evidence[0].artifactPath.split('/').pop() : t('app.findings.detail.notRecorded')}
            </span>
          </div>

          {/* Step 2: Digest */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Binary className="size-3 text-emerald-500" />
              {t('app.findings.detail.stepDigest')}
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1" title={finding.evidence?.[0]?.sha256 || t('app.findings.detail.notRecorded')}>
              {finding.evidence?.[0]?.sha256 ? `${finding.evidence[0].sha256.substring(0, 10)}...` : t('app.findings.detail.notRecorded')}
            </span>
          </div>

          {/* Step 3: Parser */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Cpu className="size-3 text-purple-500" />
              {t('app.findings.detail.stepEvidence')}
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              {finding.evidence?.length ?? 0}
            </span>
          </div>

          {/* Step 4: Rule Engine */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <Shield className="size-3 text-blue-500" />
              {t('app.findings.detail.stepEngine')}
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              {finding.engineType || t('app.findings.detail.notRecorded')}
            </span>
          </div>

          {/* Step 5: Knowledge Snapshot */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <BookOpen className="size-3 text-amber-500" />
              {t('app.findings.detail.stepRule')}
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1" title={finding.ruleId}>
              {finding.ruleId || t('app.findings.detail.notRecorded')}
            </span>
          </div>

          {/* Step 6: Epistemic Verdict */}
          <div className="p-2.5 rounded-md bg-background border border-border/80 flex flex-col justify-between">
            <span className="text-muted-foreground flex items-center gap-1">
              <CheckCircle2 className="size-3 text-emerald-500" />
              {t('app.findings.detail.stepVerdict')}
            </span>
            <span className="font-mono text-foreground font-semibold truncate mt-1">
              {t(`app.findings.badges.confidence.${finding.confidence}`)} ({finding.confidenceScore.toFixed(2)})
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
