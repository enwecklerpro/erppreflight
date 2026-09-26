# Knowledge Graph & Product Intelligence Status

> Spec C §71 (Definition of Done — Product Intelligence), C §26–§32 / §75 #6.
> Design and API reference: `docs/KNOWLEDGE_GRAPH.md`. This file records status and measured numbers.

| Field | Value |
|---|---|
| Commit | `6303f1d` on `claude/sharp-mendel-xg6cus` |
| Date | 2026-09-26 |
| Deployment checked | **None.** The production database has not been synced; the numbers below come from a sync on the local stack |
| Tests | API unit/integration 979 passed incl. `apps/api/test/knowledge_graph.spec.ts`, `release_intelligence_notifications.spec.ts`, `public_tools.spec.ts`; Python 1169 passed + 1 skipped; live `e2e-tools-smoke.cjs` 24/24 (knowledge-graph lookup UI for MARA/BSEG) — 0 failed |

## Measured sync (real SAP Cloudification Repository, local stack)

Command: `DATABASE_URL=postgres://<schema owner>@…/erppreflight pnpm --filter @erppreflight/api knowledge:sync`
(source: `https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/`).

| Metric | First run | Second run |
|---|---|---|
| Files fetched | 13 | 13 (identical checksums) |
| Knowledge objects | 68,627 | — |
| Release states | 341,247 | — |
| Successor edges | 10,160 | — |
| Duration | ~37 s | — |
| Result | snapshot PUBLISHED | **NOOP** (no new snapshot) |
| SEO-gate-passing object pages | 655 | — |

Live consumer check (Clean Core on real ABAP, target release resolved to a snapshot release): `SELECT … FROM mara`
(line 4), `UPDATE bseg` (line 7) and `CALL FUNCTION 'BAPI_MATERIAL_SAVEDATA'` (line 8) flagged `VERIFIED` with the
official successors `I_PRODUCT…`, `I_OPERATIONALACCTGDOCITEM`, `I_PRODUCTTP_2` from the snapshot; the released
`I_PRODUCT`, `CL_ABAP_TYPEDESCR` and text inside string literals were not flagged. The snapshot id is stored in
`analyses.knowledge_snapshot_id`.

## C §71 checklist

| Item | Status | Evidence | Gap |
|---|---|---|---|
| Knowledge graph | Done (live, local) | Migration `014_knowledge_graph_release_intelligence.sql` (objects, aliases, release states, typed relationships with release validity/confidence/evidence, evidence sources with trust levels); `knowledge-graph/knowledge-graph.service.ts`; lookup (exact, prefix, alias, trigram, full text), neighborhood (depth ≤ 3), classify; UI `/knowledge-graph`, `/knowledge-graph/lookup`, `/knowledge-graph/objects/[id]` | No SAP object descriptions (not in the source data) |
| Versioned knowledge snapshots | Done (live, local) | `knowledge_snapshots` with seq, content SHA-256, per-file SHA-256/ETag manifest; trigger `knowledge_snapshot_immutable()` rejects UPDATE/DELETE of PUBLISHED snapshots; facts versioned `[valid_from_seq, valid_to_seq)`; `knowledge_sync_runs` records NOOP/FAILED | — |
| Cloudification integration | Done (live, local) | `sources/cloudification-repository.source.ts` (HTTPS only, allow-listed host, no redirects, 64 MB cap), `cloudification-normalizer.ts`, `sync/knowledge-sync.pipeline.ts`; weekly BullMQ job `knowledge-sync-weekly` (`KNOWLEDGE_SYNC_CRON`, default `17 3 * * 1`); admin `POST /api/v1/knowledge-graph/admin/sync` | Data has no transaction codes |
| ROSA | Partial | `sources/rosa-file-import.source.ts`; CLI `--rosa-file`, admin `POST knowledge-graph/admin/rosa-import` | No live ROSA: the public instance is retired; needs a customer-hosted endpoint |
| abaplint | Partial | In-service ABAP tokenizer `services/analysis-python/src/parsers/abap_tokenizer.py` (string literals, templates, comments aware); Clean Core accepts externally derived AST references `configuration.abap_references` (spec §29 hand-over format) | abaplint itself is not bundled or executed |
| abapGit | Partial | Clean Core accepts abapGit repository ZIPs (safe ZIP reader, nesting ≤ 2); Git connector snapshot/ingest (`POST connectors/:id/git/snapshot`, `git/ingest`) | API-side snapshot overlay does not scan object names inside abapGit ZIPs; no abapGit XML serialisation parsing beyond `*.abap` |
| oasdiff | Partial | API Change Guard diffs OpenAPI 2/3 and EDMX V2/V4 itself (`engines/api_change.py`) | No oasdiff-level rule set; no stored baselines |
| OData metadata | Done (vs double) | Connector type `ODATA` fetches `$metadata`, parses EDMX with defused XML, stores `connector_metadata_snapshots` (`connectors/adapters/metadata.adapters.ts`); `POST/GET connectors/:id/metadata` | Not run against a real SAP Gateway |
| Release intelligence | Done (live, local) | `release-intelligence.controller.ts`: catalog, snapshot diff, release diff, watches CRUD + events; watch re-evaluation after each published snapshot (`release-watch.evaluator.ts`); notifications in-app/webhook/e-mail (`notifications.controller.ts`); UI `/knowledge-graph/releases`, `/knowledge-graph/watches` | E-mail channel verified only with the dev mail transport |
| Test Lab | Partial | Regression tests, fixtures, batch runs, schedules (`lab/regression/regression-lab.controller.ts`, migration 017); scenario generation/run (`lab/lab.controller.ts`); UI `/projects/[id]/lab` | Generated tests and regression tests are separate models; lab runs create no analysis records |
| What-If | Done (unit tests) | ChangeSets `POST projects/:projectId/changesets/:id/simulate`, approve (`changesets.service.ts`); UI `/projects/[id]/simulation` (@xyflow/react) | Not part of a live smoke; plan feature `whatIfSimulation` not enforced |
| Dependency graph | Done | Object neighborhood API + graph view `components/knowledge-graph/object-graph.tsx` (@xyflow/react + elkjs); tenant objects/relationships `POST knowledge-graph/tenant-objects`, `tenant-relationships`; project object inventory `/projects/[id]/objects` | Transport-level graph limited to the Transport Dependency Analyzer engine output |

## Operational notes

- Global knowledge rows (`organization_id IS NULL`) are readable by every tenant and writable only outside the RLS
  runtime role (sync job, CLI, super-admin paths).
- Public lookup `GET /api/v1/knowledge-graph/public/lookup` serves only GLOBAL + PUBLISHED data, 30 requests/min/IP.
- After the first production deploy the owner must run the sync once (`docs/LIVE_PRODUCTION_VERIFICATION.md` §3.3);
  until then Clean Core falls back to its static curated list and no SAP object page is indexable.
