import { z } from 'zod';
import { customInstance, resolveApiUrl } from './api/custom-instance';

/**
 * Knowledge graph, release intelligence and notification API contracts.
 * Every response is validated at runtime so contract drift surfaces as a
 * query error instead of silently rendering undefined values.
 */

export const SupportStateSchema = z.enum([
  'RELEASED',
  'DEPRECATED',
  'NOT_RELEASED',
  'NOT_TO_BE_RELEASED_STABLE',
  'CLASSIC_API',
  'NO_API',
  'SUPPORTED',
  'BLOCKED',
  'UNKNOWN',
]);
export type SupportState = z.infer<typeof SupportStateSchema>;

export const TrustLevelSchema = z.enum([
  'OFFICIAL_REPOSITORY',
  'OFFICIAL_DOCUMENTATION',
  'OFFICIAL_SUPPORT',
  'OFFICIAL_COMMUNITY',
  'CURATED_RULE',
  'THIRD_PARTY',
  'CUSTOMER_EVIDENCE',
  'INFERRED',
]);
export type TrustLevel = z.infer<typeof TrustLevelSchema>;

const SuccessorSchema = z.object({
  sapObjectType: z.string(),
  objectKey: z.string(),
  objectId: z.string().nullable().optional(),
});

const HeadlineStateSchema = z.object({
  productCode: z.string(),
  editionCode: z.string(),
  releaseCode: z.string(),
  releaseLabel: z.string(),
  scheme: z.string(),
  state: z.string(),
  supportState: SupportStateSchema,
  cleanCoreLevel: z.string().nullable(),
  successors: z.array(SuccessorSchema.passthrough()),
});
export type HeadlineState = z.infer<typeof HeadlineStateSchema>;

const SnapshotRefSchema = z.object({ id: z.string(), seq: z.number() }).nullable();

export const LookupResultSchema = z.object({
  query: z.string(),
  snapshot: SnapshotRefSchema,
  results: z.array(
    z.object({
      id: z.string(),
      objectType: z.string(),
      sapObjectType: z.string(),
      objectKey: z.string(),
      displayName: z.string().nullable(),
      description: z.string().nullable(),
      applicationComponent: z.string().nullable(),
      softwareComponent: z.string().nullable(),
      scope: z.enum(['GLOBAL', 'TENANT']),
      reviewStatus: z.string(),
      score: z.number(),
      matchType: z.enum(['EXACT', 'PREFIX', 'ALIAS', 'FUZZY', 'TEXT']),
      states: z.array(HeadlineStateSchema),
    })
  ),
});
export type LookupResult = z.infer<typeof LookupResultSchema>;
export type LookupItem = LookupResult['results'][number];

export const ObjectStateSchema = z.object({
  productCode: z.string(),
  productName: z.string(),
  editionCode: z.string(),
  editionName: z.string(),
  releaseId: z.string(),
  releaseCode: z.string(),
  releaseLabel: z.string(),
  isRolling: z.boolean(),
  scheme: z.string(),
  state: z.string(),
  supportState: SupportStateSchema,
  cleanCoreLevel: z.string().nullable(),
  successorClassification: z.string().nullable(),
  successorConcept: z.string().nullable(),
  successors: z.array(SuccessorSchema),
  labels: z.array(z.string()).nullable().optional(),
  softwareComponent: z.string().nullable(),
  applicationComponent: z.string().nullable(),
  confidenceClass: z.string(),
  confidenceScore: z.number(),
  scope: z.enum(['GLOBAL', 'TENANT']),
  evidence: z.object({ sourceId: z.string(), title: z.string(), trustLevel: TrustLevelSchema, url: z.string().nullable() }),
  validFromSnapshotSeq: z.number(),
});
export type ObjectState = z.infer<typeof ObjectStateSchema>;

export const ObjectDetailSchema = z.object({
  object: z
    .object({
      id: z.string(),
      objectType: z.string(),
      sapObjectType: z.string(),
      objectKey: z.string(),
      tadirObject: z.string().nullable(),
      tadirObjName: z.string().nullable(),
      displayName: z.string().nullable(),
      description: z.string().nullable(),
      applicationComponent: z.string().nullable(),
      softwareComponent: z.string().nullable(),
      scope: z.enum(['GLOBAL', 'TENANT']),
      reviewStatus: z.string(),
      updatedAt: z.string().optional(),
    })
    .passthrough(),
  aliases: z.array(z.object({ alias: z.string(), aliasType: z.string() })),
  states: z.array(ObjectStateSchema),
  replaces: z.array(z.object({ id: z.string(), sapObjectType: z.string(), objectKey: z.string(), objectType: z.string() })),
  relationships: z.array(
    z
      .object({
        id: z.string(),
        relationshipType: z.string(),
        scope: z.string(),
        direction: z.enum(['OUTGOING', 'INCOMING']),
        source: z.object({ id: z.string(), objectKey: z.string(), sapObjectType: z.string() }),
        target: z.object({ id: z.string(), objectKey: z.string(), sapObjectType: z.string() }),
        releaseLabel: z.string().nullable(),
        trustLevel: z.string().nullable(),
      })
      .passthrough()
  ),
  evidenceSources: z.array(
    z
      .object({
        id: z.string(),
        title: z.string(),
        trustLevel: TrustLevelSchema,
        url: z.string().nullable(),
        publisher: z.string().nullable(),
        lastRetrievedAt: z.string().nullable(),
        sha256: z.string().optional(),
        etag: z.string().nullable().optional(),
        retrievedAt: z.string().optional(),
      })
      .passthrough()
  ),
  history: z.array(
    z.object({
      changeType: z.string(),
      previous: z.unknown(),
      current: z.unknown(),
      requiresReview: z.boolean(),
      releaseLabel: z.string(),
      snapshotSeq: z.number(),
      createdAt: z.string(),
    })
  ),
  snapshot: z
    .object({
      id: z.string(),
      seq: z.number(),
      adapterId: z.string(),
      contentSha256: z.string(),
      parserVersion: z.string(),
      publishedAt: z.string().nullable(),
    })
    .nullable(),
  seo: z.object({ indexable: z.boolean(), reasons: z.array(z.string()) }),
});
export type ObjectDetail = z.infer<typeof ObjectDetailSchema>;

export const NeighborhoodSchema = z.object({
  rootId: z.string(),
  depth: z.number(),
  truncated: z.boolean(),
  nodes: z.array(
    z
      .object({
        id: z.string(),
        kind: z.enum(['OBJECT', 'RELEASE']),
        objectKey: z.string(),
        objectType: z.string().optional(),
        sapObjectType: z.string().optional(),
        isRoot: z.boolean().optional(),
        states: z.array(HeadlineStateSchema).optional(),
      })
      .passthrough()
  ),
  edges: z.array(
    z.object({
      id: z.string(),
      source: z.string(),
      target: z.string(),
      relationshipType: z.string(),
      releases: z.array(z.string()),
      scope: z.string(),
      confidenceClass: z.string().nullable(),
    })
  ),
});
export type Neighborhood = z.infer<typeof NeighborhoodSchema>;

const ReleaseSchema = z.object({
  id: z.string(),
  code: z.string(),
  label: z.string(),
  featurePack: z.string().nullable(),
  sortOrder: z.number(),
  isRolling: z.boolean(),
  description: z.string().nullable(),
  counts: z.record(z.record(z.number())),
  sources: z.array(
    z.object({ sourceKey: z.string(), title: z.string(), trustLevel: TrustLevelSchema, url: z.string().nullable(), lastRetrievedAt: z.string().nullable() })
  ),
});
export type CatalogRelease = z.infer<typeof ReleaseSchema>;

export const CatalogSchema = z.object({
  snapshot: SnapshotRefSchema,
  products: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      editions: z.array(z.object({ code: z.string(), name: z.string(), deployment: z.string(), releases: z.array(ReleaseSchema) })),
    })
  ),
});
export type Catalog = z.infer<typeof CatalogSchema>;

const DiffItemSchema = z.object({
  objectId: z.string(),
  sapObjectType: z.string(),
  objectKey: z.string(),
  objectType: z.string(),
  changeType: z.string(),
  releaseLabel: z.string().nullable(),
  previous: z.object({ supportState: z.string(), state: z.string(), successors: z.unknown() }).nullable(),
  current: z.object({ supportState: z.string(), state: z.string(), successors: z.unknown() }).nullable(),
});
export type DiffItem = z.infer<typeof DiffItemSchema>;
export const DiffPageSchema = z.object({
  summary: z.record(z.number()),
  total: z.number(),
  items: z.array(DiffItemSchema),
});
export type DiffPage = z.infer<typeof DiffPageSchema>;

export const SnapshotSchema = z.object({
  id: z.string(),
  seq: z.number(),
  adapterId: z.string(),
  contentSha256: z.string(),
  parserVersion: z.string(),
  sourceVersions: z.array(z.record(z.unknown())),
  diffSummary: z.record(z.unknown()),
  triggeredBy: z.string().nullable(),
  publishedAt: z.string().nullable(),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

export const WatchSchema = z.object({
  id: z.string(),
  watchType: z.string(),
  label: z.string(),
  notes: z.string().nullable(),
  status: z.enum(['ACTIVE', 'PAUSED']),
  findingId: z.string().nullable(),
  releaseId: z.string().nullable(),
  releaseLabel: z.string().nullable(),
  targets: z.array(z.object({ id: z.string(), sapObjectType: z.string().nullable(), objectKey: z.string().nullable() }).passthrough()),
  baselineFacts: z.number(),
  baselineSupportStates: z.array(z.string()),
  lastEvaluatedAt: z.string().nullable(),
  lastChangeAt: z.string().nullable(),
  eventCount: z.number(),
  createdAt: z.string(),
});
export type Watch = z.infer<typeof WatchSchema>;

export const WatchEventSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  objectKey: z.string().nullable(),
  sapObjectType: z.string().nullable(),
  releaseLabel: z.string().nullable(),
  snapshotSeq: z.number(),
  previous: z.object({ supportState: z.string(), successors: z.array(z.string()) }).passthrough().nullable(),
  current: z.object({ supportState: z.string(), successors: z.array(z.string()) }).passthrough().nullable(),
  createdAt: z.string(),
});
export type WatchEvent = z.infer<typeof WatchEventSchema>;

export const NotificationSeveritySchema = z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MEDIUM', 'MINOR', 'LOW', 'INFO']);
export const NotificationSchema = z.object({
  id: z.string(),
  eventType: z.string(),
  severity: NotificationSeveritySchema,
  title: z.string(),
  body: z.string(),
  link: z.string().nullable(),
  projectId: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AppNotification = z.infer<typeof NotificationSchema>;
export const NotificationPageSchema = z.object({
  items: z.array(NotificationSchema),
  nextBefore: z.string().nullable(),
  unreadCount: z.number(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;
export const NotificationPreferenceSchema = z.object({ eventType: z.string(), inApp: z.boolean(), email: z.boolean() });

// ---------------------------------------------------------------------------
// Query keys (tenant-scoped data is evicted by queryClient.clear() on logout / tenant switch)
// ---------------------------------------------------------------------------
export const kgKeys = {
  all: ['knowledge-graph'] as const,
  lookup: (q: string, type: string | null, isPublic: boolean) => ['knowledge-graph', 'lookup', { q, type, isPublic }] as const,
  object: (id: string) => ['knowledge-graph', 'object', id] as const,
  neighborhood: (id: string, depth: number) => ['knowledge-graph', 'neighborhood', id, depth] as const,
  catalog: ['knowledge-graph', 'catalog'] as const,
  snapshots: ['knowledge-graph', 'snapshots'] as const,
  releaseDiff: (p: Record<string, unknown>) => ['knowledge-graph', 'release-diff', p] as const,
  snapshotDiff: (p: Record<string, unknown>) => ['knowledge-graph', 'snapshot-diff', p] as const,
  watches: ['knowledge-graph', 'watches'] as const,
  watchEvents: (id: string) => ['knowledge-graph', 'watches', id, 'events'] as const,
};

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (status: string) => ['notifications', 'list', status] as const,
  unread: ['notifications', 'unread-count'] as const,
  preferences: ['notifications', 'preferences'] as const,
  channels: ['notifications', 'channels'] as const,
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------
const qs = (params: Record<string, string | number | undefined | null>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
};

export async function lookupObjects(q: string, opts: { type?: string | null; isPublic?: boolean; signal?: AbortSignal } = {}) {
  const base = opts.isPublic ? '/knowledge-graph/public/lookup' : '/knowledge-graph/lookup';
  const data = await customInstance<unknown>(`${base}${qs({ q, type: opts.type ?? undefined, limit: 20 })}`, {
    signal: opts.signal,
  });
  return LookupResultSchema.parse(data);
}

export async function fetchObjectDetail(id: string, signal?: AbortSignal) {
  return ObjectDetailSchema.parse(await customInstance<unknown>(`/knowledge-graph/objects/${encodeURIComponent(id)}`, { signal }));
}

/** Server-side fetch for the public object page (no auth, cached 5 minutes). */
export async function fetchPublicObject(sapType: string, key: string): Promise<ObjectDetail | null> {
  const res = await fetch(
    resolveApiUrl(`/knowledge-graph/public/objects/${encodeURIComponent(sapType)}/${encodeURIComponent(key)}`),
    { next: { revalidate: 300 } }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Knowledge lookup failed (HTTP ${res.status})`);
  return ObjectDetailSchema.parse(await res.json());
}

export async function fetchNeighborhood(id: string, depth: number, signal?: AbortSignal) {
  return NeighborhoodSchema.parse(
    await customInstance<unknown>(`/knowledge-graph/objects/${encodeURIComponent(id)}/neighborhood${qs({ depth, limit: 80 })}`, { signal })
  );
}

export async function fetchCatalog(signal?: AbortSignal) {
  return CatalogSchema.parse(await customInstance<unknown>('/release-intelligence/catalog', { signal }));
}

export async function fetchSnapshots(signal?: AbortSignal) {
  return z.array(SnapshotSchema).parse(await customInstance<unknown>('/knowledge-graph/snapshots', { signal }));
}

export async function fetchReleaseDiff(
  p: { fromRelease: string; toRelease: string; changeType?: string; q?: string; offset?: number },
  signal?: AbortSignal
) {
  return DiffPageSchema.parse(
    await customInstance<unknown>(`/release-intelligence/diff/releases${qs({ ...p, limit: 50 })}`, { signal })
  );
}

export async function fetchSnapshotDiff(
  p: { from: number; to: number; changeType?: string; q?: string; offset?: number },
  signal?: AbortSignal
) {
  return DiffPageSchema.parse(
    await customInstance<unknown>(`/release-intelligence/diff/snapshots${qs({ ...p, limit: 50 })}`, { signal })
  );
}

export async function fetchWatches(signal?: AbortSignal) {
  return z.array(WatchSchema).parse(await customInstance<unknown>('/release-intelligence/watches', { signal }));
}

export async function fetchWatchEvents(id: string, signal?: AbortSignal) {
  return z.array(WatchEventSchema).parse(await customInstance<unknown>(`/release-intelligence/watches/${id}/events`, { signal }));
}

export const CreateWatchFormSchema = z.object({
  watchType: z.enum(['OBJECT', 'API', 'GAP', 'SUCCESSOR_MAPPING']),
  releaseId: z.string(),
  label: z.string().trim().max(300, 'At most 300 characters'),
  notes: z.string().trim().max(2000, 'At most 2000 characters'),
});
export type CreateWatchForm = z.infer<typeof CreateWatchFormSchema>;

export async function createWatch(body: { objectId: string } & CreateWatchForm) {
  return WatchSchema.parse(
    await customInstance<unknown>('/release-intelligence/watches', {
      method: 'POST',
      body: JSON.stringify({
        watchType: body.watchType,
        objectId: body.objectId,
        ...(body.releaseId ? { releaseId: body.releaseId } : {}),
        ...(body.label ? { label: body.label } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      }),
    })
  );
}

export async function updateWatch(id: string, body: { status?: 'ACTIVE' | 'PAUSED' }) {
  return WatchSchema.parse(
    await customInstance<unknown>(`/release-intelligence/watches/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
  );
}

export async function deleteWatch(id: string) {
  return customInstance<unknown>(`/release-intelligence/watches/${id}`, { method: 'DELETE' });
}

export async function fetchNotifications(status: 'all' | 'unread', before?: string, signal?: AbortSignal) {
  return NotificationPageSchema.parse(
    await customInstance<unknown>(`/notifications${qs({ status, limit: 20, before })}`, { signal })
  );
}

export async function fetchUnreadCount(signal?: AbortSignal) {
  return z.object({ unreadCount: z.number() }).parse(await customInstance<unknown>('/notifications/unread-count', { signal }));
}

export async function markNotificationRead(id: string, read: boolean) {
  return customInstance<unknown>(`/notifications/${id}/${read ? 'read' : 'unread'}`, { method: 'POST' });
}

export async function markAllNotificationsRead() {
  return customInstance<unknown>('/notifications/read-all', { method: 'POST' });
}

export async function fetchNotificationPreferences(signal?: AbortSignal) {
  return z.array(NotificationPreferenceSchema).parse(await customInstance<unknown>('/notifications/preferences', { signal }));
}

export async function saveNotificationPreferences(items: Array<{ eventType: string; inApp: boolean; email: boolean }>) {
  return z.array(NotificationPreferenceSchema).parse(
    await customInstance<unknown>('/notifications/preferences', { method: 'PUT', body: JSON.stringify({ items }) })
  );
}

export async function fetchNotificationChannels(signal?: AbortSignal) {
  return z
    .object({ inApp: z.boolean(), webhook: z.boolean(), email: z.boolean() })
    .parse(await customInstance<unknown>('/notifications/channels', { signal }));
}
