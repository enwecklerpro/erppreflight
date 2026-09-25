'use client';

import React from 'react';
import { Finding, ConfidenceClass } from '@erppreflight/schemas';
import { ShieldCheck, FileCode, Hash, AlertTriangle, X } from 'lucide-react';

interface EvidenceInspectorProps {
  finding: Finding | null;
  onClose: () => void;
}

export function EvidenceInspector({ finding, onClose }: EvidenceInspectorProps) {
  if (!finding) return null;

  const getConfidenceBadge = (confidence: ConfidenceClass) => {
    switch (confidence) {
      case 'VERIFIED':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300 border border-green-300 dark:border-green-800 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-green-600" />
            VERIFIED (Score: 1.0)
          </span>
        );
      case 'RULE_DERIVED':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800 flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-blue-600" />
            RULE_DERIVED (Score: 0.85)
          </span>
        );
      case 'INFERRED':
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            INFERRED (Score: 0.60)
          </span>
        );
      default:
        return (
          <span className="px-2.5 py-1 text-xs font-bold rounded-md bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300 border border-zinc-300 dark:border-zinc-700">
            UNKNOWN (Score: 0.30)
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-card border border-border w-full max-w-3xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between bg-muted/40">
          <div className="flex items-center space-x-3">
            <span
              className={`px-2 py-0.5 text-xs font-bold rounded ${
                finding.severity === 'BLOCKER'
                  ? 'bg-red-600 text-white'
                  : finding.severity === 'CRITICAL'
                  ? 'bg-orange-500 text-white'
                  : 'bg-yellow-500 text-white'
              }`}
            >
              {finding.severity}
            </span>
            <span className="text-xs font-mono text-muted-foreground">
              {finding.ruleId}
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          <div>
            <h2 className="text-lg font-bold text-foreground">{finding.title}</h2>
            <div className="mt-2 flex items-center gap-3">
              {getConfidenceBadge(finding.confidence)}
              <span className="text-xs text-muted-foreground font-mono">
                Engine: {finding.engineType}
              </span>
            </div>
            <p className="mt-3 text-sm text-foreground/90 leading-relaxed">
              {finding.description}
            </p>
          </div>

          {/* Remediation */}
          <div className="p-4 rounded-lg bg-blue-50/50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50">
            <h3 className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
              Recommended Remediation
            </h3>
            <p className="mt-1 text-sm text-blue-900 dark:text-blue-100">
              {finding.remediation}
            </p>
          </div>

          {/* Evidence Chain */}
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2 mb-3">
              <FileCode className="h-4 w-4 text-primary" />
              Cryptographic Evidence & Provenance
            </h3>

            {finding.evidence && finding.evidence.length > 0 ? (
              <div className="space-y-3">
                {finding.evidence.map((ev, idx) => (
                  <div
                    key={idx}
                    className="border border-border rounded-lg p-3 bg-muted/20 text-xs font-mono space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                      <span className="break-all">Path: {ev.artifactPath}</span>
                      {ev.lineNumber !== undefined && ev.lineNumber !== null && (
                        <span>
                          Line: {ev.lineNumber}
                          {ev.columnNumber ? `:${ev.columnNumber}` : ''}
                        </span>
                      )}
                      {typeof ev.trustScore === 'number' && (
                        <span>Trust: {ev.trustScore.toFixed(2)}</span>
                      )}
                    </div>

                    {ev.snippet && (
                      <div className="p-2.5 bg-zinc-900 text-zinc-100 rounded text-xs font-mono overflow-x-auto">
                        <code>{ev.snippet}</code>
                      </div>
                    )}

                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Hash className="h-3 w-3" />
                      <span className="font-mono text-[10px] break-all">
                        SHA-256: {ev.sha256}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground italic">
                No raw snippet evidence attached.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary-dark transition-colors"
          >
            Close Inspector
          </button>
        </div>
      </div>
    </div>
  );
}
