import type { Metadata } from 'next';
import Link from 'next/link';
import { ShieldCheck, ArrowRight } from 'lucide-react';
import { getMessages, getT } from '../../../i18n/translate';
import { localizePath } from '../../../lib/routing';
import { localizedUrl, publicPageMetadata } from '../../../lib/seo';
import { JsonLd, breadcrumbJsonLd } from '../../../components/public/json-ld';
import { resolveLocale, type LocaleParams } from '../locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: '/security',
    title: t('security.metaTitle'),
    description: t('security.metaDescription'),
  });
}

export default async function SecurityPage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  const m = getMessages(locale);

  return (
    <div className="space-y-10 max-w-5xl mx-auto">
      <JsonLd
        data={breadcrumbJsonLd([
          { name: t('knowledge.breadcrumbHome'), url: localizedUrl(locale, '/') },
          { name: t('security.title'), url: localizedUrl(locale, '/security') },
        ])}
      />
      <header className="max-w-3xl">
        <ShieldCheck className="h-7 w-7 text-primary" aria-hidden="true" />
        <h1 className="mt-3 text-3xl sm:text-4xl font-extrabold tracking-tight">{t('security.title')}</h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t('security.intro')}</p>
      </header>
      <ul className="grid gap-5 md:grid-cols-2">
        {m.security.controls.map((control) => (
          <li key={control.title} className="rounded-xl border border-border bg-card p-6">
            <h2 className="font-semibold">{control.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{control.body}</p>
          </li>
        ))}
      </ul>
      <section aria-labelledby="more-title" className="rounded-xl border border-border bg-card p-6">
        <h2 id="more-title" className="font-semibold">
          {t('security.moreTitle')}
        </h2>
        <ul className="mt-3 space-y-2 text-sm">
          <li>
            <Link href="/trust" className="inline-flex items-center gap-1 text-primary hover:underline">
              {t('security.trustLink')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
          <li>
            <Link href="/status" className="inline-flex items-center gap-1 text-primary hover:underline">
              {t('security.statusLink')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </li>
          <li className="text-muted-foreground">
            {t('security.contact')}{' '}
            <Link href={localizePath(locale, '/legal/imprint')} className="underline">
              {t('footer.imprint')}
            </Link>
          </li>
        </ul>
      </section>
    </div>
  );
}
