import { BadRequestException, Controller, Get, Header, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { KnowledgeArticlesService } from './knowledge-articles.service';
import { KnowledgeLocaleSchema, KnowledgeSlugSchema } from './dto/knowledge-article.dto';

function parseLocale(raw: unknown) {
  const parsed = KnowledgeLocaleSchema.safeParse(raw ?? 'en');
  if (!parsed.success) throw new BadRequestException('locale must be one of: en, de');
  return parsed.data;
}

/**
 * Unauthenticated, read-only knowledge base for the public website (SEO pages).
 * Only PUBLISHED articles are ever returned.
 */
@ApiTags('Public Knowledge Base')
@Controller('public/knowledge')
export class PublicKnowledgeController {
  constructor(private readonly articles: KnowledgeArticlesService) {}

  @Get()
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'List published knowledge articles for a locale' })
  async list(@Query('locale') locale?: string) {
    const loc = parseLocale(locale);
    const items = await this.articles.listPublished(loc);
    return { locale: loc, items };
  }

  @Get(':slug')
  @Header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  @ApiOperation({ summary: 'Get one published knowledge article by slug and locale' })
  async get(@Param('slug') slug: string, @Query('locale') locale?: string) {
    const parsedSlug = KnowledgeSlugSchema.safeParse(slug);
    if (!parsedSlug.success) throw new BadRequestException('Invalid article slug');
    return this.articles.getPublished(parsedSlug.data, parseLocale(locale));
  }
}
