import { SITEMAP_FILE_PATTERN, buildUrlset, knowledgeUrls, pageUrls, sapObjectUrls, xmlResponse } from '../../../lib/sitemap';

export const dynamic = 'force-dynamic';

/** Child sitemaps: pages.xml, knowledge.xml, sap-objects-N.xml (only indexable URLs). */
export async function GET(_req: Request, { params }: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await params;
  const match = SITEMAP_FILE_PATTERN.exec(file);
  if (!match) return new Response('Not found', { status: 404 });
  if (match[1] === 'pages') return xmlResponse(buildUrlset(await pageUrls()));
  if (match[1] === 'knowledge') return xmlResponse(buildUrlset(await knowledgeUrls()));
  try {
    const urls = await sapObjectUrls(Number(match[2]));
    if (!urls) return new Response('Not found', { status: 404 });
    return xmlResponse(buildUrlset(urls));
  } catch {
    // Knowledge API unavailable: tell crawlers to come back instead of serving an empty sitemap.
    return new Response('Service unavailable', { status: 503, headers: { 'retry-after': '600' } });
  }
}
