import { permanentRedirect } from 'next/navigation';
import { getRequestLocale } from '../../../i18n/server';
import { localizePath } from '../../../lib/routing';

/**
 * The public Clean Core Object Lookup moved to the localized free-tools hub
 * (/{locale}/tools/clean-core-lookup). Old links keep working via a permanent redirect
 * that preserves the query (?q=).
 */
export default async function LegacyLookupRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getRequestLocale();
  const sp = await searchParams;
  const q = typeof sp.q === 'string' ? sp.q.slice(0, 120) : '';
  permanentRedirect(`${localizePath(locale, '/tools/clean-core-lookup')}${q ? `?q=${encodeURIComponent(q)}` : ''}`);
}
