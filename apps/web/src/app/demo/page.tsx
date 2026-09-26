'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, ArrowRight, Lock, AlertCircle } from 'lucide-react';
import { exploreDemoProject } from '@/lib/api-client';
import { ApiError } from '@/lib/api/custom-instance';
import { useErrorText, useT } from '@/i18n/client';

export default function DemoSandboxPage() {
  const t = useT();
  const errText = useErrorText();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [launchError, setLaunchError] = useState<{ message: string; needsLogin: boolean } | null>(null);

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
        message: needsLogin ? t('app.demo.needsLogin') : errText(err, t('app.demo.failed')),
      });
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-amber-500/20">
            <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
            {t('app.demo.badge')}
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-4">{t('app.demo.title')}</h1>
          <p className="max-w-2xl mx-auto text-slate-400 text-base sm:text-lg">{t('app.demo.intro')}</p>
          <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-4">
            <button
              type="button"
              onClick={handleLaunch}
              disabled={loading}
              aria-busy={loading}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-base shadow-xl shadow-emerald-500/20 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950"
            >
              {loading ? t('app.demo.launching') : t('app.demo.launch')}
              <ArrowRight className="w-5 h-5" aria-hidden="true" />
            </button>
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <Lock className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              {t('app.demo.syntheticOnly')}
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
                  {t('app.demo.signIn')}
                </Link>
              ) : (
                <button type="button" onClick={handleLaunch} className="mt-2 font-semibold underline">
                  {t('app.demo.retry')}
                </button>
              )}
            </div>
          </div>
        )}

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 text-center text-sm text-slate-400">
          <p>{t('app.demo.note')}</p>
        </div>
      </div>
    </div>
  );
}
