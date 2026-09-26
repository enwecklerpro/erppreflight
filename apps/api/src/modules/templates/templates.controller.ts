import { Controller, Get, Post, Body, Param, UseGuards, Req, Query, Headers } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/template.dto';
import { resolveRequestLocale } from '../../common/i18n/request-locale';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  /** System templates are returned in the requested language (`?locale=` or Accept-Language). */
  @Get()
  async listTemplates(@Req() req: any, @Query('locale') locale?: string, @Headers('accept-language') acceptLanguage?: string) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    return this.templatesService.listTemplates(orgId, resolveRequestLocale(locale, acceptLanguage));
  }

  @Get(':id')
  async getTemplate(
    @Req() req: any,
    @Param('id') id: string,
    @Query('locale') locale?: string,
    @Headers('accept-language') acceptLanguage?: string
  ) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    return this.templatesService.getTemplateById(id, orgId, resolveRequestLocale(locale, acceptLanguage));
  }

  @Post()
  async createTemplate(@Req() req: any, @Body() dto: CreateTemplateDto) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    return this.templatesService.createCustomTemplate(orgId, dto);
  }
}
