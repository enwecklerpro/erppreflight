/* eslint-disable no-console */
/**
 * Knowledge sync CLI (C §27, Part 14.14).
 *
 *   pnpm --filter @erppreflight/api knowledge:sync                 # all catalog files from the official repository
 *   pnpm --filter @erppreflight/api knowledge:sync -- --files objectReleaseInfoLatest.json,objectClassifications_SAP.json
 *   pnpm --filter @erppreflight/api knowledge:sync -- --local-dir /mirror/abap-atc-cr-cv-s4hc/src
 *   pnpm --filter @erppreflight/api knowledge:sync -- --rosa-file export.json [--rosa-file other.json]
 *   ... --no-watches   skip release-watch re-evaluation
 *   ... --json         print the machine-readable result
 *
 * Requires DATABASE_URL (schema owner — global knowledge is not writable by the
 * RLS runtime role). DB_RUNTIME_ROLE is honoured for the per-tenant watch writes.
 * The API's outbox dispatcher delivers the resulting notifications/webhooks.
 */
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { resolveRuntimeRole } from '../../database/database.service';
import { ReleaseWatchEvaluator } from '../../release-intelligence/release-watch.evaluator';
import { CloudificationRepositorySource } from '../sources/cloudification-repository.source';
import { RosaFileImportSource } from '../sources/rosa-file-import.source';
import { KnowledgeSyncPipeline } from '../sync/knowledge-sync.pipeline';
import type { ReleasedObjectSource } from '../knowledge-graph.types';

interface CliArgs {
  files: string[];
  localDir: string | null;
  rosaFiles: string[];
  watches: boolean;
  json: boolean;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = { files: [], localDir: null, rosaFiles: [], watches: true, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (!v) throw new Error(`Missing value for ${a}`);
      return v;
    };
    if (a === '--') continue;
    else if (a === '--files') args.files.push(...next().split(',').map((s) => s.trim()).filter(Boolean));
    else if (a === '--local-dir') args.localDir = next();
    else if (a === '--rosa-file') args.rosaFiles.push(next());
    else if (a === '--no-watches') args.watches = false;
    else if (a === '--json') args.json = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

async function main(): Promise<number> {
  const args = parseCliArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is required (schema owner connection).');
    return 2;
  }
  const logger = {
    log: (m: string) => !args.json && console.log(`[knowledge-sync] ${m}`),
    warn: (m: string) => console.warn(`[knowledge-sync] WARN ${m}`),
    error: (m: string) => console.error(`[knowledge-sync] ERROR ${m}`),
  };

  const source: ReleasedObjectSource =
    args.rosaFiles.length > 0
      ? new RosaFileImportSource(args.rosaFiles.map((f) => ({ label: f, content: readFileSync(f) })))
      : new CloudificationRepositorySource({
          files: args.files,
          localDirectory: args.localDir ?? undefined,
          baseUrl: process.env.KNOWLEDGE_CR_BASE_URL || undefined,
        });

  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  try {
    const pipeline = new KnowledgeSyncPipeline(pool, logger);
    const result = await pipeline.run(source, {
      trigger: args.rosaFiles.length > 0 ? 'FILE_IMPORT' : 'CLI',
      triggeredBy: args.localDir ? `local-dir:${args.localDir}` : process.env.USER || 'cli',
    });
    let watches: Awaited<ReturnType<ReleaseWatchEvaluator["evaluateAfterSnapshot"]>> | null = null;
    if (result.status === 'PUBLISHED' && args.watches && result.snapshotId && result.snapshotSeq) {
      const role = resolveRuntimeRole(process.env.DB_RUNTIME_ROLE, process.env.NODE_ENV);
      watches = await new ReleaseWatchEvaluator(pool, logger, role).evaluateAfterSnapshot({
        id: result.snapshotId,
        seq: result.snapshotSeq,
      });
    }
    if (args.json) {
      console.log(JSON.stringify({ ...result, watches }, null, 2));
    } else {
      console.log(
        `[knowledge-sync] ${result.status}: snapshot ${result.snapshotId ?? '-'} (seq ${result.snapshotSeq ?? '-'}), ` +
          `${result.documents.length} documents, ${result.documents.reduce((n, d) => n + d.records, 0)} records, ${result.durationMs} ms`
      );
      if (result.diff) console.log(`[knowledge-sync] diff ${JSON.stringify(result.diff)}`);
      if (watches) console.log(`[knowledge-sync] watches ${JSON.stringify(watches)}`);
    }
    return result.status === 'FAILED' ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (err) => {
      console.error(`[knowledge-sync] fatal: ${err?.message ?? err}`);
      process.exit(1);
    }
  );
}
