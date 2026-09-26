import { notFound } from 'next/navigation';
import { LOCALES, isLocale } from '../../i18n/config';

/**
 * Localized public website. English is served at the root (middleware rewrites
 * `/pricing` → `/en/pricing`), German under `/de`. Only the known locales exist.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div lang={locale} className="public-site">
      {children}
    </div>
  );
}
