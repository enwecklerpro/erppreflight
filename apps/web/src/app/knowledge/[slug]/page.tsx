import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ArrowRight } from 'lucide-react';

/**
 * Knowledge article route.
 *
 * The API currently exposes only aggregate knowledge endpoints
 * (GET /knowledge/matrix, /knowledge/snapshots, /knowledge/stability) and no
 * per-article endpoint. Until one exists this route renders an explicit
 * "not available" state instead of calling a non-existent URL or inventing
 * article content.
 */
export const metadata: Metadata = {
  title: 'Knowledge article not available — ERP Preflight',
  robots: { index: false, follow: false },
};

export default async function KnowledgeArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  return (
    <div className="max-w-2xl mx-auto py-16 text-center space-y-4">
      <div className="inline-flex p-3 rounded-full bg-muted text-muted-foreground">
        <BookOpen className="size-7" aria-hidden="true" />
      </div>
      <h1 className="text-2xl font-bold text-foreground">Knowledge article not available</h1>
      <p className="text-sm text-muted-foreground">
        There is no published knowledge article for{' '}
        <code className="font-mono text-foreground break-all">{slug}</code>. Per-article resolution guides
        are not yet served by the platform.
      </p>
      <p className="text-sm text-muted-foreground">
        Release support per engine is available in the Release Compatibility Matrix.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
        <Link
          href="/matrix"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold"
        >
          Open Release Matrix
          <ArrowRight className="size-4" aria-hidden="true" />
        </Link>
        <Link
          href="/"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border text-sm font-semibold text-foreground"
        >
          Return Home
        </Link>
      </div>
    </div>
  );
}
