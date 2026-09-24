'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Project, TargetRelease } from '@erppreflight/schemas';
import { fetchProjects, createProject, CreateProjectPayload } from '../../lib/api-client';
import {
  FolderGit2,
  Plus,
  ArrowRight,
  Calendar,
  Server,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';

const TARGET_RELEASES = [
  { value: 'S4H_2023', label: 'SAP S/4HANA 2023 (Private / On-Premise)' },
  { value: 'S4HC_2408', label: 'SAP S/4HANA Cloud Public Edition 2408' },
  { value: 'S4HC_2402', label: 'SAP S/4HANA Cloud Public Edition 2402' },
  { value: 'S4H_2022', label: 'SAP S/4HANA 2022' },
  { value: 'ECC_608', label: 'SAP ERP 6.0 EHP8' },
];

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formRelease, setFormRelease] = useState('S4H_2023');
  const [formError, setFormError] = useState<string | null>(null);

  const {
    data: projects = [],
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: fetchProjects,
    staleTime: 1000 * 30,
  });

  const createMutation = useMutation({
    mutationFn: (payload: CreateProjectPayload) => createProject(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'summary'] });
      setIsModalOpen(false);
      setFormName('');
      setFormDesc('');
      setFormRelease('S4H_2023');
      setFormError(null);
    },
    onError: (err: any) => {
      setFormError(err?.message || 'Failed to create project workspace');
    },
  });

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      setFormError('Project name is required.');
      return;
    }
    setFormError(null);
    createMutation.mutate({
      name: formName.trim(),
      description: formDesc.trim() || undefined,
      targetRelease: formRelease,
      environments: ['DEV', 'TEST', 'PROD'],
    });
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground flex items-center gap-2">
            <FolderGit2 className="h-6 w-6 text-primary" />
            Project Workspaces
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Manage migration projects, staging artifacts, and preflight assessment runs
          </p>
        </div>

        <button
          onClick={() => {
            setFormError(null);
            setIsModalOpen(true);
          }}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {/* Loading Skeletons */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="bg-card border border-border rounded-xl p-6 h-48 animate-pulse flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="h-4 bg-muted rounded w-28" />
                <div className="h-6 bg-muted rounded w-3/4" />
                <div className="h-3 bg-muted rounded w-full" />
              </div>
              <div className="h-4 bg-muted rounded w-1/3" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="p-8 text-center bg-card border border-border rounded-xl">
          <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground">
            Error loading project workspaces
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {(error as Error)?.message || 'Network error'}
          </p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-3 py-1.5 bg-primary text-white text-xs font-medium rounded-lg hover:bg-blue-600 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : projects.length === 0 ? (
        /* Zero State */
        <div className="p-12 text-center bg-card border border-dashed border-border rounded-xl">
          <FolderGit2 className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-60" />
          <h3 className="text-base font-bold text-foreground">
            No Project Workspaces Yet
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Create your first preflight project workspace to stage SAP artifacts, run
            deterministic preflight engines, and track Clean Core compliance.
          </p>
          <button
            onClick={() => {
              setFormError(null);
              setIsModalOpen(true);
            }}
            className="mt-5 inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Create First Project
          </button>
        </div>
      ) : (
        /* Real Projects Grid */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {projects.map((proj) => (
            <div
              key={proj.id}
              className="bg-card border border-border rounded-xl p-6 shadow-sm hover:border-primary/50 transition-all flex flex-col justify-between"
            >
              <div>
                <div className="flex items-start justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-mono font-bold px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
                    <Server className="h-3 w-3" />
                    Target: {proj.targetRelease}
                  </span>
                  <div className="flex gap-1">
                    {(proj.environments || ['DEV', 'TEST', 'PROD']).map((env) => (
                      <span
                        key={env}
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                      >
                        {env}
                      </span>
                    ))}
                  </div>
                </div>

                <h2 className="text-lg font-bold text-foreground mt-3">
                  {proj.name}
                </h2>
                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {proj.description || 'No description provided.'}
                </p>
              </div>

              <div className="mt-6 pt-4 border-t border-border flex items-center justify-between">
                <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Created: {new Date(proj.createdAt || Date.now()).toLocaleDateString()}
                </span>

                <Link
                  href={`/projects/${proj.id}`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-blue-700"
                >
                  Enter Workspace
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Accessible Create Project Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-card border border-border rounded-2xl w-full max-w-lg shadow-2xl p-6 relative">
            <button
              onClick={() => setIsModalOpen(false)}
              className="absolute top-4 right-4 text-muted-foreground hover:text-foreground p-1 rounded-md"
              aria-label="Close dialog"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <FolderGit2 className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-extrabold text-foreground">
                Create Project Workspace
              </h2>
            </div>
            <p className="text-xs text-muted-foreground mb-5">
              Set up a multi-tenant preflight assessment boundary for your target SAP system.
            </p>

            <form onSubmit={handleCreateSubmit} className="space-y-4">
              {formError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-bold text-foreground mb-1">
                  Project Workspace Name <span className="text-destructive">*</span>
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. S/4HANA 2023 Enterprise Migration Preflight"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-foreground"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-foreground mb-1">
                  Target SAP Release <span className="text-destructive">*</span>
                </label>
                <select
                  value={formRelease}
                  onChange={(e) => setFormRelease(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-foreground"
                >
                  {TARGET_RELEASES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground mt-1">
                  Defines the rule dictionary, deprecation matrices, and Clean Core compatibility baselines.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-foreground mb-1">
                  Description
                </label>
                <textarea
                  rows={3}
                  placeholder="Briefly describe the migration scope, customer landscape, or assessment objectives..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="w-full text-xs px-3 py-2 bg-background border border-border rounded-lg focus:outline-none focus:border-primary text-foreground resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border mt-5">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={createMutation.isPending}
                  className="px-3.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground rounded-lg border border-border transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending}
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 shadow-sm"
                >
                  {createMutation.isPending ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Creating Workspace...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Create Workspace
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
