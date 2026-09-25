'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Layers,
  FileCheck2,
  Cpu,
  ArrowRight,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  FileSpreadsheet,
  AlertCircle,
  Sparkles,
} from 'lucide-react';
import { fetchAnalysisTemplates, createAnalysisTemplate, AnalysisTemplateItem, fetchProjects } from '../../lib/api-client';

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const [selectedDomain, setSelectedDomain] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTemplate, setActiveTemplate] = useState<AnalysisTemplateItem | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Form states
  const [customName, setCustomName] = useState('');
  const [customDesc, setCustomDesc] = useState('');
  const [customDomain, setCustomDomain] = useState('Migration & Clean Core');
  const [customEngines, setCustomEngines] = useState('CLEAN_CORE_OBJECT_GUARD, EXTENSION_IMPACT_GUARD');
  const [customInputs, setCustomInputs] = useState('ABAP Source Code ZIP');

  const { data: templates = [], isLoading, error } = useQuery({
    queryKey: ['templates'],
    queryFn: fetchAnalysisTemplates,
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: fetchProjects,
  });

  const createMutation = useMutation({
    mutationFn: createAnalysisTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates'] });
      setIsCreateModalOpen(false);
      setCustomName('');
      setCustomDesc('');
    },
  });

  const domains = [
    'ALL',
    'Output & Extensibility',
    'Migration & Clean Core',
    'Integration',
    'Release & Transport',
    'Operations',
    'Warehouse Automation',
  ];

  const filteredTemplates = templates.filter((tpl) => {
    const matchesDomain = selectedDomain === 'ALL' || tpl.targetDomain === selectedDomain;
    const matchesSearch =
      tpl.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      tpl.engines.some((e) => e.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesDomain && matchesSearch;
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customName || !customDesc) return;

    createMutation.mutate({
      name: customName,
      description: customDesc,
      targetDomain: customDomain,
      engines: customEngines.split(',').map((s) => s.trim()).filter(Boolean),
      requiredInputs: customInputs.split(',').map((s) => s.trim()).filter(Boolean),
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
              Part 14.3 Enterprise Addendum
            </span>
            <span className="text-xs text-muted-foreground font-mono">100% Deterministic</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground mt-1">
            Analysis Templates Catalog
          </h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Pre-configured preflight workflows with standardized engine selections, required artifact specifications, and enterprise audit checks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Create Custom Template</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search templates, engines, or standard checks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        {/* Domain Filter Pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 md:pb-0 scrollbar-none">
          {domains.map((domain) => (
            <button
              key={domain}
              onClick={() => setSelectedDomain(domain)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                selectedDomain === domain
                  ? 'bg-primary text-white font-semibold shadow-sm'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {domain === 'ALL' ? 'All Domains' : domain}
            </button>
          ))}
        </div>
      </div>

      {/* Loading & Error States */}
      {isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-64 rounded-xl border border-border bg-card p-6 animate-pulse space-y-4">
              <div className="h-4 bg-muted rounded w-1/3" />
              <div className="h-6 bg-muted rounded w-3/4" />
              <div className="h-16 bg-muted rounded w-full" />
              <div className="h-8 bg-muted rounded w-full" />
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center space-y-2">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto" />
          <h3 className="font-semibold text-foreground">Failed to Load Templates</h3>
          <p className="text-sm text-muted-foreground">Unable to fetch template inventory from server.</p>
        </div>
      )}

      {/* Templates Grid */}
      {!isLoading && !error && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTemplates.map((template) => (
            <div
              key={template.id}
              className="rounded-xl border border-border bg-card p-6 flex flex-col justify-between hover:border-primary/50 transition-all hover:shadow-md group"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                    {template.targetDomain}
                  </span>
                  {template.isSystemTemplate ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                      SYSTEM
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
                      CUSTOM
                    </span>
                  )}
                </div>

                <div>
                  <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                    {template.name}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1.5 line-clamp-3 leading-relaxed">
                    {template.description}
                  </p>
                </div>

                {/* Engines badge list */}
                <div className="space-y-1.5 pt-2 border-t border-border/60">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Engines Utilized</span>
                  <div className="flex flex-wrap gap-1">
                    {template.engines.map((eng) => (
                      <span
                        key={eng}
                        className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground border border-border/60"
                      >
                        {eng}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Standard checks count */}
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-muted-foreground">Standard Checks</span>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    {template.standardChecks.slice(0, 2).map((check, idx) => (
                      <li key={idx} className="flex items-center gap-1.5">
                        <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                        <span className="truncate">{check}</span>
                      </li>
                    ))}
                    {template.standardChecks.length > 2 && (
                      <li className="text-[11px] text-muted-foreground/80 pl-4.5">
                        +{template.standardChecks.length - 2} more verification rules
                      </li>
                    )}
                  </ul>
                </div>
              </div>

              {/* Action */}
              <div className="pt-6 mt-6 border-t border-border flex items-center justify-between">
                <span className="text-xs font-mono text-muted-foreground">
                  {template.reportType}
                </span>
                <button
                  onClick={() => {
                    setActiveTemplate(template);
                    setIsApplyModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary hover:text-white text-primary text-xs font-semibold transition-colors"
                >
                  <span>Use Template</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Apply Template Modal */}
      {isApplyModalOpen && activeTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <div className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-6">
            <div className="space-y-1">
              <span className="text-xs uppercase font-bold text-primary">Preflight Execution</span>
              <h2 className="text-xl font-bold text-foreground">Launch: {activeTemplate.name}</h2>
              <p className="text-xs text-muted-foreground">{activeTemplate.description}</p>
            </div>

            <div className="p-3.5 bg-muted/40 rounded-xl border border-border space-y-2 text-xs">
              <div className="font-semibold text-foreground">Required Input Artifacts:</div>
              <ul className="list-disc pl-4 space-y-1 text-muted-foreground">
                {activeTemplate.requiredInputs.map((inp, idx) => (
                  <li key={idx}>{inp}</li>
                ))}
              </ul>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">Target Project Workspace</label>
              <select
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm text-foreground focus:ring-2 focus:ring-primary/20"
              >
                <option value="">Select an active project workspace...</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.targetRelease})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsApplyModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <Link
                href={
                  selectedProjectId
                    ? `/projects/${selectedProjectId}?template=${activeTemplate.slug}`
                    : '/projects'
                }
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm"
              >
                Proceed to Workspace
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Create Custom Template Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
          <form
            onSubmit={handleCreateSubmit}
            className="bg-card border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="space-y-1">
              <span className="text-xs uppercase font-bold text-primary">Custom Configuration</span>
              <h2 className="text-xl font-bold text-foreground">Create Analysis Template</h2>
              <p className="text-xs text-muted-foreground">
                Define an organization-wide preflight template for your transformation workstreams.
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-foreground block mb-1">Template Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. S/4HANA FI-GL Clean Core Assessment"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Domain</label>
                <select
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                >
                  {domains.filter((d) => d !== 'ALL').map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Description</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Explain the purpose and expected deliverables of this template..."
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Target Engines (comma-separated IDs)</label>
                <input
                  type="text"
                  value={customEngines}
                  onChange={(e) => setCustomEngines(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm font-mono"
                />
              </div>

              <div>
                <label className="font-semibold text-foreground block mb-1">Required Inputs (comma-separated)</label>
                <input
                  type="text"
                  value={customInputs}
                  onChange={(e) => setCustomInputs(e.target.value)}
                  className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-border">
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="px-4 py-2 rounded-lg border border-border text-sm text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createMutation.isPending}
                className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 disabled:opacity-50"
              >
                {createMutation.isPending ? 'Saving...' : 'Save Template'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
