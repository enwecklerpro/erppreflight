import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight,
  FileSearch,
  Cpu,
  ClipboardCheck,
  FolderKanban,
  GitBranch,
  ShieldCheck,
  Plug,
  CheckCircle2,
  AlertTriangle,
  Upload,
  Cable,
  BookOpen,
  FileText,
  Sparkles,
} from 'lucide-react';
import { fetchKnowledgeListSafe } from '../../lib/knowledge';
import { getMessages, getT } from '../../i18n/translate';
import { localizePath } from '../../lib/routing';
import { SOLUTION_SLUGS, TOTAL_ENGINE_COUNT, enginesForSolution } from '../../lib/solutions';
import { getAppBaseUrl, localizedUrl, publicPageMetadata } from '../../lib/seo';
import { getPublicPlans } from '../../lib/plans';
import { JsonLd } from '../../components/public/json-ld';
import { resolveLocale, type LocaleParams } from './locale-params';

export async function generateMetadata({ params }: { params: LocaleParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: '/',
    title: t('home.metaTitle'),
    description: t('home.metaDescription'),
  });
}

const STEP_ICONS = [FileSearch, Cpu, ClipboardCheck];

export default async function HomePage({ params }: { params: LocaleParams }) {
  const locale = await resolveLocale(params);
  const t = getT(locale);
  const m = getMessages(locale);
  const lp = (p: string) => localizePath(locale, p);
  const plans = getPublicPlans();
  const prices = plans.map((p) => p.priceEurMonthly).filter((p): p is number => p !== null);
  // Optional teaser: the homepage renders fully even if the knowledge API is down.
  const articles = await fetchKnowledgeListSafe(locale);

  const structuredData = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'ERP Preflight',
      url: getAppBaseUrl(),
      logo: `${getAppBaseUrl()}/icon`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'ERP Preflight',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      url: localizedUrl(locale, '/'),
      inLanguage: locale,
      description: t('common.subheadline'),
      ...(prices.length
        ? {
            offers: {
              '@type': 'AggregateOffer',
              priceCurrency: 'EUR',
              lowPrice: Math.min(...prices),
              highPrice: Math.max(...prices),
              offerCount: prices.length,
            },
          }
        : {}),
    },
  ];

  return (
    <div className="space-y-20">
      <JsonLd data={structuredData} />

      {/* Hero */}
      <section className="pt-6 sm:pt-12 text-center max-w-3xl mx-auto" aria-labelledby="hero-title">
        <p className="text-xs uppercase font-bold tracking-wider text-primary">{t('home.eyebrow')}</p>
        <h1 id="hero-title" className="mt-3 text-4xl sm:text-5xl font-extrabold tracking-tight text-foreground">
          {t('common.brand')}
        </h1>
        <p className="mt-4 text-2xl sm:text-3xl font-bold text-foreground">{t('common.tagline')}</p>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">{t('common.subheadline')}</p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/signup"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-blue-600 transition-colors shadow-sm"
          >
            {t('common.startFree')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href="/demo"
            className="inline-flex items-center justify-center gap-2 px-5 py-3 border border-border text-foreground text-sm font-semibold rounded-lg hover:bg-muted transition-colors"
          >
            {t('common.exploreFreeTools')}
          </Link>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">
          {t('common.engineCount', { count: TOTAL_ENGINE_COUNT })} ·{' '}
          <Link href="/login" className="underline hover:text-foreground">
            {t('nav.login')}
          </Link>
        </p>
      </section>

      {/* 1. Problem */}
      <section aria-labelledby="problem-title" className="grid gap-8 lg:grid-cols-2 items-start">
        <div>
          <h2 id="problem-title" className="text-2xl font-bold tracking-tight">
            {t('home.problemTitle')}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t('home.problemBody')}</p>
        </div>
        <ul className="space-y-3">
          {m.home.problems.map((problem) => (
            <li key={problem} className="flex gap-3 rounded-lg border border-border bg-card p-4 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden="true" />
              <span>{problem}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 2. How it works */}
      <section aria-labelledby="how-title">
        <h2 id="how-title" className="text-2xl font-bold tracking-tight text-center">
          {t('home.howTitle')}
        </h2>
        <ol className="mt-8 grid gap-5 md:grid-cols-3">
          {m.home.howSteps.map((step, i) => {
            const Icon = STEP_ICONS[i % STEP_ICONS.length];
            return (
              <li key={step.title} className="rounded-xl border border-border bg-card p-6">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                    {i + 1}
                  </span>
                  <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                </div>
                <h3 className="mt-4 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{step.body}</p>
              </li>
            );
          })}
        </ol>
      </section>

      {/* File-first & connectors */}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <Upload className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">{t('home.fileFirstTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('home.fileFirstBody')}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <Cable className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">{t('home.connectorsTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('home.connectorsBody')}</p>
        </div>
      </section>

      {/* 3. Solution areas */}
      <section aria-labelledby="solutions-title">
        <h2 id="solutions-title" className="text-2xl font-bold tracking-tight">
          {t('home.solutionsTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('home.solutionsIntro')}</p>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTION_SLUGS.map((slug) => {
            const item = m.solutions.items[slug];
            const engines = enginesForSolution(slug);
            return (
              <li key={slug}>
                <Link
                  href={lp(`/solutions/${slug}`)}
                  className="group block h-full rounded-xl border border-border bg-card p-5 hover:border-primary/60 transition-colors"
                >
                  <h3 className="font-semibold text-foreground group-hover:text-primary">{item.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{item.tagline}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {engines.map((e) => e.name).join(' · ')}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>

      {/* 4. Evidence */}
      <section aria-labelledby="evidence-title" className="rounded-2xl border border-border bg-card p-6 sm:p-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 id="evidence-title" className="text-2xl font-bold tracking-tight">
            {t('home.evidenceTitle')}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t('home.evidenceBody')}</p>
        </div>
        <ul className="space-y-2">
          {m.home.evidencePoints.map((point) => (
            <li key={point} className="flex gap-2 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 5 + 6. Project mode & release intelligence */}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-6">
          <FolderKanban className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">{t('home.projectTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('home.projectBody')}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-6">
          <GitBranch className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">{t('home.releaseTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('home.releaseBody')}</p>
          <Link href="/matrix" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {t('nav.matrix')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* 7. Security */}
      <section aria-labelledby="security-title" className="grid gap-6 lg:grid-cols-2">
        <div>
          <ShieldCheck className="h-6 w-6 text-primary" aria-hidden="true" />
          <h2 id="security-title" className="mt-3 text-2xl font-bold tracking-tight">
            {t('home.securityTitle')}
          </h2>
          <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t('home.securityBody')}</p>
          <Link href={lp('/security')} className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {t('common.learnMore')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <ul className="space-y-2">
          {m.home.securityPoints.map((point) => (
            <li key={point} className="flex gap-2 rounded-lg border border-border bg-card p-3 text-sm">
              <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
              <span>{point}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 8. Integrations */}
      <section aria-labelledby="integrations-title" className="rounded-xl border border-border bg-card p-6">
        <Plug className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 id="integrations-title" className="mt-3 text-lg font-bold">
          {t('home.integrationsTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{t('home.integrationsBody')}</p>
        <Link href="/docs" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          {t('footer.docs')}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </section>

      {/* Knowledge, docs & demo */}
      <section className="grid gap-5 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-6 lg:col-span-2">
          <BookOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          <h2 className="mt-3 text-lg font-bold">{t('home.knowledgeTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('home.knowledgeBody')}</p>
          {articles && articles.length > 0 && (
            <ul className="mt-4 space-y-2 text-sm">
              {articles.slice(0, 4).map((a) => (
                <li key={a.slug}>
                  <Link href={lp(`/knowledge/${a.slug}`)} className="text-foreground hover:text-primary underline-offset-2 hover:underline">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <Link href={lp('/knowledge')} className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
            {t('home.knowledgeCta')}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
        <div className="grid gap-5">
          <div className="rounded-xl border border-border bg-card p-6">
            <FileText className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold">{t('home.docsTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('home.docsBody')}</p>
            <Link href="/docs" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              {t('footer.docs')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
          <div className="rounded-xl border border-border bg-card p-6">
            <Sparkles className="h-5 w-5 text-primary" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-bold">{t('home.demoTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t('home.demoBody')}</p>
            <Link href="/demo" className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
              {t('common.exploreFreeTools')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>

      {/* 9. Pricing */}
      <section aria-labelledby="pricing-title" className="text-center">
        <h2 id="pricing-title" className="text-2xl font-bold tracking-tight">
          {t('home.pricingTitle')}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">{t('home.pricingBody')}</p>
        <Link
          href={lp('/pricing')}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 border border-border rounded-lg text-sm font-semibold hover:bg-muted"
        >
          {t('home.pricingCta')}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </section>

      {/* 10. FAQ */}
      <section aria-labelledby="faq-title" className="max-w-3xl mx-auto w-full">
        <h2 id="faq-title" className="text-2xl font-bold tracking-tight text-center">
          {t('home.faqTitle')}
        </h2>
        <div className="mt-6 divide-y divide-border rounded-xl border border-border bg-card">
          {m.home.faq.map((item) => (
            <details key={item.q} className="group p-5">
              <summary className="cursor-pointer list-none font-semibold text-sm flex justify-between gap-4">
                <span>{item.q}</span>
                <span aria-hidden="true" className="text-muted-foreground group-open:rotate-45 transition-transform motion-reduce:transition-none">
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* 11. Final CTA */}
      <section className="rounded-2xl bg-gradient-to-r from-blue-900 to-indigo-950 text-white p-8 sm:p-10 text-center">
        <h2 className="text-2xl sm:text-3xl font-extrabold">{t('home.finalTitle')}</h2>
        <p className="mt-3 text-sm text-blue-100">{t('home.finalBody')}</p>
        <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/signup" className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white text-blue-950 text-sm font-semibold rounded-lg hover:bg-blue-50">
            {t('common.runPreflight')}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link href="/login" className="inline-flex items-center justify-center px-5 py-3 border border-white/30 text-white text-sm font-semibold rounded-lg hover:bg-white/10">
            {t('nav.login')}
          </Link>
        </div>
      </section>
    </div>
  );
}
