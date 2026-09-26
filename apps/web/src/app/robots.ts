import { MetadataRoute } from 'next';
import { PRIVATE_ROUTE_PREFIXES, getAppBaseUrl } from '../lib/seo';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getAppBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        // Everything public (both locales, knowledge articles) is crawlable;
        // private application routes are not.
        allow: ['/'],
        // Both the bare path and its subtree are disallowed.
        disallow: PRIVATE_ROUTE_PREFIXES.flatMap((p) => [p, `${p}/`]),
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
