'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Plus, Search, CheckCircle2, AlertCircle } from 'lucide-react';
import { fetchAnalysisTemplates, createAnalysisTemplate, AnalysisTemplateItem, fetchProjects } from '../../lib/api-client';
import { Dialog } from '@/components/dialog';
import { useEngineDomainLabel } from '@/components/engine-matrix';
import { useErrorText, useT } from '@/i18n/client';

const DOMAINS = ['Output & Extensibility', 'Migration & Clean Core', 'Integration', 'Release & Transport', 'Operations', 'Warehouse Automation'];
const input = 'w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30';

export default function TemplatesPage() {
  const t = useT();
  const errText = useErrorText();
  const domainLabel = useEngineDomainLabel();
  const queryClient = useQueryClient();
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTemplate, setActiveTemplate] = useState<AnalysisTemplateItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customDomain, setCustomDomain] = useState('Migration & Clean Core');
  const [customEngines, setCustomEngines] = useState('CLEAN_CORE_OBJECT_GUARD, EXTENSION_IMPACT_GUARD');
  const [customInputs, setCustomInputs] = useState('');

  const { data: templates = [], isLoading, error, refetch } = useQuery({ queryKey: ['templates'], queryFn: fetchAnalysisTemplates });
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: fetchProjects });

  const createMutation = useMutation({
    mutationFn: createAnalysisTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setIsCreateModalOpen(false);
      setCustomName('');
      setCustomDesc('');
    },
  });

  const q = searchQuery.toLowerCase();
  const filteredTemplates = templates.filter(
    (tpl) =>
      (selectedDomain === 'ALL' || tpl.targetDomain === selectedDomain) &&
      (tpl.name.toLowerCase().includes(q) || tpl.description.toLowerCase().includes(q) || tpl.engines.some((e) => e.toLowerCase().includes(q)))
  );

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName.trim() || !customDesc.trim()) return;
    createMutation.mutate({
      name: customName.trim(),
      description: customDesc.trim(),
      targetDomain: customDomain,
      engines: customEngines.split(',').map((s) => s.trim()).filter(Boolean),
      requiredInputs: customInputs.split(',').map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">{t('app.templates.eyebrow')}</span>
            <span className="text-xs text-muted-foreground">{t('app.templates.deterministic')}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">{t('app.templates.title')}</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">{t('app.templates.intro')}</p>
        </div>
        <button
          type="button"
          onClick={() => setIsCreateModalOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm self-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          <span>{t('app.templates.create')}</span>
        </button>
      </div>

      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <input
            type="search"
            placeholder={t('app.templates.searchPlaceholder')}
            aria-label={t('app.templates.searchLabel')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('app.templates.domainsLabel')}>
          {['ALL', ...DOMAINS].map((domain) => (
            <button
              key={domain}
              type="button"
              aria-pressed={selectedDomain === domain}
              onClick={() => setSelectedDomain(domain)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 ${
                selectedDomain === domain ? 'bg-primary text-white font-semibold shadow-sm' : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {domain === 'ALL' ? t('app.templates.allDomains') : domainLabel(domain)}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" aria-busy="true" aria-label={t('app.templates.loading')}>
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-64 rounded-xl border border-border bg-card p-6 animate-pulse motion-reduce:animate-none space-y-4">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-6 bg-muted rounded w-3/4" />
              <div className="h-16 bg-muted rounded w-full" />
              <div className="h-8 bg-muted rounded w-full" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" aria-hidden="true" />
          <h2 className="font-semibold text-foreground">{t('app.templates.loadFailed')}</h2>
          <p className="text-sm text-muted-foreground">{errText(error)}</p>
          <button type="button" onClick={() => refetch()} className="text-sm font-semibold underline">
            {t('app.ui.retry')}
          </button>
        </div>
      )}

      {!isLoading && !error && filteredTemplates.length === 0 && (
        <p className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">{t('app.templates.empty')}</p>
      )}

      {!isLoading && !error && filteredTemplates.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => (
            <li key={template.id} className="rounded-xl border border-border bg-card p-6 flex flex-col justify-between hover:border-primary/50 transition-colors hover:shadow-md min-w-0">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">{domainLabel(template.targetDomain)}</span>
                  <span
                    className={`text-xs font-bold px-2 py-0.5 rounded ${
                      template.isSystemTemplate ? 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' : 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                    }`}
                  >
                    {template.isSystemTemplate ? t('app.templates.system') : t('app.templates.custom')}
                  </span>
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground break-words">{template.name}</h2>
                  <p className="text-sm text-muted-foreground mt-1.5 line-clamp-3 leading-relaxed">{template.description}</p>
                </div>
                <div className="space-y-1.5 pt-2 border-t border-border/60">
                  <span className="text-xs uppercase font-bold text-muted-foreground">{t('app.templates.engines')}</span>
                  <div className="flex flex-wrap gap-1">
                    {template.engines.map((eng) => (
                      <span key={eng} className="font-mono text-xs px-1.5 py-0.5 rounded bg-muted text-foreground border border-border/60 break-all">
                        {eng}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  <span className="text-xs uppercase font-bold text-muted-foreground">{t('app.templates.checks')}</span>
                  <ul className="text-sm text-muted-foreground space-y-1">
                    {template.standardChecks.slice(0, 2).map((check, idx) => (
                      <li key={idx} className="flex items-center gap-1.5 min-w-0">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" aria-hidden="true" />
                        <span className="truncate">{check}</span>
                      </li>
                    ))}
                    {template.standardChecks.length > 2 && (
                      <li className="text-xs text-muted-foreground/80 pl-4">{t('app.templates.moreChecks', { count: template.standardChecks.length - 2 })}</li>
                    )}
                  </ul>
                </div>
              </div>
              <div className="pt-6 mt-6 border-t border-border flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-mono text-muted-foreground">{template.reportType}</span>
                <button
                  type="button"
                  onClick={() => setActiveTemplate(template)}
                  aria-label={t('app.templates.useLabel', { name: template.name })}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary hover:text-white text-primary text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <span>{t('app.templates.use')}</span>
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {activeTemplate && (
        <Dialog labelledBy="apply-template-title" onClose={() => setActiveTemplate(null)}>
          <div className="space-y-1">
            <span className="text-xs uppercase font-bold text-primary">{t('app.templates.applyEyebrow')}</span>
            <h2 id="apply-template-title" className="text-xl font-bold text-foreground">
              {t('app.templates.applyTitle', { name: activeTemplate.name })}
            </h2>
            <p className="text-sm text-muted-foreground">{activeTemplate.description}</p>
          </div>
          <div className="p-3.5 bg-muted/40 rounded-xl border border-border space-y-2 text-sm">
            <div className="font-semibold text-foreground">{t('app.templates.requiredInputs')}</div>
            <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
              {activeTemplate.requiredInputs.map((inp, idx) => (
                <li key={idx}>{inp}</li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <label htmlFor="template-project" className="text-sm font-semibold text-foreground">
              {t('app.templates.targetProject')}
            </label>
            <select id="template-project" value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)} className={input}>
              <option value="">{t('app.templates.selectProject')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.targetRelease})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3 pt-2">
            <button type="button" onClick={() => setActiveTemplate(null)} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
              {t('app.ui.cancel')}
            </button>
            <Link
              href={selectedProjectId ? `/projects/${selectedProjectId}?template=${activeTemplate.slug}` : '/projects'}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm text-center"
            >
              {t('app.templates.proceed')}
            </Link>
          </div>
        </Dialog>
      )}

      {isCreateModalOpen && (
        <Dialog labelledBy="create-template-title" onClose={() => setIsCreateModalOpen(false)}>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-1">
              <span className="text-xs uppercase font-bold text-primary">{t('app.templates.createEyebrow')}</span>
              <h2 id="create-template-title" className="text-xl font-bold text-foreground">
                {t('app.templates.createTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('app.templates.createIntro')}</p>
            </div>
            {createMutation.isError && (
              <p role="alert" className="text-sm text-destructive">
                {errText(createMutation.error, t('app.templates.createFailed'))}
              </p>
            )}
            <div className="space-y-3 text-sm">
              <div>
                <label htmlFor="tpl-name" className="font-semibold text-foreground block mb-1">{t('app.templates.name')}</label>
                <input id="tpl-name" type="text" required placeholder={t('app.templates.namePlaceholder')} value={customName} onChange={(e) => setCustomName(e.target.value)} className={input} />
              </div>
              <div>
                <label htmlFor="tpl-domain" className="font-semibold text-foreground block mb-1">{t('app.templates.domain')}</label>
                <select id="tpl-domain" value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} className={input}>
                  {DOMAINS.map((d) => (
                    <option key={d} value={d}>
                      {domainLabel(d)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tpl-desc" className="font-semibold text-foreground block mb-1">{t('app.templates.description')}</label>
                <textarea id="tpl-desc" required rows={2} placeholder={t('app.templates.descriptionPlaceholder')} value={customDesc} onChange={(e) => setCustomDesc(e.target.value)} className={input} />
              </div>
              <div>
                <label htmlFor="tpl-engines" className="font-semibold text-foreground block mb-1">{t('app.templates.enginesLabel')}</label>
                <input id="tpl-engines" type="text" value={customEngines} onChange={(e) => setCustomEngines(e.target.value)} className={`${input} font-mono`} />
              </div>
              <div>
                <label htmlFor="tpl-inputs" className="font-semibold text-foreground block mb-1">{t('app.templates.inputsLabel')}</label>
                <input id="tpl-inputs" type="text" placeholder={t('app.templates.inputsPlaceholder')} value={customInputs} onChange={(e) => setCustomInputs(e.target.value)} className={input} />
              </div>
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:items-center justify-end gap-3 pt-4 border-t border-border">
              <button type="button" onClick={() => setIsCreateModalOpen(false)} className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted">
                {t('app.ui.cancel')}
              </button>
              <button type="submit" disabled={createMutation.isPending} className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50">
                {createMutation.isPending ? t('app.templates.saving') : t('app.templates.save')}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
