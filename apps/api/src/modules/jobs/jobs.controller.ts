import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { JobsService, TriggerAnalysisDto } from './jobs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@Controller('jobs')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post('analyze')
  async triggerAnalysis(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: TriggerAnalysisDto
  ) {
    return this.jobsService.triggerAnalysis(tenantId, userId, dto);
  }

  @Get(':id')
  async getAnalysis(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string
  ) {
    return this.jobsService.getAnalysis(tenantId, id);
  }
}
