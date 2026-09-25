import { Controller, Get, Post, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/template.dto';

@Controller('templates')
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  async listTemplates(@Req() req: any) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    return this.templatesService.listTemplates(orgId);
  }

  @Get(':id')
  async getTemplate(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    return this.templatesService.getTemplateById(id, orgId);
  }

  @Post()
  async createTemplate(@Req() req: any, @Body() dto: CreateTemplateDto) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    return this.templatesService.createCustomTemplate(orgId, dto);
  }
}
