'use client';

import React from 'react';
import { CheckCircle2, Mail } from 'lucide-react';
import { useMessages, useT } from '@/i18n/client';

export default function ProcurementPage() {
  const t = useT();
  const m = useMessages().app.procurement;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="border-b border-border pb-6 space-y-2">
        <span className="inline-block text-xs uppercase font-bold tracking-wider text-primary px-2 py-0.5 bg-primary/10 rounded">
          {t('app.procurement.badge')}
        </span>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">{t('app.procurement.title')}</h1>
        <p className="text-sm text-muted-foreground max-w-3xl">{t('app.procurement.intro')}</p>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {m.highlights.map((h) => (
          <div key={h.label} className="p-4 rounded-xl border border-border bg-card space-y-1">
            <dt className="text-xs font-bold uppercase text-muted-foreground">{h.label}</dt>
            <dd className="text-base font-bold text-foreground">{h.value}</dd>
            <dd className="text-sm text-muted-foreground">{h.note}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {m.docs.map((doc) => (
          <article key={doc.title} className="rounded-xl border border-border bg-card p-4 sm:p-6 flex flex-col justify-between shadow-sm space-y-4">
            <div className="space-y-3">
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-primary">{doc.category}</span>
                <h2 className="text-base font-bold text-foreground mt-0.5">{doc.title}</h2>
              </div>
              <p className="text-sm text-muted-foreground leading-relaxed">{doc.summary}</p>
              <div className="p-3 bg-muted/40 rounded-lg border border-border/60 space-y-1.5">
                <h3 className="font-semibold text-foreground text-xs uppercase tracking-wider">{t('app.procurement.keyPoints')}</h3>
                <ul className="space-y-1 text-muted-foreground text-sm">
                  {doc.details.map((item) => (
                    <li key={item} className="flex items-start gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="pt-4 border-t border-border flex justify-end">
              <a
                href={`mailto:contact@erppreflight.com?subject=${encodeURIComponent(t('app.procurement.requestSubject', { title: doc.title }))}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-blue-600 transition-colors shadow-sm"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden="true" />
                {t('app.procurement.request')}
              </a>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
