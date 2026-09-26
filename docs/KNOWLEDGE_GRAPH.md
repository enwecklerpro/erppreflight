# Knowledge graph, release intelligence and notifications

Spec: Part 04 (§4.3–4.9), Part 05 (§5.2–5.4, §5.10), Part 14 (§14.14, §14.33), Part 17 (§17.3),
remediation prompt §26–§31, §59, §71. Migration: `packages/database/migrations/014_knowledge_graph_release_intelligence.sql`.

Status against C §71 and measured sync numbers (13 files, 68,627 objects, 341,247 release states, 10,160 successor
edges, ~37 s, second run NOOP — local stack, commit `6303f1d`): **[`docs/KNOWLEDGE_GRAPH_STATUS.md`](KNOWLEDGE_GRAPH_STATUS.md)**.
Production has not been synced yet.

## Data model

| Table | Scope | Purpose |
|---|---|---|
| `knowledge_products` / `knowledge_editions` / `knowledge_releases` | global | Release catalog (e.g. SAP_S4HANA / CLOUD_PRIVATE / `2023 FPS03`, rolling `LATEST` lists) |
| `knowledge_evidence_sources` | global + tenant | Evidence source with trust level (OFFICIAL_REPOSITORY … INFERRED) |
| `knowledge_objects` (+ `knowledge_object_aliases`) | global + tenant | Base object (typed via `object_type`, repository type in `sap_object_type`, extensions in `attributes`) |
| `knowledge_object_release_states` | global + tenant | Support state per object × release × scheme × evidence source — never a boolean |
| `knowledge_relationships` | global + tenant | Typed edges (SUCCESSOR_OF, DEPENDS_ON, …) with release validity, confidence, evidence, review status |
| `knowledge_snapshots` | global | Immutable snapshot (seq, content SHA-256, source manifest with per-file SHA-256/ETag/retrieval date, parser version). A trigger rejects UPDATE/DELETE once PUBLISHED |
| `knowledge_sync_runs` | global | Every sync attempt incl. NOOP and FAILED |
| `knowledge_change_events` | global | Per-object diff of each non-initial snapshot |
| `release_watches`, `release_watch_events` | tenant (RLS) | Watches and detected changes |
| `notifications`, `notification_preferences` | tenant (RLS) | Per-user inbox and channel mutes |
| `analyses.knowledge_snapshot_id` | tenant | Snapshot used by an analysis (reproducibility) |

Facts are versioned with `[valid_from_seq, valid_to_seq)`: the state of any past snapshot is reconstructed exactly;
closing a range never rewrites a fact.

**RLS.** Global rows (`organization_id IS NULL`) are readable by all tenants. Writes to global rows are only allowed when
the session is not the runtime role `erppreflight_app` — i.e. the sync job/CLI/super-admin paths that run as the schema
owner. Tenant request transactions (`SET LOCAL ROLE erppreflight_app`) can only write their own tenant rows.

## Sources

* **SAP Cloudification Repository** (`SAP_CLOUDIFICATION_REPOSITORY`, trust OFFICIAL_REPOSITORY): 13 files from
  `https://raw.githubusercontent.com/SAP/abap-atc-cr-cv-s4hc/main/src/` (Latest public, PCE latest, BTP latest,
  classic API classification, PCE 2022…2025 FPS files). HTTPS only, allow-listed host, no redirects, 64 MB cap per
  file, streamed SHA-256. Idempotent: identical composite checksum ⇒ run recorded as NOOP, no snapshot.
* **ROSA** (`ROSA_FILE_IMPORT`, trust THIRD_PARTY): there is no public ROSA instance (the hosted one was retired), so
  live ROSA access requires a customer-operated endpoint. The adapter imports saved ROSA REST responses:

```json
{
  "rosaExportVersion": 1,
  "system_type": "public_cloud | btp | private_cloud | on_premise",
  "version": "latest | 2022 | 2023_3 | ...",
  "retrievedAt": "2026-09-26T00:00:00Z",
  "instanceUrl": "https://rosa.internal.example/",
  "responses": [ <body of GET /api/search | /api/object | /api/successor | /api/compliance> ]
}
```

Both implement `ReleasedObjectSource` (`apps/api/src/modules/knowledge-graph/knowledge-graph.types.ts`); domain code
only sees normalized states.

## Running the sync

```bash
pnpm --filter @erppreflight/api build
DATABASE_URL=postgres://owner:…@host/db pnpm --filter @erppreflight/api knowledge:sync
#   -- --files objectReleaseInfoLatest.json,objectClassifications_SAP.json   subset
#   -- --local-dir /mirror/src          offline mirror (operator only; never exposed over HTTP)
#   -- --rosa-file export.json          ROSA import
#   -- --no-watches | --json
```

* Scheduled: BullMQ queue `knowledge-sync`, job scheduler `knowledge-sync-weekly`, `KNOWLEDGE_SYNC_CRON`
  (default `17 3 * * 1`, UTC; `off` disables).
* Admin: `POST /api/v1/knowledge-graph/admin/sync` (super admin), log at `GET …/admin/sync-runs`,
  ROSA upload `POST …/admin/rosa-import`, curation `POST …/admin/curated-objects` + `POST …/admin/objects/:id/review`
  (Draft → In review → Approved → Published).
* Source Sync Admin (web `/admin/sources`, API `GET /api/v1/admin/sources`): per adapter last run, last successful
  sync, freshness against a configurable threshold, failed runs (30 days), item counts, changed records of the latest
  snapshot and `POST …/admin/sources/:adapterId/retry` (Cloudification only; ROSA is a file import). The hourly
  freshness check (`platform-governance` queue, `SOURCE_FRESHNESS_CRON`, default `41 * * * *`; also
  `POST …/admin/sources/freshness-check`) opens one `knowledge_source_alerts` row per stale *critical* source, notifies
  every super admin in-app (`knowledge.source_stale`) and by e-mail, and resolves the alert when the source is fresh
  again. The Cloudification Repository is critical by default (threshold 192 h).
* Knowledge Admin graph view (web `/admin/knowledge`, API `GET /api/v1/admin/knowledge-graph/{summary,objects,conflicts}`):
  object records with evidence sources, release validity, last verification and facts on which sources disagree.

After every published snapshot, release watches whose objects changed are re-evaluated; each changed watch writes
`release_watch_events` and a `release_watch.changed` outbox event.

## API

| Endpoint | Auth |
|---|---|
| `GET /knowledge-graph/lookup?q=&type=&limit=` (exact, prefix, alias, pg_trgm fuzzy, full text) | tenant |
| `GET /knowledge-graph/objects/:id`, `/objects/resolve?type=&key=`, `/objects/:id/neighborhood?depth≤3` | tenant |
| `POST /knowledge-graph/classify {names[], targetRelease \| productCode+editionCode+releaseCode}` | tenant |
| `GET /knowledge-graph/snapshots`, `/evidence-sources`; `POST /tenant-objects`, `/tenant-relationships` | tenant |
| `GET /knowledge-graph/public/lookup`, `/public/objects/:type/:key` (GLOBAL + PUBLISHED only, 30 req/min/IP, `seo.indexable`) | public |
| `GET /release-intelligence/catalog`, `/diff/snapshots?from=&to=`, `/diff/releases?fromRelease=&toRelease=` | tenant |
| `GET/POST/PATCH/DELETE /release-intelligence/watches[/:id]`, `GET /watches/:id/events` | tenant |
| `GET /notifications`, `/unread-count`, `/channels`, `POST /:id/read`, `/:id/unread`, `/read-all`, `GET/PUT /preferences` | user |

## Clean Core integration (`configuration.released_objects`)

For `CLEAN_CORE_OBJECT_GUARD` the API extracts candidate identifiers from the text artifact, classifies those that
exist in the latest snapshot for the analysis target release (`S4H_2022/2023` → latest FPS of that year;
`S4H_2020/2021` → Private LATEST, flagged `exactMatch=false`; `S4HC_*` → Cloud ERP LATEST) and sends:

```json
{ "released_objects": {
  "schemaVersion": 1, "snapshotId": "<uuid>", "snapshotSeq": 3, "contentSha256": "<hex>",
  "source": "SAP_CLOUDIFICATION_REPOSITORY",
  "release": { "productCode": "SAP_S4HANA", "editionCode": "CLOUD_PRIVATE", "releaseCode": "2023 FPS03", "label": "…", "exactMatch": true },
  "objects": [ { "objectType": "TABL", "objectName": "MARA", "tadirObject": "TABL", "state": "notToBeReleased",
                 "classicApiState": null, "cleanCoreLevel": null, "successorClassification": "multipleObjects",
                 "successorConcept": null, "successors": [ { "objectType": "CDS_STOB", "objectName": "I_PRODUCT" } ] } ] } }
```

The snapshot id is stored in `analyses.knowledge_snapshot_id`. Python (`src/platform/knowledge_client.py`) overlays
these facts on the static curated list (snapshot wins for covered objects, static list is the fallback) and records
`knowledgeGraphSnapshotId`, `knowledgeSource`, `verdictSource` in every finding's technical details.

## Notifications

Events come from the transactional outbox: `analysis.completed`, `analysis.failed`, `finding.critical` (recorded by the
analysis processor) and `release_watch.changed`. Channels:

* **in-app** — `notifications`, deduplicated per (user, event), inbox + navbar bell;
* **webhook** — the existing `WebhooksService` receives every outbox event and delivers it HMAC-SHA256 signed;
* **e-mail** — through the `MailSender` interface registered under the token `MAIL_SENDER`
  (`apps/api/src/modules/notifications/mail-sender.interface.ts`), resolved lazily from any module. Without a provider
  the channel is a no-op and `GET /notifications/channels` reports `email: false`. E-mail defaults: on for failed
  analyses, critical findings and watch changes; off for completed analyses; users can mute per event/channel.
