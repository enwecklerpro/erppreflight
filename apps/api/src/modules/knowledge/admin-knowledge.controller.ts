import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { KnowledgeArticlesService } from './knowledge-articles.service';
import {
  CreateKnowledgeArticleSchema,
  KNOWLEDGE_TRANSITIONS,
  KnowledgeLocaleSchema,
  KnowledgeTransitionSchema,
  UpdateKnowledgeArticleSchema,
} from './dto/knowledge-article.dto';

function zodMessage(error: { issues: { path: (string | number)[]; message: string }[] }): string {
  return error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
}

/** SUPER_ADMIN content management for the public knowledge base (Part 02 §2.13). */
@ApiTags('Admin Knowledge Base')
@Controller('admin/knowledge')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class AdminKnowledgeController {
  constructor(private readonly articles: KnowledgeArticlesService) {}

  @Get()
  @ApiOperation({ summary: 'List all knowledge articles (all statuses)' })
  async list(@Query('locale') locale?: string) {
    if (locale !== undefined) {
      const parsed = KnowledgeLocaleSchema.safeParse(locale);
      if (!parsed.success) throw new BadRequestException('locale must be one of: en, de');
      return this.articles.adminList(parsed.data);
    }
    return this.articles.adminList();
  }

  @Get('workflow')
  @ApiOperation({ summary: 'Content workflow: statuses and allowed transitions (Part 02 §2.13)' })
  workflow() {
    return { transitions: KNOWLEDGE_TRANSITIONS, publicStatuses: ['PUBLISHED', 'UPDATE_REQUIRED'] };
  }

  @Get(':id')
  async get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.articles.adminGet(id);
  }

  @Get(':id/revisions')
  @ApiOperation({ summary: 'Immutable revision history of an article' })
  async revisions(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.articles.revisions(id);
  }

  @Post()
  @Audited({
    action: 'knowledge_article.created',
    targetType: 'KNOWLEDGE_ARTICLE',
    targetId: ({ result }) => result?.id,
    payload: ({ result }) => ({ slug: result?.slug ?? null, locale: result?.locale ?? null, status: result?.status ?? null }),
  })
  async create(@Body() body: unknown, @CurrentUser('id') userId?: string) {
    const parsed = CreateKnowledgeArticleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(zodMessage(parsed.error));
    return this.articles.create(parsed.data, userId ?? null);
  }

  @Patch(':id')
  @Audited({
    action: 'knowledge_article.updated',
    targetType: 'KNOWLEDGE_ARTICLE',
    targetId: ({ params }) => params.id,
    payload: ({ body }) => ({ fields: Object.keys(body ?? {}).sort() }),
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser('id') userId?: string
  ) {
    const parsed = UpdateKnowledgeArticleSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(zodMessage(parsed.error));
    return this.articles.update(id, parsed.data, userId ?? null);
  }

  @Post(':id/transition')
  @HttpCode(200)
  @ApiOperation({ summary: 'Move an article through draft → technical review → SEO review → published → update required → deprecated' })
  @Audited({
    action: ({ body }) => `knowledge_article.${String(body?.to ?? 'transition').toLowerCase()}`,
    targetType: 'KNOWLEDGE_ARTICLE',
    targetId: ({ params }) => params.id,
    payload: ({ body, result }) => ({ to: body?.to ?? null, slug: result?.slug ?? null, locale: result?.locale ?? null }),
  })
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
    @CurrentUser('id') userId?: string
  ) {
    const parsed = KnowledgeTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(zodMessage(parsed.error));
    return this.articles.transition(id, parsed.data, userId ?? null);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Archive an article (soft delete; history is kept)' })
  @Audited({ action: 'knowledge_article.archived', targetType: 'KNOWLEDGE_ARTICLE', targetId: ({ params }) => params.id })
  async archive(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser('id') userId?: string) {
    return this.articles.archive(id, userId ?? null);
  }
}
