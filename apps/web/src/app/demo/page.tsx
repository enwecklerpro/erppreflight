'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight, Lock, AlertCircle } from 'lucide-react';
import { exploreDemoProject } from '@/lib/api-client';
import { ApiError } from '@/lib/api/custom-instance';

export default function DemoSandboxPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [launchError, setLaunchError] = useState<{ message: string; needsLogin: boolean } | null>(
    null
  );

  // The only demo endpoint is POST /demo/explore, which provisions (or reuses)
  // a synthetic demo project in the signed-in user's organization.
  async function handleLaunch() {
    setLoading(true);
    setLaunchError(null);
    try {
      const res = await exploreDemoProject();
      router.push(`/projects/${res.project.id}`);
    } catch (err) {
      const needsLogin = err instanceof ApiError && err.statusCode === 401;
      setLaunchError({
        needsLogin,
        message: needsLogin
          ? 'Sign in to provision the demo sandbox in your organization.'
          : (err as Error)?.message || 'The demo sandbox could not be provisioned.',
      });
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header Banner */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5" />
            Interactive Synthetic Sandbox
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">
            Explore Preflight Without Uploading Data
          </h1>
          <p className="max-w-2xl mx-auto text-slate-400 text-base sm:text-lg">
            Experience our 19 deterministic engines, cryptographic evidence chains, and What-If simulation using pre-seeded synthetic enterprise failure cases.
          </p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              onClick={handleLaunch}
              disabled={loading}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base shadow-xl shadow-emerald-500/20 transition-all hover:scale-105 disabled:opacity-50"
            >
              {loading ? 'Bootstrapping Sandbox...' : 'Launch Interactive Demo Sandbox'}
              <ArrowRight className="w-5 h-5" />
            </button>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Lock className="w-3.5 h-3.5 text-emerald-400" />
              Synthetic data only • Requires a signed-in account
            </div>
          </div>
        </div>

        {launchError && (
          <div
            role="alert"
            className="mb-12 max-w-xl mx-auto p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200 flex items-start gap-3"
          >
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <p>{launchError.message}</p>
              {launchError.needsLogin ? (
                <Link href="/login" className="mt-2 inline-block font-semibold underline">
                  Sign in
                </Link>
              ) : (
                <button type="button" onClick={handleLaunch} className="mt-2 font-semibold underline">
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        {/* Footer Note */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-xs text-slate-400">
          <p>
            Per Master Specification Part 14.2, no demo data represents actual customer confidential SAP records. All findings, SHA-256 evidence digests, and BRFplus XML decision tables are deterministically generated synthetic artifacts.
          </p>
        </div>
      </div>
    </div>
  );
}
