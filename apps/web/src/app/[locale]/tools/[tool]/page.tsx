import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { Locale } from '../../../../i18n/config';
import { getT, type MessageKey } from '../../../../i18n/translate';
import { publicPageMetadata } from '../../../../lib/seo';
import { isToolSlug, type ToolSlug } from '../../../../lib/tools';
import { fetchServerToolsMeta, type ToolsMeta } from '../../../../lib/public-tools';
import { FIORI_TREE_REVIEWED } from '../../../../lib/fiori-403-tree';
import { ProvenancePanel, ToolPage, type ProvenanceKind } from '../../../../components/tools/tool-shell';
import { CleanCoreLookupTool } from '../../../../components/tools/clean-core-lookup-tool';
import { SuccessorTool } from '../../../../components/tools/successor-tool';
import { ApiDeprecationTool } from '../../../../components/tools/api-deprecation-tool';
import { XmlFieldCheckerTool } from '../../../../components/tools/xml-field-checker-tool';
import { Fiori403Tool } from '../../../../components/tools/fiori-403-tool';
import { SearchTool } from '../../../../components/tools/search-tool';
import { resolveLocale } from '../../locale-params';

type Params = Promise<{ locale: string; tool: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const META_KEYS: Record<ToolSlug, { title: MessageKey; description: MessageKey }> = {
  'clean-core-lookup': { title: 'publicTools.cleanCore.metaTitle', description: 'publicTools.cleanCore.metaDescription' },
  'cloud-successor': { title: 'publicTools.successor.metaTitle', description: 'publicTools.successor.metaDescription' },
  'api-deprecations': { title: 'publicTools.api.metaTitle', description: 'publicTools.api.metaDescription' },
  'xml-field-checker': { title: 'publicTools.xml.metaTitle', description: 'publicTools.xml.metaDescription' },
  'fiori-403': { title: 'publicTools.fiori.metaTitle', description: 'publicTools.fiori.metaDescription' },
  search: { title: 'publicTools.search.metaTitle', description: 'publicTools.search.metaDescription' },
};

const PROVENANCE: Record<ToolSlug, ProvenanceKind> = {
  'clean-core-lookup': 'knowledge-graph',
  'cloud-successor': 'knowledge-graph',
  'api-deprecations': 'knowledge-graph',
  'xml-field-checker': 'document',
  'fiori-403': 'decision-tree',
  search: 'search',
};

const TOOLS: Record<ToolSlug, React.ComponentType> = {
  'clean-core-lookup': CleanCoreLookupTool,
  'cloud-successor': SuccessorTool,
  'api-deprecations': ApiDeprecationTool,
  'xml-field-checker': XmlFieldCheckerTool,
  'fiori-403': Fiori403Tool,
  search: SearchTool,
};

/**
 * Result states (?q=, ?path=, ?from=…) are low-information, user-specific views:
 * they are served noindex with the canonical pointing to the tool itself
 * (Part 02 §2.9 — only the tool page is indexable).
 */
function hasResultState(sp: Record<string, string | string[] | undefined>): boolean {
  return Object.values(sp).some((v) => (Array.isArray(v) ? v.length > 0 : Boolean(v)));
}

export async function generateMetadata({ params, searchParams }: { params: Params; searchParams: SearchParams }): Promise<Metadata> {
  const locale = await resolveLocale(params);
  const { tool } = await params;
  if (!isToolSlug(tool)) return { robots: { index: false, follow: false } };
  const t = getT(locale);
  return publicPageMetadata({
    locale,
    path: `/tools/${tool}`,
    title: t(META_KEYS[tool].title),
    description: t(META_KEYS[tool].description),
    noindex: hasResultState(await searchParams),
  });
}

async function loadMeta(kind: ProvenanceKind): Promise<ToolsMeta | null> {
  if (kind !== 'knowledge-graph' && kind !== 'search') return null;
  try {
    return await fetchServerToolsMeta();
  } catch {
    return null;
  }
}

function ToolFallback() {
  return <div className="h-40 animate-pulse rounded-xl border border-border bg-muted/40 motion-reduce:animate-none" aria-busy="true" />;
}

export default async function ToolRoutePage({ params }: { params: Params }) {
  const locale: Locale = await resolveLocale(params);
  const { tool } = await params;
  if (!isToolSlug(tool)) notFound();
  const kind = PROVENANCE[tool];
  const meta = await loadMeta(kind);
  const Tool = TOOLS[tool];
  return (
    <ToolPage
      locale={locale}
      slug={tool}
      provenance={<ProvenancePanel locale={locale} kind={kind} meta={meta} reviewedAt={tool === 'fiori-403' ? FIORI_TREE_REVIEWED : undefined} />}
    >
      <Suspense fallback={<ToolFallback />}>
        <Tool />
      </Suspense>
    </ToolPage>
  );
}
