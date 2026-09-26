import { resolveLocale, type LocaleParams } from './locale-params';

/**
 * Localized public website (next-intl, `localePrefix: 'always'`):
 * `/en/...` and `/de/...`. Unknown locales 404 in `resolveLocale`.
 *
 * Rendered per request: the nonce-based Content-Security-Policy (middleware)
 * cannot be applied to prebuilt static HTML. Data fetches stay cached
 * (knowledge API responses revalidate every 5 minutes).
 */
export const dynamic = 'force-dynamic';

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
