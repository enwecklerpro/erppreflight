'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, ClipboardList, RotateCcw, Stethoscope } from 'lucide-react';
import { useLocale, useMessages, useT } from '@/i18n/client';
import { FIORI_TREE, walkFioriTree, type FioriQuestionId } from '@/lib/fiori-403-tree';
import { localizePath } from '@/lib/routing';
import { useUrlParam } from './client-common';

/** Guided, deterministic Fiori 403 decision tree; the answer path lives in the URL (?path=). */
export function Fiori403Tool() {
  const t = useT();
  const locale = useLocale();
  const m = useMessages().publicTools.fiori;
  const [path, setPath] = useUrlParam('path');
  const walk = walkFioriTree(path);
  const headingRef = React.useRef<HTMLHeadingElement>(null);

  // Move focus to the new question/outcome after each answer (keyboard and screen-reader users).
  React.useEffect(() => {
    if (path) headingRef.current?.focus();
  }, [path]);

  const answer = (a: string) => setPath([...walk.steps.map((s) => s.answer), a].join(','));
  const back = () => setPath(walk.steps.slice(0, -1).map((s) => s.answer).join(','));

  const question = walk.current ? m.questions[walk.current] : null;
  const outcome = walk.outcome ? m.outcomes[walk.outcome] : null;
  const optionText = (q: FioriQuestionId, a: string) => (m.questions[q].options as Record<string, string>)[a] ?? a;

  return (
    <section className="space-y-4" aria-label={m.metaTitle}>
      <p className="text-sm text-muted-foreground">{t('publicTools.fiori.intro')}</p>

      {walk.steps.length > 0 ? (
        <section aria-labelledby="fiori-answers" className="rounded-xl border border-border bg-muted/30 p-3 text-xs">
          <h2 id="fiori-answers" className="font-semibold">
            {t('publicTools.fiori.yourAnswers')}
          </h2>
          <ol className="mt-1 list-decimal space-y-0.5 pl-5" data-testid="fiori-answers">
            {walk.steps.map((s) => (
              <li key={s.question}>
                <span className="text-muted-foreground">{m.questions[s.question].text}</span> — {optionText(s.question, s.answer)}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {question && walk.current ? (
        <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4" data-testid="fiori-question" data-question={walk.current}>
          <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('publicTools.fiori.step', { n: walk.steps.length + 1 })}
          </legend>
          <h2 ref={headingRef} tabIndex={-1} className="text-lg font-bold focus:outline-none">
            {question.text}
          </h2>
          <ul className="space-y-2">
            {Object.keys(FIORI_TREE[walk.current]).map((a) => (
              <li key={a}>
                <button
                  type="button"
                  onClick={() => answer(a)}
                  className="w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:border-primary/60 hover:bg-muted/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  data-answer={a}
                >
                  {optionText(walk.current!, a)}
                </button>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {outcome ? (
        <article className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/30" data-testid="fiori-outcome" data-outcome={walk.outcome}>
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Stethoscope className="size-3.5" aria-hidden="true" /> {t('publicTools.fiori.likelyCause')}
          </p>
          <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold focus:outline-none">
            {outcome.title}
          </h2>
          <p className="text-sm">{outcome.summary}</p>
          <section aria-labelledby="fiori-collect">
            <h3 id="fiori-collect" className="flex items-center gap-1.5 text-sm font-semibold">
              <ClipboardList className="size-4" aria-hidden="true" /> {t('publicTools.fiori.collect')}
            </h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
              {outcome.evidence.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </section>
          <p className="text-xs">
            {t('publicTools.fiori.relatedFinding')}: <code className="font-mono">{outcome.code}</code>
          </p>
          <p className="rounded-md border border-border bg-background/70 p-2 text-xs text-muted-foreground">{t('publicTools.fiori.notDiagnosis')}</p>
          <Link
            href={localizePath(locale, '/docs/engines/FIORI_403_ROOT_CAUSE_DOCTOR')}
            className="inline-block text-sm font-semibold text-primary hover:underline"
          >
            {t('publicTools.fiori.engineLink')}
          </Link>
        </article>
      ) : null}

      {walk.steps.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={back}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted"
            data-testid="fiori-back"
          >
            <ArrowLeft className="size-4" aria-hidden="true" /> {t('publicTools.fiori.back')}
          </button>
          <button
            type="button"
            onClick={() => setPath('')}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-semibold hover:bg-muted"
          >
            <RotateCcw className="size-4" aria-hidden="true" /> {t('publicTools.fiori.restart')}
          </button>
        </div>
      ) : null}
    </section>
  );
}
