'use client';

import React from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  ShieldAlert,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  FileCode,
  AlertCircle,
  Loader2
} from 'lucide-react';

interface KnowledgeArticle {
  title: string;
  problemSummary: string;
  targetRelease: string;
  engine: string;
  rootCause: string;
  remediationSteps: string[];
  evidenceSnippet: string;
  toolCta: string;
  toolCtaLink: string;
}

export default function KnowledgeArticlePage() {
  const params = useParams();
  const slug = params.slug as string;

  const { data: article, isLoading, isError } = useQuery<KnowledgeArticle>({
    queryKey: ['knowledge', slug],
    queryFn: async () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const res = await fetch(`${apiUrl}/api/knowledge/${slug}`);
      if (!res.ok) {
        throw new Error('Article not found');
      }
      return res.json();
    }
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-emerald-500" />
          <p className="text-sm text-slate-400">Loading knowledge article...</p>
        </div>
      </div>
    );
  }

  if (isError || !article) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 flex flex-col items-center justify-center">
        <AlertCircle className="w-12 h-12 text-amber-500 mb-4" />
        <h1 className="text-2xl font-bold text-white mb-2">Article not found</h1>
        <p className="text-slate-400 mb-6">The requested knowledge article could not be found or has been removed.</p>
        <Link href="/" className="px-4 py-2 bg-slate-800 hover:bg-slate-700 rounded-lg text-sm font-medium transition-colors">
          Return Home
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-slate-500 mb-6 font-medium">
          <Link href="/" className="hover:text-emerald-400">Home</Link>
          <span>/</span>
          <Link href="/matrix" className="hover:text-emerald-400">Knowledge</Link>
          <span>/</span>
          <span className="text-slate-300 truncate">{slug}</span>
        </div>

        {/* Header */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 mb-8 shadow-xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            <BookOpen className="w-3.5 h-3.5" />
            Verified Preflight Resolution Guide
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-3">
            {article.title}
          </h1>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-400 mb-4">
            <span>Target Scope: <strong className="text-cyan-400 font-mono">{article.targetRelease}</strong></span>
            <span>•</span>
            <span>Engine: <strong className="text-emerald-400 font-mono">{article.engine}</strong></span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-xl border border-slate-800/80">
            {article.problemSummary}
          </p>
        </div>

        {/* Root Cause & Remediation */}
        <div className="space-y-6 mb-8">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              Technical Root Cause
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">{article.rootCause}</p>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              Verified Technical Remediation Steps
            </h2>
            <ol className="list-decimal list-inside space-y-2 text-xs text-slate-300">
              {article.remediationSteps.map((step, idx) => (
                <li key={idx} className="leading-relaxed">{step}</li>
              ))}
            </ol>
          </div>

          <div className="bg-slate-900 border border-slate-800 rounded-xl p-6">
            <h2 className="text-base font-bold text-white mb-2 flex items-center gap-2">
              <FileCode className="w-4 h-4 text-cyan-400" />
              Deterministic Evidence Pattern
            </h2>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono text-emerald-400 overflow-x-auto">
              {article.evidenceSnippet}
            </pre>
          </div>
        </div>

        {/* CTA Card */}
        <div className="bg-gradient-to-r from-emerald-950/40 to-slate-900 border border-emerald-500/30 rounded-2xl p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">Verify Your Own SAP Landscape</h3>
            <p className="text-xs text-slate-300">Run our automated {article.engine} preflight scan with cryptographic evidence.</p>
          </div>
          <Link
            href={article.toolCtaLink}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-lg shadow-emerald-500/20 whitespace-nowrap transition-colors"
          >
            {article.toolCta}
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
