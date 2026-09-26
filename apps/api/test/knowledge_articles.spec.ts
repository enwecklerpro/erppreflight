import { describe, it, expect, vi } from 'vitest';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { KNOWLEDGE_SEED } from '../src/modules/knowledge/knowledge-seed';
import { KnowledgeArticlesService } from '../src/modules/knowledge/knowledge-articles.service';
import { PublicKnowledgeController } from '../src/modules/knowledge/public-knowledge.controller';
import {
  CreateKnowledgeArticleSchema,
  UpdateKnowledgeArticleSchema,
} from '../src/modules/knowledge/dto/knowledge-article.dto';

const SOLUTION_SLUGS = [
  'output-extensibility',
  'migration-clean-core',
  'integration',
  'release-transport',
  'operations',
  'warehouse-automation',
];
const CANONICAL_ENGINE_IDS = [
  'OPD_GUARD', 'FORM_DOCTOR', 'CUSTOM_FIELD_FLOW_DOCTOR', 'EXTENSION_IMPACT_GUARD', 'SPRO2CLOUD',
  'ECC2CLOUD_NAVIGATOR', 'SAP_GAP_RADAR', 'CLEAN_CORE_OBJECT_GUARD', 'CHANGE_POINTER_COVERAGE_AUDITOR',
  'API_CHANGE_GUARD', 'SOFTWARE_COLLECTION_DEPENDENCY_GUARD', 'TRANSPORT_DEPENDENCY_ANALYZER',
  'SAFE_DECOMMISSION_PREFLIGHT', 'FIORI_403_ROOT_CAUSE_DOCTOR', 'WORKFLOW_STUCK_EXPLAINER',
  'IAM_COST_OPTIMIZER', 'ACCOUNT_DETERMINATION_PREFLIGHT', 'SYSTEM_REFRESH_DELTA_GUARD', 'MFS_BLACKBOX',
];

/** Minimal pg pool double: records statements, answers via a handler. */
function makeDb(handler: (sql: string, params: any[]) => { rows: any[] }) {
  const statements: { sql: string; params: any[] }[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: any[] = []) => {
      statements.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)|SET LOCAL ROLE/.test(sql.trim())) return { rows: [] };
      return handler(sql, params);
    }),
    release: vi.fn(),
  };
  const db: any = {
    getPool: () => ({ connect: async () => client }),
    getRuntimeRole: () => 'erppreflight_app',
  };
  return { db, client, statements };
}

describe('knowledge seed content', () => {
  it('has 6–8 articles with unique slugs and complete EN + DE translations', () => {
    expect(KNOWLEDGE_SEED.length).toBeGreaterThanOrEqual(6);
    expect(KNOWLEDGE_SEED.length).toBeLessThanOrEqual(8);
    expect(new Set(KNOWLEDGE_SEED.map((a) => a.slug)).size).toBe(KNOWLEDGE_SEED.length);
    for (const a of KNOWLEDGE_SEED) {
      for (const locale of ['en', 'de'] as const) {
        const t = a.translations[locale];
        const parsed = CreateKnowledgeArticleSchema.safeParse({
          slug: a.slug,
          locale,
          title: t.title,
          summary: t.summary,
          bodyMarkdown: t.body,
          relatedEngineTypes: a.relatedEngineTypes,
          targetReleases: a.targetReleases,
          sources: a.sources,
          reviewedAt: a.reviewedAt,
          status: 'PUBLISHED',
        });
        expect(parsed.success, `${a.slug}/${locale}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
      }
    }
  });

  it('references only canonical engines and links a solution page in the right locale', () => {
    for (const a of KNOWLEDGE_SEED) {
      expect(a.relatedEngineTypes.length).toBeGreaterThan(0);
      for (const e of a.relatedEngineTypes) expect(CANONICAL_ENGINE_IDS).toContain(e);
      const en = a.translations.en.body.match(/\]\(\/en\/solutions\/([a-z-]+)\)/);
      const de = a.translations.de.body.match(/\]\(\/de\/solutions\/([a-z-]+)\)/);
      expect(en && SOLUTION_SLUGS.includes(en[1]), `${a.slug} EN solution link`).toBe(true);
      expect(de && SOLUTION_SLUGS.includes(de[1]), `${a.slug} DE solution link`).toBe(true);
      expect(en![1]).toBe(de![1]);
    }
  });

  it('contains no SAP note numbers, percentages or raw HTML', () => {
    for (const a of KNOWLEDGE_SEED) {
      for (const t of Object.values(a.translations)) {
        const text = `${t.title}\n${t.summary}\n${t.body}`;
        expect(text).not.toMatch(/\b(SAP )?(Note|Hinweis) \d{5,}/i);
        expect(text).not.toMatch(/\b\d{6,8}\b/);
        expect(text).not.toMatch(/\d+\s?%/);
        expect(text).not.toMatch(/<[a-z!/]/i);
      }
      for (const s of a.sources) expect(s.url.startsWith('https://')).toBe(true);
    }
  });
});

describe('KnowledgeArticlesService', () => {
  it('lists only PUBLISHED articles of the requested locale, as the runtime role', async () => {
    const { db, statements } = makeDb(() => ({
      rows: [
        {
          id: 'a', slug: 'x-y', locale: 'de', version: 2, status: 'PUBLISHED', title: 'T', summary: 'S',
          body_markdown: 'B', related_engine_types: ['OPD_GUARD'], target_releases: [], sources: [],
          reviewed_at: new Date('2026-09-26T00:00:00Z'), published_at: null, created_at: new Date(), updated_at: new Date(),
        },
      ],
    }));
    const svc = new KnowledgeArticlesService(db);
    const items = await svc.listPublished('de');
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ slug: 'x-y', locale: 'de', version: 2, reviewedAt: '2026-09-26T00:00:00.000Z' });
    const select = statements.find((s) => s.sql.includes('FROM knowledge_articles'))!;
    expect(select.sql).toContain("status = 'PUBLISHED'");
    expect(select.params).toEqual(['de']);
    expect(statements.some((s) => s.sql.includes('SET LOCAL ROLE "erppreflight_app"'))).toBe(true);
  });

  it('returns hreflang alternates and 404s for a locale without a published translation', async () => {
    const row = (locale: string) => ({
      id: locale, slug: 'a-b', locale, version: 1, status: 'PUBLISHED', title: 't', summary: 's',
      body_markdown: 'b', related_engine_types: [], target_releases: [], sources: [{ title: 'x', url: 'https://x' }],
      reviewed_at: null, published_at: null, created_at: new Date(), updated_at: new Date(),
    });
    const { db } = makeDb(() => ({ rows: [row('en'), row('de')] }));
    const svc = new KnowledgeArticlesService(db);
    const article = await svc.getPublished('a-b', 'de');
    expect(article.availableLocales).toEqual(['de', 'en']);
    expect(article.sources).toHaveLength(1);

    const { db: db2 } = makeDb(() => ({ rows: [row('en')] }));
    await expect(new KnowledgeArticlesService(db2).getPublished('a-b', 'de')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('seeds idempotently with ON CONFLICT DO NOTHING and writes a revision only for inserted rows', async () => {
    let n = 0;
    const { db, statements } = makeDb((sql) => {
      if (sql.includes('INSERT INTO knowledge_articles')) {
        n++;
        return { rows: n === 1 ? [{ id: 'new', version: 1, status: 'PUBLISHED', title: 't', summary: 's', body_markdown: 'b', sources: [] }] : [] };
      }
      return { rows: [] };
    });
    const inserted = await new KnowledgeArticlesService(db).seed(KNOWLEDGE_SEED.slice(0, 1));
    expect(inserted).toBe(1);
    expect(statements.filter((s) => s.sql.includes('ON CONFLICT (slug, locale) DO NOTHING'))).toHaveLength(2);
    expect(statements.filter((s) => s.sql.includes('INSERT INTO knowledge_article_revisions'))).toHaveLength(1);
  });

  it('update bumps the version and appends an immutable revision', async () => {
    const current = {
      id: 'id1', slug: 'a-b', locale: 'en', version: 3, status: 'DRAFT', title: 'Old title', summary: 's',
      body_markdown: 'b', related_engine_types: [], target_releases: [], sources: [], reviewed_at: null,
      published_at: null, created_at: new Date(), updated_at: new Date(),
    };
    const { db, statements } = makeDb((sql) => {
      if (sql.includes('FOR UPDATE')) return { rows: [current] };
      if (sql.includes('UPDATE knowledge_articles')) return { rows: [{ ...current, version: 4, status: 'PUBLISHED', title: 'New title' }] };
      return { rows: [] };
    });
    const res = await new KnowledgeArticlesService(db).update('id1', { title: 'New title', status: 'PUBLISHED' } as any, 'user-1');
    expect(res.version).toBe(4);
    expect(res.status).toBe('PUBLISHED');
    const rev = statements.find((s) => s.sql.includes('INSERT INTO knowledge_article_revisions'))!;
    expect(rev.params[1]).toBe(4);
    expect(rev.params[10]).toBe('user-1');
  });
});

describe('DTO validation & public controller', () => {
  it('rejects unsafe or invalid payloads', () => {
    expect(CreateKnowledgeArticleSchema.safeParse({ slug: 'Bad Slug', locale: 'en' }).success).toBe(false);
    const base = {
      slug: 'ok-slug', locale: 'fr', title: 'Title ok', summary: 'A summary that is long enough.',
      bodyMarkdown: 'x'.repeat(60),
    };
    expect(CreateKnowledgeArticleSchema.safeParse(base).success).toBe(false);
    expect(CreateKnowledgeArticleSchema.safeParse({ ...base, locale: 'en' }).success).toBe(true);
    expect(
      CreateKnowledgeArticleSchema.safeParse({ ...base, locale: 'en', sources: [{ title: 'bad', url: 'javascript:alert(1)' }] }).success
    ).toBe(false);
    expect(CreateKnowledgeArticleSchema.safeParse({ ...base, locale: 'en', organizationId: 'x' }).success).toBe(false);
    expect(UpdateKnowledgeArticleSchema.safeParse({}).success).toBe(false);
    expect(UpdateKnowledgeArticleSchema.safeParse({ status: 'PUBLISHED' }).success).toBe(true);
  });

  it('validates locale and slug before touching the service', async () => {
    const svc: any = { listPublished: vi.fn(async () => []), getPublished: vi.fn() };
    const ctrl = new PublicKnowledgeController(svc);
    await expect(ctrl.list('fr')).rejects.toBeInstanceOf(BadRequestException);
    await expect(ctrl.get('../etc', 'en')).rejects.toBeInstanceOf(BadRequestException);
    expect(await ctrl.list(undefined)).toEqual({ locale: 'en', items: [] });
    expect(svc.getPublished).not.toHaveBeenCalled();
  });
});
