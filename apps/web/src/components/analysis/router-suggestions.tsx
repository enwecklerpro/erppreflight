'use client';

import * as React from 'react';
import { Bot, CheckCircle2, CircleDashed, FileText, Info, Lightbulb, Link2, MapPin, Star, StarHalf } from 'lucide-react';
import type { ProblemRouteResponse } from '@erppreflight/schemas';
import { useT } from '@/i18n/client';

const REASON_ICON = { PHRASE: Lightbulb, ARTIFACT: FileText, CONTEXT: MapPin, OBJECT: Link2 } as const;

/**
 * Router result: rule-derived engine suggestions with reasons, conditions and
 * additional required inputs (from the engines' declared input contracts), plus
 * the optional AI second opinion kept visually separate (Part 17.16).
 */
export function RouterSuggestions({ result }: { result: ProblemRouteResponse }) {
  const t = useT();
  const reasonLabel = (kind: keyof typeof REASON_ICON) =>
    kind === 'PHRASE'
      ? t('analyze.reasonPhrase')
      : kind === 'ARTIFACT'
      ? t('analyze.reasonArtifact')
      : kind === 'CONTEXT'
      ? t('analyze.reasonContext')
      : t('analyze.reasonObject');

  return (
    <section aria-labelledby="router-suggestions-title" className="space-y-3" data-testid="router-suggestions">
      <h2 id="router-suggestions-title" className="text-sm font-bold text-foreground">
        {t('analyze.suggestionsTitle')}
      </h2>
      <p className="text-[11px] text-muted-foreground">{result.notice}</p>
      {!result.contractsAvailable && (
        <p role="status" className="text-xs text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
          <Info className="size-3.5" aria-hidden="true" /> {t('analyze.contractsUnavailable')}
        </p>
      )}
      {result.unmatched ? (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground" role="status">
          {t('analyze.noSuggestions')}
        </div>
      ) : (
        <ul className="space-y-2">
          {result.suggestions.map((s) => {
            const RoleIcon = s.role === 'PRIMARY' ? Star : StarHalf;
            return (
              <li
                key={s.engine}
                data-engine={s.engine}
                data-role={s.role}
                className={`rounded-xl border p-3 text-xs ${s.role === 'PRIMARY' ? 'border-primary/50 bg-primary/5' : 'border-border bg-card'}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm text-foreground">{s.engineName}</span>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[10px] font-bold uppercase">
                    <RoleIcon className="size-3" aria-hidden="true" />
                    {s.role === 'PRIMARY' ? t('analyze.primary') : t('analyze.secondary')}
                  </span>
                  <span className="text-muted-foreground">
                    {t('analyze.confidence', { value: s.confidence.toFixed(2) })} · RULE_DERIVED
                  </span>
                </div>
                {s.condition && <p className="mt-1 text-muted-foreground italic">{t('analyze.condition', { condition: s.condition })}</p>}
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <div>
                    <p className="font-semibold text-foreground">{t('analyze.why')}</p>
                    <ul className="mt-1 space-y-0.5">
                      {s.why.map((w, i) => {
                        const Icon = REASON_ICON[w.kind];
                        return (
                          <li key={`${w.kind}-${i}`} className="flex items-start gap-1.5 text-muted-foreground">
                            <Icon className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                            <span>
                              <span className="sr-only">{reasonLabel(w.kind)}: </span>
                              {w.detail}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">{t('analyze.requiredInputs')}</p>
                    {s.requiredInputs === null ? (
                      <p className="text-muted-foreground">{t('analyze.contractsUnavailable')}</p>
                    ) : (
                      <ul className="mt-1 space-y-0.5">
                        {s.requiredInputs.map((r, i) => (
                          <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                            {r.satisfiedBy.length > 0 ? (
                              <CheckCircle2 className="size-3.5 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
                            ) : (
                              <CircleDashed className="size-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>
                              {r.description} —{' '}
                              {r.satisfiedBy.length > 0
                                ? t('analyze.satisfiedBy', { files: r.satisfiedBy.join(', ') })
                                : t('analyze.notSatisfied')}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {s.acceptedFormats.length > 0 && (
                      <p className="mt-1 text-[11px] text-muted-foreground">{t('analyze.acceptedFormats', { formats: s.acceptedFormats.join(', ') })}</p>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {result.ai.status !== 'NOT_REQUESTED' && (
        <div className="rounded-xl border border-dashed border-purple-400/60 p-3 text-xs" data-testid="router-ai" data-ai-status={result.ai.status}>
          <p className="flex items-center gap-1.5 font-semibold text-foreground">
            <Bot className="size-4" aria-hidden="true" /> {t('analyze.aiTitle')} · {result.ai.status}
          </p>
          <p className="text-muted-foreground mt-1">{result.ai.note}</p>
          {result.ai.model && (
            <p className="text-muted-foreground">
              {t('analyze.aiMeta', { model: result.ai.model, provider: result.ai.provider ?? '', tokens: result.ai.tokens ?? 0 })}
            </p>
          )}
          {result.ai.suggestions.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {result.ai.suggestions.map((s) => (
                <li key={s.engine}>
                  <span className="font-mono">{s.engine}</span> ({s.confidenceClass} {s.confidence.toFixed(2)}) —{' '}
                  {s.agreesWithDeterministic ? t('analyze.aiAgrees') : t('analyze.aiDiffers')}: {s.reason}
                </li>
              ))}
            </ul>
          )}
          {result.ai.conflicts.map((c) => (
            <p key={c} className="text-amber-800 dark:text-amber-300">
              ⚠ {c}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
