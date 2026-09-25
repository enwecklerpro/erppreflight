import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TraceabilityService } from './traceability.service';
import { CreateRemediationTaskDto } from './dto/traceability.dto';

@ApiTags('Delivery Traceability & ALM Integration')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/traceability')
export class TraceabilityController {
  constructor(private readonly traceabilityService: TraceabilityService) {}

  @Get()
  @ApiOperation({ summary: 'Get 8-Column Traceability Matrix with Gap & Risk Analysis' })
  async getMatrix(@Req() req: any, @Param('projectId') projectId: string) {
    const orgId = req.user.organizationId;
    return await this.traceabilityService.getMatrix(orgId, projectId);
  }

  @Post('sync')
  @ApiOperation({ summary: 'Synchronize traceability nodes with current project findings' })
  async sync(@Req() req: any, @Param('projectId') projectId: string) {
    const orgId = req.user.organizationId;
    return await this.traceabilityService.syncFromFindings(orgId, projectId);
  }

  @Post('tasks')
  @ApiOperation({ summary: 'Create or synchronize a remediation task into SAP Cloud ALM / Jira' })
  async createTask(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateRemediationTaskDto
  ) {
    const orgId = req.user.organizationId;
    return await this.traceabilityService.createRemediationTask(orgId, projectId, dto);
  }
}
