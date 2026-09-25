import { MetadataRoute } from 'next';
import { PUBLIC_INDEXABLE_ROUTES, getAppBaseUrl } from '../lib/seo';

/**
 * Lists only public routes that exist under src/app. Authenticated
 * application routes are excluded (see robots.ts).
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getAppBaseUrl();
  return PUBLIC_INDEXABLE_ROUTES.map((route) => ({
    url: route === '/' ? baseUrl : `${baseUrl}${route}`,
    changeFrequency: route === '/changelog' ? ('weekly' as const) : ('monthly' as const),
    priority: route === '/' ? 1.0 : 0.7,
  }));
}
