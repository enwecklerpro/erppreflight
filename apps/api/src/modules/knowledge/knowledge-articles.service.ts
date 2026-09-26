import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { KNOWLEDGE_SEED, KnowledgeSeedArticle } from './knowledge-seed';
import type {
  CreateKnowledgeArticleDto,
  KnowledgeArticleStatus,
  UpdateKnowledgeArticleDto,
} from './dto/knowledge-article.dto';

export type KnowledgeLocale = 'en' | 'de';

export interface KnowledgeSource {
  title: string;
  url: string;
}

export interface KnowledgeArticleSummary {
  slug: string;
  locale: KnowledgeLocale;
  title: string;
  summary: string;
  relatedEngineTypes: string[];
  targetReleases: string[];
  reviewedAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
  version: number;
}

export interface PublicKnowledgeArticle extends KnowledgeArticleSummary {
  bodyMarkdown: string;
  sources: KnowledgeSource[];
  /** Locales in which the same slug is PUBLISHED (drives hreflang alternates). */
  availableLocales: KnowledgeLocale[];
}

export interface AdminKnowledgeArticle extends PublicKnowledgeArticle {
  id: string;
  status: KnowledgeArticleStatus;
  createdAt: string;
}

export interface KnowledgeRevision {
  version: number;
  status: string;
  title: string;
  summary: string;
  changedBy: string | null;
  changeNote: string | null;
  createdAt: string;
}

const ARTICLE_COLUMNS = `id, slug, locale, version, status, title, summary, body_markdown,
  related_engine_types, target_releases, sources, reviewed_at, published_at, created_at, updated_at`;

function iso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapSummary(row: any): KnowledgeArticleSummary {
  return {
    slug: row.slug,
    locale: row.locale,
    title: row.title,
    summary: row.summary,
    relatedEngineTypes: row.related_engine_types ?? [],
    targetReleases: row.target_releases ?? [],
    reviewedAt: iso(row.reviewed_at),
    publishedAt: iso(row.published_at),
    updatedAt: iso(row.updated_at) ?? new Date(0).toISOString(),
    version: Number(row.version),
  };
}

function mapFull(row: any, availableLocales: KnowledgeLocale[]): PublicKnowledgeArticle {
  return {
    ...mapSummary(row),
    bodyMarkdown: row.body_markdown,
    sources: Array.isArray(row.sources) ? row.sources : [],
    availableLocales,
  };
}

/**
 * Public knowledge base (Part 02 §2.8/§2.13). Articles are platform content, not
 * tenant data: reads never carry a tenant context. All statements run inside a
 * transaction as the non-privileged runtime role (migration 010) when configured,
 * so the grants of migration 013 are exercised on every call.
 */
@Injectable()
export class KnowledgeArticlesService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KnowledgeArticlesService.name);

  constructor(private readonly db: DatabaseService) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.KNOWLEDGE_SEED === 'false') return;
    try {
      const inserted = await this.seed(KNOWLEDGE_SEED);
      if (inserted > 0) this.logger.log(`Seeded ${inserted} knowledge article translation(s)`);
    } catch (err: any) {
      // Missing table (migrations disabled) or DB unavailable must not stop the API.
      this.logger.warn(`Knowledge article seeding skipped: ${err?.message ?? err}`);
    }
  }

  private async tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.db.getPool().connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const role = this.db.getRuntimeRole();
      if (role) await client.query(`SET LOCAL ROLE "${role}"`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw err;
    } finally {
      client.release(broken);
    }
  }

  /** Idempotent: existing (slug, locale) rows are never touched. Returns rows inserted. */
  async seed(articles: KnowledgeSeedArticle[]): Promise<number> {
    return this.tx(async (client) => {
      let inserted = 0;
      for (const article of articles) {
        for (const locale of ['en', 'de'] as const) {
          const t = article.translations[locale];
          const res = await client.query(
            `INSERT INTO knowledge_articles
               (slug, locale, version, status, title, summary, body_markdown,
                related_engine_types, target_releases, sources, reviewed_at, published_at)
             VALUES ($1, $2, 1, 'PUBLISHED', $3, $4, $5, $6, $7, $8::jsonb, $9, $9)
             ON CONFLICT (slug, locale) DO NOTHING
             RETURNING ${ARTICLE_COLUMNS}`,
            [
              article.slug,
              locale,
              t.title,
              t.summary,
              t.body,
              article.relatedEngineTypes,
              article.targetReleases,
              JSON.stringify(article.sources),
              article.reviewedAt,
            ]
          );
          if (res.rows[0]) {
            inserted++;
            await this.appendRevision(client, res.rows[0], null, 'Initial seed content');
          }
        }
      }
      return inserted;
    });
  }

  private async appendRevision(
    client: PoolClient,
    row: any,
    userId: string | null,
    changeNote: string | null
  ): Promise<void> {
    await client.query(
      `INSERT INTO knowledge_article_revisions
         (article_id, version, status, title, summary, body_markdown, related_engine_types,
          target_releases, sources, reviewed_at, changed_by, change_note)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12)`,
      [
        row.id,
        row.version,
        row.status,
        row.title,
        row.summary,
        row.body_markdown,
        row.related_engine_types ?? [],
        row.target_releases ?? [],
        JSON.stringify(row.sources ?? []),
        row.reviewed_at,
        userId,
        changeNote,
      ]
    );
  }

  // ---------------------------------------------------------------- public reads

  async listPublished(locale: KnowledgeLocale): Promise<KnowledgeArticleSummary[]> {
    return this.tx(async (client) => {
      const res = await client.query(
        `SELECT ${ARTICLE_COLUMNS} FROM knowledge_articles
         WHERE locale = $1 AND status = 'PUBLISHED'
         ORDER BY title ASC`,
        [locale]
      );
      return res.rows.map(mapSummary);
    });
  }

  async getPublished(slug: string, locale: KnowledgeLocale): Promise<PublicKnowledgeArticle> {
    return this.tx(async (client) => {
      const res = await client.query(
        `SELECT ${ARTICLE_COLUMNS} FROM knowledge_articles
         WHERE slug = $1 AND status = 'PUBLISHED'`,
        [slug]
      );
      const row = res.rows.find((r: any) => r.locale === locale);
      if (!row) {
        throw new NotFoundException(`No published knowledge article '${slug}' for locale '${locale}'`);
      }
      const available = res.rows.map((r: any) => r.locale as KnowledgeLocale).sort();
      return mapFull(row, available);
    });
  }

  // ---------------------------------------------------------------- admin CRUD

  private toAdmin(row: any, available: KnowledgeLocale[] = []): AdminKnowledgeArticle {
    return {
      ...mapFull(row, available),
      id: row.id,
      status: row.status,
      createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    };
  }

  async adminList(locale?: KnowledgeLocale): Promise<AdminKnowledgeArticle[]> {
    return this.tx(async (client) => {
      const res = await client.query(
        `SELECT ${ARTICLE_COLUMNS} FROM knowledge_articles
         ${locale ? 'WHERE locale = $1' : ''}
         ORDER BY slug ASC, locale ASC`,
        locale ? [locale] : []
      );
      return res.rows.map((r: any) => this.toAdmin(r));
    });
  }

  async adminGet(id: string): Promise<AdminKnowledgeArticle> {
    return this.tx(async (client) => {
      const res = await client.query(`SELECT ${ARTICLE_COLUMNS} FROM knowledge_articles WHERE id = $1`, [id]);
      if (!res.rows[0]) throw new NotFoundException('Knowledge article not found');
      return this.toAdmin(res.rows[0]);
    });
  }

  async create(dto: CreateKnowledgeArticleDto, userId: string | null): Promise<AdminKnowledgeArticle> {
    return this.tx(async (client) => {
      const exists = await client.query(
        'SELECT 1 FROM knowledge_articles WHERE slug = $1 AND locale = $2',
        [dto.slug, dto.locale]
      );
      if (exists.rows.length > 0) {
        throw new ConflictException(`Article '${dto.slug}' already exists for locale '${dto.locale}'`);
      }
      const res = await client.query(
        `INSERT INTO knowledge_articles
           (slug, locale, version, status, title, summary, body_markdown, related_engine_types,
            target_releases, sources, reviewed_at, published_at, created_by, updated_by)
         VALUES ($1, $2, 1, $3::varchar, $4, $5, $6, $7, $8, $9::jsonb, $10,
                 CASE WHEN $3::varchar = 'PUBLISHED' THEN NOW() ELSE NULL END, $11, $11)
         RETURNING ${ARTICLE_COLUMNS}`,
        [
          dto.slug,
          dto.locale,
          dto.status,
          dto.title,
          dto.summary,
          dto.bodyMarkdown,
          dto.relatedEngineTypes,
          dto.targetReleases,
          JSON.stringify(dto.sources),
          dto.reviewedAt ?? null,
          userId,
        ]
      );
      await this.appendRevision(client, res.rows[0], userId, dto.changeNote ?? 'Created');
      return this.toAdmin(res.rows[0]);
    });
  }

  async update(
    id: string,
    dto: UpdateKnowledgeArticleDto,
    userId: string | null
  ): Promise<AdminKnowledgeArticle> {
    return this.tx(async (client) => {
      const current = await client.query(
        `SELECT ${ARTICLE_COLUMNS} FROM knowledge_articles WHERE id = $1 FOR UPDATE`,
        [id]
      );
      const row = current.rows[0];
      if (!row) throw new NotFoundException('Knowledge article not found');

      const next = {
        status: dto.status ?? row.status,
        title: dto.title ?? row.title,
        summary: dto.summary ?? row.summary,
        body: dto.bodyMarkdown ?? row.body_markdown,
        engines: dto.relatedEngineTypes ?? row.related_engine_types,
        releases: dto.targetReleases ?? row.target_releases,
        sources: dto.sources ?? row.sources,
        reviewedAt: dto.reviewedAt !== undefined ? dto.reviewedAt : row.reviewed_at,
      };

      const res = await client.query(
        `UPDATE knowledge_articles SET
           version = version + 1,
           status = $2::varchar, title = $3, summary = $4, body_markdown = $5,
           related_engine_types = $6, target_releases = $7, sources = $8::jsonb, reviewed_at = $9,
           published_at = CASE WHEN $2::varchar = 'PUBLISHED' AND published_at IS NULL THEN NOW() ELSE published_at END,
           updated_by = $10, updated_at = NOW()
         WHERE id = $1
         RETURNING ${ARTICLE_COLUMNS}`,
        [
          id,
          next.status,
          next.title,
          next.summary,
          next.body,
          next.engines,
          next.releases,
          JSON.stringify(next.sources ?? []),
          next.reviewedAt,
          userId,
        ]
      );
      await this.appendRevision(client, res.rows[0], userId, dto.changeNote ?? null);
      return this.toAdmin(res.rows[0]);
    });
  }

  /** Soft delete: ARCHIVED rows are hidden publicly and never re-seeded. */
  async archive(id: string, userId: string | null): Promise<AdminKnowledgeArticle> {
    return this.update(id, { status: 'ARCHIVED', changeNote: 'Archived' } as UpdateKnowledgeArticleDto, userId);
  }

  async revisions(id: string): Promise<KnowledgeRevision[]> {
    return this.tx(async (client) => {
      const exists = await client.query('SELECT 1 FROM knowledge_articles WHERE id = $1', [id]);
      if (!exists.rows[0]) throw new NotFoundException('Knowledge article not found');
      const res = await client.query(
        `SELECT version, status, title, summary, changed_by, change_note, created_at
         FROM knowledge_article_revisions WHERE article_id = $1 ORDER BY version DESC`,
        [id]
      );
      return res.rows.map((r: any) => ({
        version: Number(r.version),
        status: r.status,
        title: r.title,
        summary: r.summary,
        changedBy: r.changed_by,
        changeNote: r.change_note,
        createdAt: iso(r.created_at) ?? '',
      }));
    });
  }
}
