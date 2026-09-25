import { MetadataRoute } from 'next';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://erppreflight.com';

  return {
    rules: [
      {
        userAgent: '*',
        allow: [
          '/',
          '/knowledge',
          '/changelog',
          '/templates',
          '/trust-center',
          '/lab',
          '/docs',
        ],
        disallow: [
          '/api/',
          '/admin/',
          '/dashboard/',
          '/projects/',
          '/findings/',
          '/agent-gate/',
          '/settings/',
          '/auth/',
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
