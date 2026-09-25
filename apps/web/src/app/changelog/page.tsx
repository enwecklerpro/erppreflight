'use client';

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  History,
  Tag,
  Calendar,
  Sparkles,
  ShieldCheck,
  Cpu,
  AlertTriangle,
  Layers,
  Filter,
} from 'lucide-react';
import { fetchChangelogs, ReleaseNoteItem } from '../../lib/api-client';

export default function ChangelogPage() {
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  const { data: changelogs = [], isLoading } = useQuery({
    queryKey: ['changelog', selectedCategory],
    queryFn: () => fetchChangelogs(selectedCategory === 'ALL' ? undefined : selectedCategory),
  });

  const categories = [
    { label: 'All Updates', value: 'ALL' },
    { label: 'Platform Releases', value: 'PLATFORM' },
    { label: 'SAP Knowledge Snapshots', value: 'KNOWLEDGE_SNAPSHOT' },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header */}
      <div className="border-b border-border pb-6 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
            Parts 14.51 & 14.52
          </span>
          <span className="text-xs text-muted-foreground font-mono">Immutable Provenance</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
          Product & SAP Knowledge Changelog
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Historical log of platform releases, engine rule bundle enhancements, and immutable SAP release knowledge snapshots.
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 border-b border-border pb-2">
        {categories.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setSelectedCategory(cat.value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              selectedCategory === cat.value
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      <div className="space-y-8 relative before:absolute before:inset-0 before:left-3.5 before:w-0.5 before:bg-border">
        {isLoading && (
          <div className="space-y-6 pl-10">
            {[1, 2].map((i) => (
              <div key={i} className="h-48 rounded-xl border border-border bg-card p-6 animate-pulse" />
            ))}
          </div>
        )}

        {changelogs.map((item) => {
          const isKnowledge = item.category === 'KNOWLEDGE_SNAPSHOT';

          return (
            <div key={item.id} className="relative pl-10 group">
              {/* Bullet node */}
              <div
                className={`absolute left-0 top-1.5 h-7 w-7 rounded-full border-4 border-card flex items-center justify-center ${
                  isKnowledge ? 'bg-purple-600 text-white' : 'bg-primary text-white'
                }`}
              >
                {isKnowledge ? <Layers className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
              </div>

              {/* Card */}
              <div className="rounded-xl border border-border bg-card p-6 space-y-4 hover:border-primary/50 transition-all shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-border/60 pb-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${
                        isKnowledge
                          ? 'bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300'
                          : 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
                      }`}
                    >
                      {item.version}
                    </span>
                    <span className="text-xs uppercase font-semibold text-muted-foreground">
                      {item.category.replace(/_/g, ' ')}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                    <Calendar className="h-3.5 w-3.5" />
                    <span>{item.releaseDate}</span>
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">{item.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.summary}</p>
                </div>

                {/* Features */}
                {item.features.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      Platform Capabilities Added
                    </span>
                    <ul className="space-y-1 text-xs text-foreground/90">
                      {item.features.map((feat, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-primary font-bold">•</span>
                          <span>{feat}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Engine Changes */}
                {item.engineChanges.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Preflight Engine Enhancements
                    </span>
                    <ul className="space-y-1 text-xs text-foreground/90">
                      {item.engineChanges.map((eng, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-emerald-500 font-bold">•</span>
                          <span>{eng}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Knowledge Updates */}
                {item.knowledgeUpdates.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-600 dark:text-purple-400">
                      SAP Knowledge Catalog Sync
                    </span>
                    <ul className="space-y-1 text-xs text-foreground/90">
                      {item.knowledgeUpdates.map((know, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-purple-500 font-bold">•</span>
                          <span>{know}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Breaking Changes */}
                {item.breakingChanges.length > 0 && (
                  <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20 text-xs space-y-1 text-destructive">
                    <div className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="h-4 w-4" />
                      <span>SAP Deprecation / Breaking Changes</span>
                    </div>
                    <ul className="list-disc pl-4 space-y-0.5 text-[11px]">
                      {item.breakingChanges.map((brk, idx) => (
                        <li key={idx}>{brk}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
