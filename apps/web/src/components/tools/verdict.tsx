import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, BadgeCheck, CircleHelp, CircleSlash, Lightbulb, Library, Shuffle } from 'lucide-react';
import type { Locale } from '@/i18n/config';
import type { MessageKey, TFunction } from '@/i18n/translate';
import { localizePath } from '@/lib/routing';
import type { ReleaseFact, Verdict } from '@/lib/public-tools';
import { StateBadge } from './state-badge';

const VERDICT_STYLE: Record<Verdict, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  RELEASED: { icon: BadgeCheck, className: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100' },
  RELEASED_ELSEWHERE: { icon: Shuffle, className: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100' },
  SUCCESSOR_AVAILABLE: { icon: ArrowRight, className: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' },
  CONCEPT_AVAILABLE: { icon: Lightbulb, className: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100' },
  NOT_RELEASED_NO_SUCCESSOR: { icon: CircleSlash, className: 'border-red-300 bg-red-50 text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100' },
  CLASSIC_API_ONLY: { icon: Library, className: 'border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-100' },
  NO_OFFICIAL_STATE: { icon: CircleHelp, className: 'border-border bg-muted text-foreground' },
};

/** Verdict banner: icon + text + explanation (works in server and client components; pass `t`). */
export function VerdictBanner({ verdict, t, headline }: { verdict: Verdict; t: TFunction; headline?: ReleaseFact | null }) {
  const s = VERDICT_STYLE[verdict];
  const Icon = s.icon;
  return (
    <div className={`flex items-start gap-2 rounded-lg border p-3 ${s.className}`} data-verdict={verdict} data-testid="verdict">
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="space-y-0.5">
        <p className="text-sm font-semibold">{t(`publicTools.verdicts.${verdict}` as MessageKey)}</p>
        <p className="text-xs opacity-90">{t(`publicTools.verdictHelp.${verdict}` as MessageKey)}</p>
        {headline ? (
          <p className="text-[11px] opacity-80">
            {t('publicTools.common.release')}: {headline.releaseLabel}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Release-by-release table (accessible: real table with header cells and captions). */
export function ReleaseTable({
  releases,
  t,
  locale,
  caption,
}: {
  releases: ReleaseFact[];
  t: TFunction;
  locale: Locale;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[560px] text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">{t('publicTools.common.edition')}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{t('publicTools.common.release')}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{t('publicTools.common.state')}</th>
            <th scope="col" className="px-3 py-2 font-semibold">{t('publicTools.common.successors')}</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((r) => (
            <tr key={`${r.editionCode}-${r.releaseId}-${r.scheme}`} className="border-t border-border align-top">
              <td className="px-3 py-2">{t(`publicTools.editions.${r.editionCode}` as MessageKey)}</td>
              <td className="px-3 py-2">{r.releaseLabel}</td>
              <td className="px-3 py-2">
                <StateBadge state={r.supportState} label={t(`publicTools.states.${r.supportState}` as MessageKey)} level={r.cleanCoreLevel} />
              </td>
              <td className="px-3 py-2">
                {r.successors.length === 0 && !r.successorConcept ? (
                  <span className="text-muted-foreground">{t('publicTools.common.none')}</span>
                ) : null}
                {r.successorConcept ? <span className="italic">{r.successorConcept}</span> : null}
                <ul className="flex flex-wrap gap-x-2 gap-y-1">
                  {r.successors.map((s) => (
                    <li key={`${s.sapObjectType}-${s.objectKey}`} className="inline-flex items-center gap-1">
                      {s.slug ? (
                        <Link href={localizePath(locale, `/sap/clean-core/${s.slug}`)} className="font-mono text-primary hover:underline">
                          {s.objectKey}
                        </Link>
                      ) : (
                        <span className="font-mono">{s.objectKey}</span>
                      )}
                      {s.supportState ? (
                        <StateBadge state={s.supportState} label={t(`publicTools.states.${s.supportState}` as MessageKey)} />
                      ) : null}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
