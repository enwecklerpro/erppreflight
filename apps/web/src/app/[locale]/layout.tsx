import { routing } from '../../i18n/routing';
import { resolveLocale, type LocaleParams } from './locale-params';

/**
 * Localized public website (next-intl, `localePrefix: 'always'`):
 * `/en/...` and `/de/...`. Only the configured locales exist.
 */
export const dynamicParams = false;

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: LocaleParams;
}) {
  const locale = await resolveLocale(params);
  return (
    <div lang={locale} className="public-site">
      {children}
    </div>
  );
}
