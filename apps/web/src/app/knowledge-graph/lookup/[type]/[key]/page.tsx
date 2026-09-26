import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { ObjectDetailView } from '@/components/knowledge-graph/object-detail';
import { fetchPublicObject } from '@/lib/knowledge-graph';

type Params = { type: string; key: string };

const VALID = /^[A-Za-z0-9_]{2,20}$/;
const VALID_KEY = /^[A-Za-z0-9_/$]{1,200}$/;

async function load(params: Params) {
  const type = decodeURIComponent(params.type);
  const key = decodeURIComponent(params.key);
  if (!VALID.test(type) || !VALID_KEY.test(key)) return null;
  return fetchPublicObject(type, key);
}

/**
 * Public object page. Only global reviewed knowledge; pages without enough
 * verified information are served `noindex` (Part 02 §2.9) — the API decides
 * via detail.seo.indexable.
 */
export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const p = await params;
  const detail = await load(p).catch(() => null);
  if (!detail) return { title: 'Object not found — ERP Preflight', robots: { index: false, follow: false } };
  const o = detail.object;
  const privateLatest = detail.states.find((s) => s.editionCode === 'CLOUD_PRIVATE' && s.isRolling && s.scheme === 'RELEASE_CONTRACT');
  const succ = privateLatest?.successors.map((s) => s.objectKey).slice(0, 3).join(', ');
  const status = privateLatest ? privateLatest.supportState.replace(/_/g, ' ').toLowerCase() : 'release state';
  return {
    title: `${o.objectKey} (${o.sapObjectType}) — ${status}${succ ? `, use ${succ}` : ''} | Clean Core Object Lookup`,
    description: `${o.objectKey} release state per SAP Cloud ERP / Private edition release${succ ? ` and official successor ${succ}` : ''}, from the SAP Cloudification Repository.`,
    alternates: { canonical: `/knowledge-graph/lookup/${encodeURIComponent(o.sapObjectType)}/${encodeURIComponent(o.objectKey)}` },
    robots: detail.seo.indexable ? { index: true, follow: true } : { index: false, follow: true },
  };
}

export default async function PublicObjectPage({ params }: { params: Promise<Params> }) {
  const p = await params;
  let detail;
  try {
    detail = await load(p);
  } catch {
    return (
      <div role="alert" className="mx-auto max-w-2xl rounded-xl border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">
        The knowledge service is temporarily unavailable. Please try again in a moment.
      </div>
    );
  }
  if (!detail) notFound();
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link href="/knowledge-graph/lookup" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" aria-hidden="true" /> Clean Core Object Lookup
      </Link>
      <ObjectDetailView detail={detail} mode="public" />
      <aside className="rounded-xl border border-border bg-card p-4 text-sm">
        <p className="font-semibold">Where is {detail.object.objectKey} used in your system?</p>
        <p className="mt-1 text-muted-foreground">
          Upload ABAP sources or an abapGit repository and ERP Preflight lists every usage with line-level evidence and
          the successor to migrate to.
        </p>
        <Link href="/signup" className="mt-2 inline-flex items-center gap-1 text-primary hover:underline">
          Run a full project analysis <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </aside>
    </div>
  );
}
