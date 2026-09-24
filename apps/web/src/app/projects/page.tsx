'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Project } from '@erppreflight/schemas';
import { fetchProjects } from '../../lib/api-client';
import { FolderGit2, Plus, ArrowRight, Calendar, Server } from 'lucide-react';

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProjects().then((data) => {
      setProjects(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="space-y-6">
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
          onClick={() => alert('New Project creation form modal available')}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-primary text-white text-xs font-semibold rounded-lg hover:bg-primary-dark transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      {loading ? (
        <div className="p-12 text-center text-muted-foreground text-sm">
          Loading project workspaces...
        </div>
      ) : (
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
                    {proj.environments?.map((env) => (
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
    </div>
  );
}
