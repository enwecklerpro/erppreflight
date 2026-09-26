'use client';

import React from 'react';
import Link from 'next/link';
import { ShieldCheck, CheckCircle2, PackageCheck, Mail, Info } from 'lucide-react';
import { useMessages, useT } from '@/i18n/client';

export default function TrustCenterPage() {
  const t = useT();
  const m = useMessages().app.trust;
  const packageHref = `mailto:contact@erppreflight.com?subject=${encodeURIComponent(m.packageSubject)}`;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 text-xs font-semibold uppercase tracking-wider mb-4 border border-emerald-500/20">
            <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
            {t('app.trust.badge')}
          </div>
          <h1 className="text-3xl sm:text-5xl font-extrabold text-white tracking-tight">{t('app.trust.title')}</h1>
          <p className="mt-3 text-sm sm:text-base text-slate-400 max-w-2xl mx-auto">{t('app.trust.intro')}</p>
        </div>

        <section className="mb-12" aria-labelledby="trust-controls">
          <h2 id="trust-controls" className="text-xl font-bold text-white mb-4">{t('app.trust.controlsTitle')}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {m.controls.map((ctrl) => (
              <div key={ctrl.title} className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                  <h3 className="font-bold text-sm text-white">{ctrl.title}</h3>
                  {ctrl.enforced ? (
                    <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                      {t('app.trust.enforced')}
                    </span>
                  ) : (
                    <Link
                      href="/status"
                      className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded bg-slate-500/10 text-slate-300 border border-slate-500/20 hover:text-white"
                    >
                      <Info className="w-3 h-3" aria-hidden="true" />
                      {t('app.trust.seeStatus')}
                    </Link>
                  )}
                </div>
                <p className="text-sm text-slate-400 leading-relaxed">{ctrl.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mb-12" aria-labelledby="trust-subprocessors">
          <h2 id="trust-subprocessors" className="text-xl font-bold text-white mb-4">{t('app.trust.subprocessorsTitle')}</h2>
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-x-auto shadow-xl">
            <table className="w-full min-w-[520px] text-left text-sm border-collapse">
              <caption className="sr-only">{t('app.trust.subprocessorsCaption')}</caption>
              <thead className="bg-slate-950 text-slate-400 text-xs font-bold uppercase tracking-wider border-b border-slate-800">
                <tr>
                  <th scope="col" className="p-3.5">{t('app.trust.colName')}</th>
                  <th scope="col" className="p-3.5">{t('app.trust.colPurpose')}</th>
                  <th scope="col" className="p-3.5">{t('app.trust.colRegion')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {m.subprocessors.map((sp) => (
                  <tr key={sp.name}>
                    <th scope="row" className="p-3.5 font-bold text-white">{sp.name}</th>
                    <td className="p-3.5">{sp.purpose}</td>
                    <td className="p-3.5 text-cyan-400">{sp.region}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mb-12" aria-labelledby="trust-sbom">
          <h2 id="trust-sbom" className="text-xl font-bold text-white flex items-center gap-2 mb-2">
            <PackageCheck className="w-5 h-5 text-emerald-400" aria-hidden="true" />
            {t('app.trust.sbomTitle')}
          </h2>
          <ul className="bg-slate-900 border border-slate-800 rounded-xl p-5 text-sm text-slate-300 space-y-2 list-disc list-inside">
            {m.sbomItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="mb-12 bg-slate-900 border border-slate-800 rounded-xl p-6" aria-labelledby="trust-disclosure">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400">
              <Mail className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="trust-disclosure" className="font-bold text-white text-base">{t('app.trust.disclosureTitle')}</h2>
              <p className="text-sm text-slate-400">{t('app.trust.disclosureIntro')}</p>
            </div>
          </div>
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm pt-2">
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <dt className="text-slate-400 text-xs">{t('app.trust.channel')}</dt>
              <dd className="font-mono text-cyan-400 font-semibold break-all">security@erppreflight.com</dd>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <dt className="text-slate-400 text-xs">{t('app.trust.triage')}</dt>
              <dd className="text-white font-semibold">{t('app.trust.triageValue')}</dd>
            </div>
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800">
              <dt className="text-slate-400 text-xs">{t('app.trust.safeHarbor')}</dt>
              <dd className="text-emerald-400 font-semibold">{t('app.trust.safeHarborValue')}</dd>
            </div>
          </dl>
        </section>

        <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <h2 className="font-bold text-white text-sm">{t('app.trust.packageTitle')}</h2>
            <p className="text-sm text-slate-400 mt-0.5">{t('app.trust.packageBody')}</p>
          </div>
          <a
            href={packageHref}
            className="px-5 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-colors text-center"
          >
            {t('app.trust.packageCta')}
          </a>
        </div>
      </div>
    </div>
  );
}
