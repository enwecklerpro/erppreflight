/**
 * Platform governance client (SUPER_ADMIN, spec 10.9–10.12): Rule Admin, AI Admin,
 * Knowledge Admin (articles + knowledge graph view) and Source Sync Admin. Every
 * response is validated with Zod before it reaches a component.
 */
import { z } from 'zod';
import { customInstance } from './custom-instance';
import { parse } from './commercial';
import { vmsg } from '@/i18n/validation';

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });
const nullableString = z.string().nullable();

// -----------------------------------------------------------------------------
// Rule Admin (10.10)
// -----------------------------------------------------------------------------

export const RULE_STATUSES = ['DRAFT', 'IN_REVIEW', 'PUBLISHED', 'DEPRECATED'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];
export const SELF_TEST_STATUSES = ['PASSED', 'FAILED', 'NO_FIXTURES', 'ERROR'] as const;

const LatestSelfTestSchema = z.object({
  id: z.string(),
  status: z.enum(SELF_TEST_STATUSES),
  ruleVersion: z.string(),
  resultDigest: nullableString,
  positiveCount: z.number(),
  negativeCount: z.number(),
  createdAt: z.string(),
});

export const RuleItemSchema = z.object({
  ruleCode: z.string(),
  engineType: z.string(),
  engineName: z.string(),
  domain: z.string(),
  title: z.string(),
  defaultSeverity: z.string(),
  category: z.string(),
  version: nullableString,
  inputValidationRule: z.boolean(),
  status: z.enum(RULE_STATUSES),
  author: nullableString,
  reviewer: nullableString,
  notes: nullableString,
  publishedVersion: nullableString,
  publishedAt: nullableString,
  drifted: z.boolean(),
  coverage: z.object({ covered: z.boolean(), gap: nullableString, positiveCases: z.number(), negativeCases: z.number() }),
  latestSelfTest: LatestSelfTestSchema.nullable(),
  selfTestCurrent: z.boolean(),
  publishBlocker: nullableString,
  allowedTransitions: z.array(z.enum(RULE_STATUSES)),
  updatedAt: nullableString,
});
export type RuleItem = z.infer<typeof RuleItemSchema>;

export const RuleInventorySchema = z.object({
  manifestVersion: z.string(),
  goldenCases: z.number(),
  summary: z.object({
    rules: z.number(),
    engines: z.number(),
    covered: z.number(),
    coverageGaps: z.number(),
    published: z.number(),
    inReview: z.number(),
    deprecated: z.number(),
    drifted: z.number(),
    selfTestsPassed: z.number(),
    selfTestsFailing: z.number(),
  }),
  engines: z.array(z.object({ engineType: z.string(), name: z.string(), version: z.string(), domain: z.string(), rules: z.number() })),
  items: z.array(RuleItemSchema),
});
export type RuleInventory = z.infer<typeof RuleInventorySchema>;

const CaseSchema = z.object({
  caseId: z.string(),
  kind: z.enum(['POSITIVE', 'NEGATIVE']),
  fixture: z.string(),
  status: z.string(),
  emittedCodes: z.array(z.string()),
  passed: z.boolean(),
  detail: z.string(),
});

export const RuleDetailSchema = RuleItemSchema.extend({
  positiveCaseIds: z.array(z.string()),
  negativeCaseIds: z.array(z.string()),
  history: z.array(
    z.object({
      id: z.string(),
      eventType: z.string(),
      fromStatus: nullableString,
      toStatus: nullableString,
      ruleVersion: nullableString,
      actorEmail: nullableString,
      note: nullableString,
      details: z.record(z.unknown()),
      createdAt: z.string(),
    })
  ),
  selfTests: z.array(
    z.object({
      id: z.string(),
      status: z.enum(SELF_TEST_STATUSES),
      ruleVersion: z.string(),
      positiveCount: z.number(),
      negativeCount: z.number(),
      resultDigest: nullableString,
      durationMs: z.number().nullable(),
      cases: z.array(CaseSchema.passthrough()),
      createdAt: z.string(),
    })
  ),
});
export type RuleDetail = z.infer<typeof RuleDetailSchema>;

export const SelfTestResultSchema = z.object({
  id: z.string(),
  ruleCode: z.string(),
  status: z.enum(SELF_TEST_STATUSES),
  ruleVersion: z.string(),
  resultDigest: z.string(),
  positiveCount: z.number(),
  negativeCount: z.number(),
  cases: z.array(CaseSchema.passthrough()),
});

export const RuleGovernanceFormSchema = z.object({
  author: z.string().trim().max(200),
  reviewer: z.string().trim().max(200),
  notes: z.string().trim().max(4000),
});
export type RuleGovernanceForm = z.infer<typeof RuleGovernanceFormSchema>;

export const ruleKeys = {
  all: ['admin', 'rules'] as const,
  detail: (code: string) => ['admin', 'rules', code] as const,
};

export async function fetchRuleInventory(): Promise<RuleInventory> {
  return parse(RuleInventorySchema, '/admin/rules', await customInstance('/admin/rules'));
}

export async function fetchRuleDetail(code: string): Promise<RuleDetail> {
  return parse(RuleDetailSchema, '/admin/rules/:code', await customInstance(`/admin/rules/${encodeURIComponent(code)}`));
}

export async function runRuleSelfTest(code: string) {
  return parse(
    SelfTestResultSchema,
    '/admin/rules/:code/self-test',
    await customInstance(`/admin/rules/${encodeURIComponent(code)}/self-test`, { method: 'POST' })
  );
}

export async function updateRuleGovernance(code: string, form: RuleGovernanceForm): Promise<RuleDetail> {
  const v = RuleGovernanceFormSchema.parse(form);
  const orNull = (s: string) => (s.length > 0 ? s : null);
  return parse(
    RuleDetailSchema,
    '/admin/rules/:code',
    await customInstance(`/admin/rules/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      ...json({ author: orNull(v.author), reviewer: orNull(v.reviewer), notes: orNull(v.notes) }),
    })
  );
}

export async function transitionRule(code: string, to: RuleStatus, note?: string): Promise<RuleDetail> {
  return parse(
    RuleDetailSchema,
    '/admin/rules/:code/transition',
    await customInstance(`/admin/rules/${encodeURIComponent(code)}/transition`, {
      method: 'POST',
      ...json(note ? { to, note } : { to }),
    })
  );
}

// -----------------------------------------------------------------------------
// AI Admin (10.11)
// -----------------------------------------------------------------------------

export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'OLLAMA_LOCAL'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_PRIVACY_MODES = ['STANDARD', 'SELF_HOSTED_ONLY'] as const;

const ProviderEnum = z.enum(AI_PROVIDERS);

export const AiTaskSchema = z.object({
  task: z.string(),
  usedBy: z.string(),
  configured: z.boolean(),
  config: z.object({
    enabled: z.boolean(),
    provider: ProviderEnum.nullable(),
    effectiveProvider: ProviderEnum.nullable(),
    primaryModel: nullableString,
    effectiveModel: nullableString,
    fallbackProvider: ProviderEnum.nullable(),
    fallbackModel: nullableString,
    maxTokens: z.number(),
    temperature: z.number().nullable(),
    privacyMode: z.enum(AI_PRIVACY_MODES),
    costCeilingEurMonthly: z.number().nullable(),
    inputPriceEurPer1k: z.number(),
    outputPriceEurPer1k: z.number(),
  }),
  spend: z.object({
    periodMonth: z.string(),
    requests: z.number(),
    blockedRequests: z.number(),
    inputTokens: z.number(),
    outputTokens: z.number(),
    costEur: z.number(),
    byProvider: z.array(z.object({ provider: z.string(), model: z.string(), requests: z.number(), blockedRequests: z.number(), costEur: z.number() })),
  }),
  ceilingReached: z.boolean(),
  updatedAt: z.string().nullable(),
});
export type AiTask = z.infer<typeof AiTaskSchema>;

export const AiOverviewSchema = z.object({
  defaultProvider: ProviderEnum.nullable(),
  confidenceCap: z.number(),
  periodMonth: z.string(),
  tasks: z.array(AiTaskSchema),
  providers: z.array(
    z.object({
      provider: ProviderEnum,
      selfHosted: z.boolean(),
      killSwitch: z.boolean(),
      killReason: nullableString,
      killedAt: nullableString,
      endpointUrl: nullableString,
      environmentEndpoint: nullableString,
      credentialsConfigured: z.boolean(),
      defaultModel: z.string(),
      updatedAt: nullableString,
    })
  ),
});
export type AiOverview = z.infer<typeof AiOverviewSchema>;
export type AiProviderControl = AiOverview['providers'][number];

const MODEL_RE = /^[A-Za-z0-9._:/@-]*$/;
/** Form values (strings for optional inputs; '' means "platform default"). */
export const AiTaskFormSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.union([ProviderEnum, z.literal('')]),
    primaryModel: z.string().trim().max(120).regex(MODEL_RE),
    fallbackProvider: z.union([ProviderEnum, z.literal('')]),
    fallbackModel: z.string().trim().max(120).regex(MODEL_RE),
    maxTokens: z.number().int().min(64).max(4096),
    temperature: z.string().trim().refine((v) => v === '' || (Number(v) >= 0 && Number(v) <= 2), vmsg('app.governance.validation.temperature')),
    privacyMode: z.enum(AI_PRIVACY_MODES),
    costCeilingEurMonthly: z.string().trim().refine((v) => v === '' || (Number(v) >= 0 && Number(v) <= 1_000_000), vmsg('app.governance.validation.ceiling')),
    inputPriceEurPer1k: z.number().min(0).max(1_000_000),
    outputPriceEurPer1k: z.number().min(0).max(1_000_000),
  })
  .superRefine((v, ctx) => {
    if (v.fallbackModel && !v.fallbackProvider) ctx.addIssue({ code: 'custom', path: ['fallbackProvider'], message: vmsg('app.governance.validation.fallbackProvider') });
    if (v.privacyMode === 'SELF_HOSTED_ONLY') {
      for (const key of ['provider', 'fallbackProvider'] as const) {
        if (v[key] && v[key] !== 'OLLAMA_LOCAL') ctx.addIssue({ code: 'custom', path: [key], message: vmsg('app.governance.validation.selfHostedOnly') });
      }
    }
    if (v.costCeilingEurMonthly !== '' && v.inputPriceEurPer1k === 0 && v.outputPriceEurPer1k === 0) {
      ctx.addIssue({ code: 'custom', path: ['outputPriceEurPer1k'], message: vmsg('app.governance.validation.pricesRequired') });
    }
  });
export type AiTaskForm = z.infer<typeof AiTaskFormSchema>;

export function aiTaskToForm(task: AiTask): AiTaskForm {
  const c = task.config;
  return {
    enabled: c.enabled,
    provider: task.configured ? (c.provider ?? '') : '',
    primaryModel: c.primaryModel ?? '',
    fallbackProvider: c.fallbackProvider ?? '',
    fallbackModel: c.fallbackModel ?? '',
    maxTokens: c.maxTokens,
    temperature: c.temperature === null ? '' : String(c.temperature),
    privacyMode: c.privacyMode,
    costCeilingEurMonthly: c.costCeilingEurMonthly === null ? '' : String(c.costCeilingEurMonthly),
    inputPriceEurPer1k: c.inputPriceEurPer1k,
    outputPriceEurPer1k: c.outputPriceEurPer1k,
  };
}

export const aiKeys = { overview: ['admin', 'ai'] as const };

export async function fetchAiOverview(): Promise<AiOverview> {
  return parse(AiOverviewSchema, '/admin/ai', await customInstance('/admin/ai'));
}

export async function saveAiTask(task: string, form: AiTaskForm) {
  const v = AiTaskFormSchema.parse(form);
  return parse(
    AiTaskSchema,
    '/admin/ai/tasks/:task',
    await customInstance(`/admin/ai/tasks/${encodeURIComponent(task)}`, {
      method: 'PUT',
      ...json({
        enabled: v.enabled,
        provider: v.provider || null,
        primaryModel: v.primaryModel || null,
        fallbackProvider: v.fallbackProvider || null,
        fallbackModel: v.fallbackModel || null,
        maxTokens: v.maxTokens,
        temperature: v.temperature === '' ? null : Number(v.temperature),
        privacyMode: v.privacyMode,
        costCeilingEurMonthly: v.costCeilingEurMonthly === '' ? null : Number(v.costCeilingEurMonthly),
        inputPriceEurPer1k: v.inputPriceEurPer1k,
        outputPriceEurPer1k: v.outputPriceEurPer1k,
      }),
    })
  );
}

export async function resetAiTask(task: string) {
  return parse(AiTaskSchema, '/admin/ai/tasks/:task', await customInstance(`/admin/ai/tasks/${encodeURIComponent(task)}`, { method: 'DELETE' }));
}

export async function setAiProviderKillSwitch(provider: AiProvider, killSwitch: boolean, reason: string | null) {
  return customInstance(`/admin/ai/providers/${provider}`, { method: 'PUT', ...json({ killSwitch, reason }) });
}

// -----------------------------------------------------------------------------
// Knowledge Admin (10.9): articles workflow + knowledge graph view
// -----------------------------------------------------------------------------

export const ARTICLE_STATUSES = ['DRAFT', 'TECHNICAL_REVIEW', 'SEO_REVIEW', 'PUBLISHED', 'UPDATE_REQUIRED', 'DEPRECATED', 'ARCHIVED'] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const AdminArticleSchema = z.object({
  id: z.string(),
  slug: z.string(),
  locale: z.enum(['en', 'de']),
  title: z.string(),
  summary: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  version: z.number(),
  provenance: z.string(),
  updatedAt: z.string(),
  publishedAt: nullableString,
  technicalReviewedAt: nullableString.optional(),
  seoReviewedAt: nullableString.optional(),
  updateRequiredReason: nullableString.optional(),
});
export type AdminArticle = z.infer<typeof AdminArticleSchema>;

const WorkflowSchema = z.object({ transitions: z.record(z.array(z.enum(ARTICLE_STATUSES))), publicStatuses: z.array(z.string()) });
export type ArticleWorkflow = z.infer<typeof WorkflowSchema>;

export const RevisionSchema = z.object({
  version: z.number(),
  status: z.string(),
  title: z.string(),
  changedBy: nullableString,
  changeNote: nullableString,
  transition: nullableString,
  createdAt: z.string(),
});

export const ArticleDraftFormSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(3)
    .max(160)
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, vmsg('app.governance.validation.slug')),
  locale: z.enum(['en', 'de']),
  title: z.string().trim().min(5).max(200),
  summary: z.string().trim().min(20).max(500),
  bodyMarkdown: z.string().min(50).max(100_000),
  sourceTitle: z.string().trim().max(200),
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), vmsg('app.governance.validation.https')),
});
export type ArticleDraftForm = z.infer<typeof ArticleDraftFormSchema>;

export const knowledgeKeys = {
  articles: ['admin', 'knowledge', 'articles'] as const,
  workflow: ['admin', 'knowledge', 'workflow'] as const,
  revisions: (id: string) => ['admin', 'knowledge', 'revisions', id] as const,
  kgSummary: ['admin', 'knowledge-graph', 'summary'] as const,
  kgObjects: (q: string, status: string, conflictsOnly: boolean, offset: number) =>
    ['admin', 'knowledge-graph', 'objects', q, status, conflictsOnly, offset] as const,
  kgConflicts: ['admin', 'knowledge-graph', 'conflicts'] as const,
};

export async function fetchAdminArticles(): Promise<AdminArticle[]> {
  return parse(z.array(AdminArticleSchema.passthrough()), '/admin/knowledge', await customInstance('/admin/knowledge'));
}

export async function fetchArticleWorkflow(): Promise<ArticleWorkflow> {
  return parse(WorkflowSchema, '/admin/knowledge/workflow', await customInstance('/admin/knowledge/workflow'));
}

export async function fetchArticleRevisions(id: string) {
  return parse(z.array(RevisionSchema.passthrough()), '/admin/knowledge/:id/revisions', await customInstance(`/admin/knowledge/${id}/revisions`));
}

export async function createArticleDraft(form: ArticleDraftForm) {
  const v = ArticleDraftFormSchema.parse(form);
  return parse(
    AdminArticleSchema.passthrough(),
    '/admin/knowledge',
    await customInstance('/admin/knowledge', {
      method: 'POST',
      ...json({
        slug: v.slug,
        locale: v.locale,
        title: v.title,
        summary: v.summary,
        bodyMarkdown: v.bodyMarkdown,
        sources: v.sourceUrl ? [{ title: v.sourceTitle || v.sourceUrl, url: v.sourceUrl }] : [],
      }),
    })
  );
}

export async function transitionArticle(id: string, to: ArticleStatus, reason?: string) {
  return parse(
    AdminArticleSchema.passthrough(),
    '/admin/knowledge/:id/transition',
    await customInstance(`/admin/knowledge/${id}/transition`, { method: 'POST', ...json(reason ? { to, reason } : { to }) })
  );
}

export const KgSummarySchema = z.object({
  objects: z.object({ total: z.number(), byReviewStatus: z.record(z.number()) }),
  releases: z.number(),
  conflicts: z.object({ facts: z.number(), objects: z.number() }),
  latestSnapshot: z.object({ id: z.string(), seq: z.number(), adapterId: z.string(), publishedAt: nullableString }).nullable(),
  sources: z.array(
    z.object({
      id: z.string(),
      sourceKey: z.string(),
      title: z.string(),
      trustLevel: z.string(),
      publisher: nullableString,
      url: nullableString,
      status: z.string(),
      lastRetrievedAt: nullableString,
      facts: z.number(),
    })
  ),
});
export type KgSummary = z.infer<typeof KgSummarySchema>;

export const KgObjectPageSchema = z.object({
  total: z.number(),
  limit: z.number(),
  offset: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      objectType: z.string(),
      sapObjectType: z.string(),
      objectKey: z.string(),
      displayName: nullableString,
      reviewStatus: z.string(),
      reviewedBy: nullableString,
      reviewedAt: nullableString,
      primarySource: z.object({ title: z.string(), trustLevel: z.string() }).nullable(),
      sources: z.number(),
      releaseValidity: z.object({ releases: z.number(), first: nullableString, last: nullableString }),
      lastVerifiedAt: nullableString,
      conflicts: z.number(),
      updatedAt: nullableString,
    })
  ),
});
export type KgObjectPage = z.infer<typeof KgObjectPageSchema>;

export const KgConflictSchema = z.object({
  objectId: z.string(),
  sapObjectType: z.string(),
  objectKey: z.string(),
  release: z.string(),
  scheme: z.string(),
  assertions: z.array(z.object({ source: z.string(), trustLevel: z.string(), supportState: z.string(), state: z.string() })),
});

export async function fetchKgSummary(): Promise<KgSummary> {
  return parse(KgSummarySchema, '/admin/knowledge-graph/summary', await customInstance('/admin/knowledge-graph/summary'));
}

export async function fetchKgObjects(p: { q: string; status: string; conflictsOnly: boolean; offset: number; limit: number }): Promise<KgObjectPage> {
  const qs = new URLSearchParams({ limit: String(p.limit), offset: String(p.offset) });
  if (p.q) qs.set('q', p.q);
  if (p.status) qs.set('status', p.status);
  if (p.conflictsOnly) qs.set('conflictsOnly', 'true');
  return parse(KgObjectPageSchema, '/admin/knowledge-graph/objects', await customInstance(`/admin/knowledge-graph/objects?${qs}`));
}

export async function fetchKgConflicts() {
  return parse(z.array(KgConflictSchema), '/admin/knowledge-graph/conflicts', await customInstance('/admin/knowledge-graph/conflicts'));
}

// -----------------------------------------------------------------------------
// Source Sync Admin (10.12)
// -----------------------------------------------------------------------------

const AlertSchema = z.object({
  id: z.string(),
  adapterId: z.string(),
  alertType: z.string(),
  status: z.enum(['OPEN', 'RESOLVED']),
  severity: z.string(),
  lastSuccessAt: nullableString,
  thresholdHours: z.number(),
  ageHours: z.number().nullable(),
  message: z.string(),
  notifiedUsers: z.number(),
  openedAt: nullableString,
  resolvedAt: nullableString,
  resolvedReason: nullableString,
});
export type SourceAlert = z.infer<typeof AlertSchema>;

export const SourceAdapterSchema = z.object({
  adapterId: z.string(),
  title: z.string(),
  documents: z.array(z.object({ sourceKey: z.string(), url: nullableString })),
  retriable: z.boolean(),
  settings: z.object({ critical: z.boolean(), freshnessThresholdHours: z.number(), alertsEnabled: z.boolean(), configured: z.boolean() }),
  lastRun: z
    .object({
      id: z.string(),
      status: z.string(),
      trigger: z.string(),
      triggeredBy: nullableString,
      error: nullableString,
      startedAt: nullableString,
      finishedAt: nullableString,
    })
    .nullable(),
  lastSuccessAt: nullableString,
  freshness: z.enum(['FRESH', 'STALE', 'NEVER_SYNCED']),
  ageHours: z.number().nullable(),
  errors: z.object({ failedLast30Days: z.number(), lastFailedAt: nullableString }),
  items: z.object({ documents: z.number(), records: z.number(), rejected: z.number() }),
  latestSnapshot: z
    .object({ id: z.string(), seq: z.number(), publishedAt: nullableString, stats: z.record(z.unknown()), changes: z.record(z.unknown()) })
    .nullable(),
  openAlert: AlertSchema.nullable(),
});
export type SourceAdapter = z.infer<typeof SourceAdapterSchema>;

export const SourcesOverviewSchema = z.object({
  checkedAt: z.string(),
  knowledgeObjects: z.object({ total: z.number(), published: z.number() }),
  adapters: z.array(SourceAdapterSchema),
  alerts: z.array(AlertSchema),
});
export type SourcesOverview = z.infer<typeof SourcesOverviewSchema>;

export const SyncRunSchema = z.object({
  id: z.string(),
  status: z.string(),
  trigger: z.string(),
  triggeredBy: nullableString,
  documents: z.number(),
  records: z.number(),
  changes: z.record(z.unknown()).nullable(),
  error: nullableString,
  startedAt: nullableString,
  finishedAt: nullableString,
});
export type SyncRun = z.infer<typeof SyncRunSchema>;

export const SourceSettingsFormSchema = z.object({
  critical: z.boolean(),
  freshnessThresholdHours: z.number().int().min(1).max(8760),
  alertsEnabled: z.boolean(),
});
export type SourceSettingsForm = z.infer<typeof SourceSettingsFormSchema>;

export const sourceKeys = {
  overview: ['admin', 'sources'] as const,
  runs: (adapterId: string) => ['admin', 'sources', adapterId, 'runs'] as const,
};

export async function fetchSourcesOverview(): Promise<SourcesOverview> {
  return parse(SourcesOverviewSchema, '/admin/sources', await customInstance('/admin/sources'));
}

export async function fetchSourceRuns(adapterId: string): Promise<SyncRun[]> {
  return parse(z.array(SyncRunSchema), '/admin/sources/:id/runs', await customInstance(`/admin/sources/${encodeURIComponent(adapterId)}/runs`));
}

export async function saveSourceSettings(adapterId: string, form: SourceSettingsForm) {
  return parse(
    SourceAdapterSchema,
    '/admin/sources/:id/settings',
    await customInstance(`/admin/sources/${encodeURIComponent(adapterId)}/settings`, {
      method: 'PUT',
      ...json(SourceSettingsFormSchema.parse(form)),
    })
  );
}

export async function retrySource(adapterId: string) {
  return customInstance<{ adapterId: string; jobId: string | null; queued: boolean }>(
    `/admin/sources/${encodeURIComponent(adapterId)}/retry`,
    { method: 'POST' }
  );
}

export async function runFreshnessCheck() {
  return customInstance<{ checkedAt: string; opened: unknown[]; resolved: unknown[] }>('/admin/sources/freshness-check', { method: 'POST' });
}
