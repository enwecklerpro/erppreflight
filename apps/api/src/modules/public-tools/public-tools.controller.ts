import { Body, Controller, Get, Header, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthRateLimit, AuthRateLimitGuard, RateLimitRule } from '../auth/guards/auth-rate-limit.guard';
import { zodParse } from '../knowledge-graph/zod-parse';
import { PublicToolsService } from './public-tools.service';
import {
  ApiLifecycleQuerySchema,
  PublicReleaseDiffQuerySchema,
  PublicSearchQuerySchema,
  SeoSlugSchema,
  SitemapPageQuerySchema,
  SuccessorLookupQuerySchema,
  XmlFieldCheckSchema,
} from './public-tools.types';

/** Interactive tool calls from browsers (per client IP, like the public Clean Core lookup). */
export const PUBLIC_TOOLS_RATE_LIMIT: RateLimitRule = {
  name: 'public-tools',
  windowMs: 60 * 1000,
  maxPerIp: 30,
  maxPerIpAndEmail: 0,
};

/** The XML checker parses documents: stricter budget. */
export const PUBLIC_XML_CHECK_RATE_LIMIT: RateLimitRule = {
  name: 'public-tools-xml',
  windowMs: 60 * 1000,
  maxPerIp: 10,
  maxPerIpAndEmail: 0,
};

/**
 * Server-rendered page data (programmatic SEO pages, sitemaps, docs). Called by
 * the web server (one IP) and cached there for an hour, so the budget is larger.
 */
export const PUBLIC_PAGE_DATA_RATE_LIMIT: RateLimitRule = {
  name: 'public-page-data',
  windowMs: 60 * 1000,
  maxPerIp: 600,
  maxPerIpAndEmail: 0,
};

/**
 * Public free tools (Part 01 §1.11) and programmatic SEO page data (Part 02 §2.8/§2.9).
 * Unauthenticated, read-only (the XML checker stores nothing), GLOBAL + PUBLISHED
 * knowledge only (Part 04 §4.14), rate limited per client IP.
 */
@ApiTags('Public free tools')
@UseGuards(AuthRateLimitGuard)
@AuthRateLimit(PUBLIC_TOOLS_RATE_LIMIT)
@Controller('public/tools')
export class PublicToolsController {
  constructor(private readonly tools: PublicToolsService) {}

  @Get('meta')
  @AuthRateLimit(PUBLIC_PAGE_DATA_RATE_LIMIT)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Data source, snapshot, last retrieval date and trust level behind every free tool' })
  meta() {
    return this.tools.meta();
  }

  @Get('successors')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Legacy object / transaction → cloud successor and release state per release' })
  successors(@Query() query: Record<string, unknown>) {
    return this.tools.successorLookup(zodParse(SuccessorLookupQuerySchema, query));
  }

  @Get('api-lifecycle')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'API deprecation lookup: released/deprecated per release, successors; browse deprecated APIs' })
  apiLifecycle(@Query() query: Record<string, unknown>) {
    return this.tools.apiLifecycle(zodParse(ApiLifecycleQuerySchema, query));
  }

  @Get('releases')
  @AuthRateLimit(PUBLIC_PAGE_DATA_RATE_LIMIT)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Releases with published release-state facts (for the release diff)' })
  releases() {
    return this.tools.releaseCatalog();
  }

  @Get('release-diff')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Release diff between two releases (global published knowledge)' })
  releaseDiff(@Query() query: Record<string, unknown>) {
    return this.tools.releaseDiff(zodParse(PublicReleaseDiffQuerySchema, query));
  }

  @Get('search')
  @Header('Cache-Control', 'public, max-age=120')
  @ApiOperation({ summary: 'Public knowledge / error search: articles, SAP objects, engine finding codes' })
  search(@Query() query: Record<string, unknown>) {
    return this.tools.search(zodParse(PublicSearchQuerySchema, query));
  }

  @Post('xml-field-check')
  @HttpCode(200)
  @AuthRateLimit(PUBLIC_XML_CHECK_RATE_LIMIT)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Basic form/XML field checker (defused parse in memory, nothing stored)' })
  xmlFieldCheck(@Body() body: unknown) {
    return this.tools.xmlFieldCheck(zodParse(XmlFieldCheckSchema, body));
  }

  @Get('engines')
  @AuthRateLimit(PUBLIC_PAGE_DATA_RATE_LIMIT)
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({ summary: 'Engine catalog for the documentation: input contracts, rules, remediation' })
  engines() {
    return this.tools.engineCatalog();
  }

  @Get('seo/objects/:slug')
  @AuthRateLimit(PUBLIC_PAGE_DATA_RATE_LIMIT)
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'Programmatic SEO object page data with the quality-gate assessment' })
  seoObject(@Param('slug') slug: string) {
    return this.tools.seoObject(zodParse(SeoSlugSchema, slug));
  }

  @Get('seo/sitemap/objects')
  @AuthRateLimit(PUBLIC_PAGE_DATA_RATE_LIMIT)
  @Header('Cache-Control', 'public, max-age=900')
  @ApiOperation({ summary: 'Objects passing the SEO quality gate (paginated, ≤10 000 per page)' })
  sitemap(@Query() query: Record<string, unknown>) {
    return this.tools.seoSitemap(zodParse(SitemapPageQuerySchema, query).page);
  }
}
