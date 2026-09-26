'use client';

import * as React from 'react';
import Link from 'next/link';
import { useForm } from '@tanstack/react-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Archive, BookOpen, CheckCircle2, CircleDashed, ExternalLink, FileSearch, GitPullRequest, Network, Plus, Search, XCircle } from 'lucide-react';
import { FormField } from '@/components/form/form-field';
import { FormInput } from '@/components/form/form-inputs';
import { ErrorState, SkeletonBlock, useCommercialErrorText } from '@/components/commercial/states';
import { useFmt, useLabel, useT } from '@/i18n/client';
import { localizePath } from '@/lib/routing';
import {
  ARTICLE_STATUSES,
  ArticleDraftFormSchema,
  createArticleDraft,
  fetchAdminArticles,
  fetchArticleRevisions,
  fetchArticleWorkflow,
  fetchKgConflicts,
  fetchKgObjects,
  fetchKgSummary,
  knowledgeKeys,
  transitionArticle,
  type AdminArticle,
  type ArticleDraftForm,
  type ArticleStatus,
  type ArticleWorkflow,
} from '@/lib/api/governance';
import { FormGuard, GovernanceHeader, Kpi, Pager, Pill, btn, btnPrimary, card, selectCls, td, th, type Tone } from './shared';

type Tab = 'articles' | 'graph';
const REVIEW_QUEUE: readonly ArticleStatus[] = ['TECHNICAL_REVIEW', 'SEO_REVIEW', 'UPDATE_REQUIRED'];

const ARTICLE_TONE: Record<ArticleStatus, { tone: Tone; icon: React.ComponentType<{ className?: string }> }> = {
  DRAFT: { tone: 'neutral', icon: CircleDashed },
  TECHNICAL_REVIEW: { tone: 'info', icon: GitPullRequest },
  SEO_REVIEW: { tone: 'info', icon: FileSearch },
  PUBLISHED: { tone: 'good', icon: CheckCircle2 },
  UPDATE_REQUIRED: { tone: 'warn', icon: AlertTriangle },
  DEPRECATED: { tone: 'warn', icon: XCircle },
  ARCHIVED: { tone: 'neutral', icon: Archive },
};

export function KnowledgeAdmin() {
  const t = useT();
  const [tab, setTab] = React.useState<Tab>('articles');
  const tabs: Tab[] = ['articles', 'graph'];
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(tabs.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next);
    document.getElementById(`kn-tab-${next}`)?.focus();
  };
  return (
    <div className="space-y-6" data-testid="knowledge-admin">
      <GovernanceHeader title={t('app.governance.knowledge.title')} intro={t('app.governance.knowledge.intro')} />
      <div role="tablist" aria-label={t('app.governance.knowledge.tabs.label')} className="flex gap-2 border-b border-border" onKeyDown={onKey}>
        {tabs.map((id) => (
          <button
            key={id}
            id={`kn-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`kn-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            className={`-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${tab === id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
          >
            {id === 'articles' ? <BookOpen className="size-4" aria-hidden="true" /> : <Network className="size-4" aria-hidden="true" />}
            {t(`app.governance.knowledge.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`kn-panel-${tab}`} aria-labelledby={`kn-tab-${tab}`}>
        {tab === 'articles' ? <ArticlesPanel /> : <GraphPanel />}
      </div>
    </div>
  );
}

function ArticleStatusPill({ status }: { status: ArticleStatus }) {
  const t = useT();
  const s = ARTICLE_TONE[status];
  return <Pill tone={s.tone} icon={s.icon}>{t(`app.governance.knowledge.status.${status}`)}</Pill>;
}

function ArticlesPanel() {
  const t = useT();
  const fmt = useFmt();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const articles = useQuery({ queryKey: knowledgeKeys.articles, queryFn: fetchAdminArticles });
  const workflow = useQuery({ queryKey: knowledgeKeys.workflow, queryFn: fetchArticleWorkflow, staleTime: 5 * 60_000 });
  const [status, setStatus] = React.useState<string>('');
  const [locale, setLocale] = React.useState<string>('');
  const [drafting, setDrafting] = React.useState(false);
  const [history, setHistory] = React.useState<string | null>(null);
  const transition = useMutation({
    mutationFn: (v: { id: string; to: ArticleStatus; reason?: string }) => transitionArticle(v.id, v.to, v.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.articles }),
  });

  const run = (a: AdminArticle, to: ArticleStatus) => {
    if (to === 'UPDATE_REQUIRED') {
      const reason = window.prompt(t('app.governance.knowledge.articles.reasonPrompt'))?.trim();
      if (!reason || reason.length < 5) return;
      transition.mutate({ id: a.id, to, reason });
      return;
    }
    transition.mutate({ id: a.id, to });
  };

  if (articles.isLoading || workflow.isLoading) return <SkeletonBlock className="h-80" />;
  if (articles.isError) return <ErrorState title={t('app.governance.knowledge.articles.loadFailed')} error={articles.error} onRetry={() => articles.refetch()} />;
  if (workflow.isError) return <ErrorState title={t('app.governance.knowledge.articles.loadFailed')} error={workflow.error} onRetry={() => workflow.refetch()} />;
  const all = articles.data ?? [];
  const wf: ArticleWorkflow = workflow.data!;
  const queue = all.filter((a) => REVIEW_QUEUE.includes(a.status));
  const list = all.filter((a) => (!status || (status === 'QUEUE' ? REVIEW_QUEUE.includes(a.status) : a.status === status)) && (!locale || a.locale === locale));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('app.governance.knowledge.articles.filterStatus')}
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('app.governance.knowledge.articles.allStatuses')}</option>
              <option value="QUEUE">{t('app.governance.knowledge.articles.queue')}</option>
              {ARTICLE_STATUSES.map((s) => (
                <option key={s} value={s}>{t(`app.governance.knowledge.status.${s}`)}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('app.governance.knowledge.articles.filterLocale')}
            <select className={selectCls} value={locale} onChange={(e) => setLocale(e.target.value)}>
              <option value="">{t('app.governance.knowledge.articles.allLocales')}</option>
              <option value="en">EN</option>
              <option value="de">DE</option>
            </select>
          </label>
          <button type="button" className={btn} onClick={() => setStatus('QUEUE')}>
            <GitPullRequest className="size-3.5" aria-hidden="true" /> {t('app.governance.knowledge.articles.queueCount', { count: queue.length })}
          </button>
        </div>
        <button type="button" className={btnPrimary} onClick={() => setDrafting((v) => !v)} aria-expanded={drafting} data-testid="new-draft">
          <Plus className="size-3.5" aria-hidden="true" /> {t('app.governance.knowledge.articles.newDraft')}
        </button>
      </div>
      {drafting && <DraftForm onDone={() => setDrafting(false)} />}
      {transition.isError && <p role="alert" className="text-xs text-destructive">{errText(transition.error)}</p>}
      <div className={card}>
        {list.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('app.governance.knowledge.articles.empty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-sm">
              <caption className="sr-only">{t('app.governance.knowledge.articles.caption', { count: list.length })}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>{t('app.governance.knowledge.articles.article')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.articles.locale')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.articles.status')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.articles.updated')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.articles.actions')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {list.map((a) => (
                  <tr key={a.id} data-article={`${a.slug}:${a.locale}`}>
                    <td className={td}>
                      <span className="block font-medium">{a.title}</span>
                      <span className="block font-mono text-xs text-muted-foreground">{a.slug} · v{a.version}</span>
                      {a.updateRequiredReason && <span className="block text-xs text-amber-800 dark:text-amber-300">{a.updateRequiredReason}</span>}
                    </td>
                    <td className={`${td} uppercase`}>{a.locale}</td>
                    <td className={td}><ArticleStatusPill status={a.status} /></td>
                    <td className={`${td} text-xs`}>{fmt.dateTime(a.updatedAt)}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {(wf.transitions[a.status] ?? []).map((to) => (
                          <button
                            key={to}
                            type="button"
                            className={to === 'PUBLISHED' ? btnPrimary : btn}
                            disabled={transition.isPending}
                            onClick={() => run(a, to)}
                            data-testid={`article-${to}`}
                          >
                            {t(`app.governance.knowledge.transitionTo.${to}`)}
                          </button>
                        ))}
                        {wf.publicStatuses.includes(a.status) && (
                          <Link href={localizePath(a.locale, `/knowledge/${a.slug}`)} className={btn} target="_blank" rel="noopener">
                            <ExternalLink className="size-3.5" aria-hidden="true" /> {t('app.governance.knowledge.articles.openPublic')}
                          </Link>
                        )}
                        <button type="button" className={btn} aria-expanded={history === a.id} onClick={() => setHistory(history === a.id ? null : a.id)}>
                          {t('app.governance.knowledge.articles.history')}
                        </button>
                      </div>
                      {history === a.id && <Revisions id={a.id} />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Revisions({ id }: { id: string }) {
  const t = useT();
  const fmt = useFmt();
  const label = useLabel();
  const q = useQuery({ queryKey: knowledgeKeys.revisions(id), queryFn: () => fetchArticleRevisions(id) });
  if (q.isLoading) return <SkeletonBlock className="mt-2 h-12" />;
  if (q.isError) return <ErrorState title={t('app.governance.knowledge.articles.loadFailed')} error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  if (rows.length === 0) return <p className="mt-2 text-xs text-muted-foreground">{t('app.governance.knowledge.articles.noHistory')}</p>;
  return (
    <ol className="mt-2 space-y-0.5 text-xs">
      {rows.map((r) => (
        <li key={r.version}>
          {t('app.governance.knowledge.articles.revision', {
            version: r.version,
            status: label('app.governance.knowledge.status', r.status),
            date: fmt.dateTime(r.createdAt),
          })}
          {r.changeNote ? ` — ${r.changeNote}` : ''}
        </li>
      ))}
    </ol>
  );
}

function DraftForm({ onDone }: { onDone: () => void }) {
  const t = useT();
  const errText = useCommercialErrorText();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: createArticleDraft,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: knowledgeKeys.articles }),
  });
  const defaults: ArticleDraftForm = { slug: '', locale: 'en', title: '', summary: '', bodyMarkdown: '', sourceTitle: '', sourceUrl: '' };
  const form = useForm({
    defaultValues: defaults,
    validators: { onChange: ArticleDraftFormSchema, onSubmit: ArticleDraftFormSchema },
    onSubmit: async ({ value, formApi }) => {
      await create.mutateAsync(value);
      formApi.reset(defaults);
      onDone();
    },
  });
  const text = (name: 'slug' | 'title' | 'summary' | 'sourceTitle' | 'sourceUrl', labelKey: string, required = false) => (
    <form.Field name={name} children={(field) => (
      <FormField id={`draft-${name}`} name={field.name} label={t(labelKey as 'app.governance.knowledge.draft.slug')} required={required} error={field.state.meta.errors as any}>
        <FormInput value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} onBlur={field.handleBlur} />
      </FormField>
    )} />
  );
  return (
    <form.Subscribe
      selector={(s) => ({ isDirty: s.isDirty, isSubmitting: s.isSubmitting, canSubmit: s.canSubmit })}
      children={({ isDirty, isSubmitting, canSubmit }) => (
        <FormGuard isDirty={isDirty} isSubmitting={isSubmitting}>
          <form
            noValidate
            aria-labelledby="draft-title"
            className={`${card} space-y-3`}
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <h2 id="draft-title" className="text-base font-bold">{t('app.governance.knowledge.draft.title')}</h2>
            <p className="text-xs text-muted-foreground">{t('app.governance.knowledge.draft.hint')}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {text('slug', 'app.governance.knowledge.draft.slug', true)}
              <form.Field name="locale" children={(field) => (
                <FormField id="draft-locale" name={field.name} label={t('app.governance.knowledge.draft.locale')} required>
                  <select id="draft-locale" className={selectCls} value={field.state.value} onChange={(e) => field.handleChange(e.target.value as 'en' | 'de')}>
                    <option value="en">EN</option>
                    <option value="de">DE</option>
                  </select>
                </FormField>
              )} />
              {text('title', 'app.governance.knowledge.draft.articleTitle', true)}
              {text('summary', 'app.governance.knowledge.draft.summary', true)}
              {text('sourceTitle', 'app.governance.knowledge.draft.sourceTitle')}
              {text('sourceUrl', 'app.governance.knowledge.draft.sourceUrl')}
            </div>
            <form.Field name="bodyMarkdown" children={(field) => (
              <FormField id="draft-body" name={field.name} label={t('app.governance.knowledge.draft.body')} required error={field.state.meta.errors as any}>
                <textarea
                  id="draft-body"
                  className="min-h-40 w-full rounded-lg border border-input bg-background px-3 py-2 font-mono text-sm"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                />
              </FormField>
            )} />
            {create.isError && <p role="alert" className="text-xs text-destructive">{errText(create.error)}</p>}
            <div className="flex gap-2">
              <button type="submit" className={btnPrimary} disabled={!isDirty || !canSubmit || isSubmitting}>
                {isSubmitting ? t('app.governance.knowledge.draft.creating') : t('app.governance.knowledge.draft.create')}
              </button>
              <button type="button" className={btn} onClick={onDone}>{t('app.governance.common.cancel')}</button>
            </div>
          </form>
        </FormGuard>
      )}
    />
  );
}

const OBJ_PAGE = 25;
const KG_REVIEW_STATUSES = ['DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DEPRECATED', 'SUPERSEDED'] as const;

function GraphPanel() {
  const t = useT();
  const fmt = useFmt();
  const summary = useQuery({ queryKey: knowledgeKeys.kgSummary, queryFn: fetchKgSummary });
  const conflicts = useQuery({ queryKey: knowledgeKeys.kgConflicts, queryFn: fetchKgConflicts });
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [conflictsOnly, setConflictsOnly] = React.useState(false);
  const [offset, setOffset] = React.useState(0);
  React.useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(h);
  }, [q]);
  React.useEffect(() => setOffset(0), [debounced, status, conflictsOnly]);
  const objects = useQuery({
    queryKey: knowledgeKeys.kgObjects(debounced, status, conflictsOnly, offset),
    queryFn: () => fetchKgObjects({ q: debounced, status, conflictsOnly, offset, limit: OBJ_PAGE }),
    placeholderData: (prev) => prev,
  });

  if (summary.isLoading) return <SkeletonBlock className="h-80" />;
  if (summary.isError) return <ErrorState title={t('app.governance.knowledge.graph.loadFailed')} error={summary.error} onRetry={() => summary.refetch()} />;
  const s = summary.data!;
  return (
    <div className="space-y-6" data-testid="kg-admin">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label={t('app.governance.knowledge.graph.objects')} value={fmt.number(s.objects.total)} hint={t('app.governance.knowledge.graph.objectsHint', { published: fmt.number(s.objects.byReviewStatus.PUBLISHED ?? 0) })} />
        <Kpi label={t('app.governance.knowledge.graph.releases')} value={fmt.number(s.releases)} />
        <Kpi label={t('app.governance.knowledge.graph.conflicts')} value={fmt.number(s.conflicts.facts)} hint={t('app.governance.knowledge.graph.conflictsHint', { objects: fmt.number(s.conflicts.objects) })} />
        <Kpi
          label={t('app.governance.knowledge.graph.snapshot')}
          value={s.latestSnapshot ? `#${s.latestSnapshot.seq}` : '—'}
          hint={s.latestSnapshot?.publishedAt ? fmt.dateTime(s.latestSnapshot.publishedAt) : t('app.governance.knowledge.graph.noSnapshot')}
        />
      </div>

      <section aria-labelledby="kg-sources-title" className={`${card} space-y-3`}>
        <h2 id="kg-sources-title" className="text-base font-bold">{t('app.governance.knowledge.graph.sources')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t('app.governance.knowledge.graph.sourcesCaption', { count: s.sources.length })}</caption>
            <thead className="border-b border-border">
              <tr>
                <th scope="col" className={th}>{t('app.governance.knowledge.graph.source')}</th>
                <th scope="col" className={th}>{t('app.governance.knowledge.graph.trust')}</th>
                <th scope="col" className={th}>{t('app.governance.knowledge.graph.facts')}</th>
                <th scope="col" className={th}>{t('app.governance.knowledge.graph.lastRetrieved')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {s.sources.map((src) => (
                <tr key={src.id}>
                  <td className={td}>
                    <span className="block">{src.title}</span>
                    <span className="block font-mono text-xs text-muted-foreground break-all">{src.sourceKey}</span>
                  </td>
                  <td className={`${td} text-xs`}>{src.trustLevel}</td>
                  <td className={`${td} tabular-nums`}>{fmt.number(src.facts)}</td>
                  <td className={`${td} text-xs`}>{src.lastRetrievedAt ? fmt.dateTime(src.lastRetrievedAt) : t('app.governance.common.never')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="kg-objects-title" className={`${card} space-y-3`}>
        <h2 id="kg-objects-title" className="text-base font-bold">{t('app.governance.knowledge.graph.objectsCaption', { total: fmt.number(objects.data?.total ?? 0) })}</h2>
        <div role="search" className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-medium">
            {t('app.governance.knowledge.graph.search')}
            <FormInput value={q} maxLength={120} onChange={(e) => setQ(e.target.value)} leftIcon={<Search className="size-4" aria-hidden="true" />} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium">
            {t('app.governance.knowledge.graph.reviewStatus')}
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('app.governance.knowledge.graph.allStatuses')}</option>
              {KG_REVIEW_STATUSES.map((x) => (
                <option key={x} value={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="inline-flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={conflictsOnly} onChange={(e) => setConflictsOnly(e.target.checked)} /> {t('app.governance.knowledge.graph.conflictsOnly')}
          </label>
        </div>
        {objects.isLoading ? (
          <SkeletonBlock className="h-64" />
        ) : objects.isError ? (
          <ErrorState title={t('app.governance.knowledge.graph.loadFailed')} error={objects.error} onRetry={() => objects.refetch()} />
        ) : (objects.data?.items.length ?? 0) === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('app.governance.knowledge.graph.emptyObjects')}</p>
        ) : (
          <div className="overflow-x-auto" aria-busy={objects.isFetching}>
            <table className="w-full min-w-[56rem] text-sm">
              <caption className="sr-only">{t('app.governance.knowledge.graph.objectsCaption', { total: objects.data!.total })}</caption>
              <thead className="border-b border-border">
                <tr>
                  <th scope="col" className={th}>{t('app.governance.knowledge.graph.object')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.graph.review')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.graph.sourcesCount')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.graph.validity')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.graph.lastVerified')}</th>
                  <th scope="col" className={th}>{t('app.governance.knowledge.graph.conflictCount')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {objects.data!.items.map((o) => (
                  <tr key={o.id}>
                    <td className={td}>
                      <Link href={`/knowledge-graph/objects/${o.id}`} className="font-mono text-xs font-semibold underline-offset-2 hover:underline">
                        {o.sapObjectType} {o.objectKey}
                      </Link>
                      <span className="block text-xs text-muted-foreground">{o.displayName ?? o.objectType}</span>
                    </td>
                    <td className={`${td} text-xs`}>{o.reviewStatus}{o.reviewedBy ? ` · ${o.reviewedBy}` : ''}</td>
                    <td className={`${td} tabular-nums`}>{o.sources}</td>
                    <td className={`${td} text-xs`}>
                      {o.releaseValidity.releases > 0
                        ? t('app.governance.knowledge.graph.validityValue', { count: o.releaseValidity.releases, first: o.releaseValidity.first ?? '—', last: o.releaseValidity.last ?? '—' })
                        : t('app.governance.knowledge.graph.noValidity')}
                    </td>
                    <td className={`${td} text-xs`}>{o.lastVerifiedAt ? fmt.dateTime(o.lastVerifiedAt) : t('app.governance.common.never')}</td>
                    <td className={td}>
                      {o.conflicts > 0 ? (
                        <Pill tone="warn" icon={AlertTriangle}>{t('app.governance.knowledge.graph.hasConflicts', { count: o.conflicts })}</Pill>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs"><CheckCircle2 className="size-3.5" aria-hidden="true" /> {t('app.governance.knowledge.graph.noConflicts')}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {objects.data && <Pager offset={offset} limit={OBJ_PAGE} total={objects.data.total} onChange={setOffset} />}
      </section>

      <section aria-labelledby="kg-conflicts-title" className={`${card} space-y-3`}>
        <h2 id="kg-conflicts-title" className="text-base font-bold">{t('app.governance.knowledge.graph.conflictsTitle')}</h2>
        {conflicts.isLoading ? (
          <SkeletonBlock className="h-20" />
        ) : conflicts.isError ? (
          <ErrorState title={t('app.governance.knowledge.graph.loadFailed')} error={conflicts.error} onRetry={() => conflicts.refetch()} />
        ) : (conflicts.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('app.governance.knowledge.graph.conflictsEmpty')}</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {conflicts.data!.map((c) => (
              <li key={`${c.objectId}-${c.release}-${c.scheme}`}>
                <Link href={`/knowledge-graph/objects/${c.objectId}`} className="font-mono text-xs font-semibold hover:underline">
                  {t('app.governance.knowledge.graph.conflictRow', { object: `${c.sapObjectType} ${c.objectKey}`, release: c.release, scheme: c.scheme })}
                </Link>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  {c.assertions.map((a, i) => (
                    <li key={i}>{a.source} ({a.trustLevel}): {a.supportState}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
