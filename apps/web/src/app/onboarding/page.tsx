'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Compass,
  Database,
  FileSpreadsheet,
  Flame,
  Layers,
  ShieldCheck,
  Sparkles,
  Truck,
} from 'lucide-react';
import { createProject, exploreDemoProject } from '@/lib/api-client';
import { useErrorText, useLabel, useT } from '@/i18n/client';

const ROLES = ['CONSULTANT', 'DEVELOPER', 'ARCHITECT', 'BASIS', 'SECURITY', 'EWM'] as const;
type Role = (typeof ROLES)[number];

const DOMAINS = [
  { id: 'OUTPUT', icon: FileSpreadsheet },
  { id: 'CLEAN_CORE', icon: ShieldCheck },
  { id: 'MIGRATION', icon: Database },
  { id: 'INTEGRATION', icon: Layers },
  { id: 'RELEASE', icon: Truck },
  { id: 'MFS', icon: Flame },
] as const;
type Domain = (typeof DOMAINS)[number]['id'];

// Must stay aligned with TargetReleaseEnum in @erppreflight/schemas.
const RELEASES = ['S4H_2023', 'S4H_2022', 'S4HC_2408', 'S4HC_2402'] as const;
type Release = (typeof RELEASES)[number];

const STEP_KEYS = ['role', 'domain', 'scope'] as const;

const cardClass = (selected: boolean) =>
  `relative text-left p-4 rounded-xl border transition-colors cursor-pointer focus-within:ring-2 focus-within:ring-emerald-400 ${
    selected
      ? 'bg-emerald-500/10 border-emerald-500 ring-1 ring-emerald-500 text-white'
      : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-600'
  }`;

const primaryButton =
  'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';
const secondaryButton =
  'px-4 py-2.5 rounded-lg text-slate-300 hover:text-white text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400';

export default function OnboardingPage() {
  const t = useT();
  const label = useLabel();
  const errText = useErrorText();
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedRole, setSelectedRole] = useState<Role>(ROLES[0]);
  const [selectedDomain, setSelectedDomain] = useState<Domain>(DOMAINS[0].id);
  const [selectedRelease, setSelectedRelease] = useState<Release>(RELEASES[0]);
  const [projectName, setProjectName] = useState(() => t('app.onboarding.projectNameDefault'));

  const createProjectMutation = useMutation({
    mutationFn: createProject,
    onSuccess: (created) => router.push(`/projects/${created.id}`),
  });
  const exploreDemoMutation = useMutation({
    mutationFn: exploreDemoProject,
    onSuccess: (demo) => router.push(`/projects/${demo.project.id}`),
  });

  const loading = createProjectMutation.isPending || exploreDemoMutation.isPending;

  function handleComplete() {
    exploreDemoMutation.reset();
    createProjectMutation.mutate({
      name: projectName.trim(),
      description: t('app.onboarding.projectDescription', {
        role: t(`app.onboarding.roles.${selectedRole}.label`),
        domain: t(`app.onboarding.domains.${selectedDomain}`),
      }),
      targetRelease: selectedRelease,
    });
  }

  function handleExploreDemo() {
    createProjectMutation.reset();
    exploreDemoMutation.mutate();
  }

  const failedMutation = createProjectMutation.isError
    ? { title: t('app.onboarding.createFailed'), error: createProjectMutation.error, retry: handleComplete }
    : exploreDemoMutation.isError
    ? { title: t('app.onboarding.demoFailed'), error: exploreDemoMutation.error, retry: handleExploreDemo }
    : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto w-full">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            <Compass className="w-3.5 h-3.5" aria-hidden="true" />
            {t('app.onboarding.badge')}
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">{t('app.onboarding.title')}</h1>
          <p className="mt-3 text-slate-400 text-base">{t('app.onboarding.intro')}</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-8 shadow-xl">
          <ol aria-label={t('app.onboarding.progressLabel')} className="flex items-center gap-2 sm:gap-4 mb-8 pb-4 border-b border-slate-800">
            {STEP_KEYS.map((key, idx) => {
              const n = idx + 1;
              const active = step >= n;
              return (
                <li
                  key={key}
                  aria-current={step === n ? 'step' : undefined}
                  className={`flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold ${active ? 'text-emerald-400' : 'text-slate-400'}`}
                >
                  <span
                    aria-hidden="true"
                    className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-xs ${
                      active ? 'bg-emerald-500/20 border border-emerald-500' : 'bg-slate-800'
                    }`}
                  >
                    {n}
                  </span>
                  <span className="sr-only">{t('app.onboarding.stepOf', { step: n, total: STEP_KEYS.length })}: </span>
                  <span className={step === n ? 'truncate' : 'hidden truncate sm:inline'}>{t(`app.onboarding.steps.${key}`)}</span>
                </li>
              );
            })}
          </ol>

          {step === 1 && (
            <fieldset>
              <legend className="text-xl font-bold text-white mb-2">{t('app.onboarding.roleTitle')}</legend>
              <p className="text-slate-400 text-sm mb-6">{t('app.onboarding.roleIntro')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {ROLES.map((r) => (
                  <label key={r} className={cardClass(selectedRole === r)}>
                    <input
                      type="radio"
                      name="role"
                      value={r}
                      checked={selectedRole === r}
                      onChange={() => setSelectedRole(r)}
                      className="sr-only"
                    />
                    <span className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-semibold text-sm">{t(`app.onboarding.roles.${r}.label`)}</span>
                      {selectedRole === r && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden="true" />}
                    </span>
                    <span className="block text-sm text-slate-400">{t(`app.onboarding.roles.${r}.desc`)}</span>
                  </label>
                ))}
              </div>
              <div className="flex justify-end">
                <button type="button" onClick={() => setStep(2)} className={primaryButton}>
                  {t('app.onboarding.continue')}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset>
              <legend className="text-xl font-bold text-white mb-2">{t('app.onboarding.domainTitle')}</legend>
              <p className="text-slate-400 text-sm mb-6">{t('app.onboarding.domainIntro')}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
                {DOMAINS.map((d) => {
                  const Icon = d.icon;
                  return (
                    <label key={d.id} className={`${cardClass(selectedDomain === d.id)} flex items-start gap-3`}>
                      <input
                        type="radio"
                        name="domain"
                        value={d.id}
                        checked={selectedDomain === d.id}
                        onChange={() => setSelectedDomain(d.id)}
                        className="sr-only"
                      />
                      <Icon className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
                      <span className="flex-1 font-semibold text-sm">{t(`app.onboarding.domains.${d.id}`)}</span>
                      {selectedDomain === d.id && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-hidden="true" />}
                    </label>
                  );
                })}
              </div>
              <div className="flex justify-between gap-3">
                <button type="button" onClick={() => setStep(1)} className={secondaryButton}>
                  {t('app.onboarding.back')}
                </button>
                <button type="button" onClick={() => setStep(3)} className={primaryButton}>
                  {t('app.onboarding.continue')}
                  <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </fieldset>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-xl font-bold text-white mb-2">{t('app.onboarding.scopeTitle')}</h2>
              <p className="text-slate-400 text-sm mb-6">{t('app.onboarding.scopeIntro')}</p>

              <div className="space-y-4 mb-8">
                <div>
                  <label htmlFor="onboarding-project-name" className="block text-sm font-semibold text-slate-300 mb-2">
                    {t('app.onboarding.projectName')}
                  </label>
                  <input
                    id="onboarding-project-name"
                    type="text"
                    required
                    maxLength={200}
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full px-4 py-2.5 bg-slate-950 border border-slate-700 rounded-lg text-white text-sm focus:outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/40"
                  />
                </div>

                <fieldset>
                  <legend className="block text-sm font-semibold text-slate-300 mb-2">{t('app.onboarding.release')}</legend>
                  <div className="space-y-2">
                    {RELEASES.map((rel) => (
                      <label
                        key={rel}
                        className={`flex items-center justify-between gap-3 p-3.5 rounded-xl border cursor-pointer transition-colors focus-within:ring-2 focus-within:ring-emerald-400 ${
                          selectedRelease === rel
                            ? 'bg-emerald-500/10 border-emerald-500 text-white'
                            : 'bg-slate-950/60 border-slate-800 text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <span className="text-sm font-medium">{label('app.projects.releases', rel)}</span>
                        <input
                          type="radio"
                          name="targetRelease"
                          value={rel}
                          checked={selectedRelease === rel}
                          onChange={() => setSelectedRelease(rel)}
                          className="accent-emerald-500"
                        />
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>

              {failedMutation && (
                <div role="alert" className="mb-6 p-4 rounded-xl border border-rose-500/30 bg-rose-500/10 text-sm text-rose-200 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                  <div className="flex-1">
                    <p className="font-semibold">{failedMutation.title}</p>
                    <p className="mt-0.5">{errText(failedMutation.error, t('app.onboarding.unexpected'))}</p>
                    <button type="button" onClick={failedMutation.retry} disabled={loading} className="mt-2 font-semibold underline">
                      {t('app.onboarding.retry')}
                    </button>
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={handleExploreDemo}
                  disabled={loading}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 font-semibold text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                >
                  <Sparkles className="w-4 h-4 text-amber-400" aria-hidden="true" />
                  {t('app.onboarding.explore')}
                </button>
                <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
                  <button type="button" onClick={() => setStep(2)} className={secondaryButton}>
                    {t('app.onboarding.back')}
                  </button>
                  <button type="button" onClick={handleComplete} disabled={loading || !projectName.trim()} className={primaryButton}>
                    {loading ? t('app.onboarding.launching') : t('app.onboarding.launch')}
                    <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
