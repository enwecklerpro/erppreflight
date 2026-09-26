import { notFound, permanentRedirect } from 'next/navigation';
import { objectKeyToSlug } from '@erppreflight/schemas';
import { getRequestLocale } from '../../../../../i18n/server';
import { localizePath } from '../../../../../lib/routing';

type Params = Promise<{ type: string; key: string }>;

/**
 * Former public object page. Public object pages are now the programmatic SEO
 * pages /{locale}/sap/clean-core/{object} (one canonical URL per object key).
 */
export default async function LegacyObjectRedirect({ params }: { params: Params }) {
  const { key } = await params;
  const slug = objectKeyToSlug(decodeURIComponent(key).toUpperCase());
  if (!slug) notFound();
  const locale = await getRequestLocale();
  permanentRedirect(localizePath(locale, `/sap/clean-core/${slug}`));
}
