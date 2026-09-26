import { getAppBaseUrl } from '../../lib/seo';
import { buildSitemapIndex, sapObjectSitemapCount, xmlResponse } from '../../lib/sitemap';

// Rendered on request: the SAP object sitemaps grow with the knowledge graph.
export const dynamic = 'force-dynamic';

/** Sitemap index split by content type (Part 02 §2.9). */
export async function GET(): Promise<Response> {
  const base = getAppBaseUrl();
  const sapPages = await sapObjectSitemapCount();
  const children = [
    { loc: `${base}/sitemaps/pages.xml` },
    { loc: `${base}/sitemaps/knowledge.xml` },
    ...Array.from({ length: sapPages }, (_, i) => ({ loc: `${base}/sitemaps/sap-objects-${i + 1}.xml` })),
  ];
  return xmlResponse(buildSitemapIndex(children), 900);
}
