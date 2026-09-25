import { MetadataRoute } from 'next';
import { PRIVATE_ROUTE_PREFIXES, PUBLIC_INDEXABLE_ROUTES, getAppBaseUrl } from '../lib/seo';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getAppBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: [...PUBLIC_INDEXABLE_ROUTES],
        // Both the bare path and its subtree are disallowed.
        disallow: PRIVATE_ROUTE_PREFIXES.flatMap((p) => [p, `${p}/`]),
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
