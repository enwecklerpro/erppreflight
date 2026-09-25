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
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { ChangeSetsService } from './changesets.service';
import { CreateChangeSetDto, ApproveChangeSetDto } from './dto/changeset.dto';

@ApiTags('ChangeSets & What-If Simulation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
@Controller('projects/:projectId/changesets')
export class ChangeSetsController {
  constructor(private readonly changeSetsService: ChangeSetsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new ChangeSet proposed change' })
  async create(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateChangeSetDto
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.changeSetsService.create(orgId, projectId, userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all ChangeSets for a project workspace' })
  async findAll(@Req() req: any, @Param('projectId') projectId: string) {
    const orgId = req.user.organizationId;
    return await this.changeSetsService.findAll(orgId, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific ChangeSet' })
  async findOne(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') id: string
  ) {
    const orgId = req.user.organizationId;
    return await this.changeSetsService.findOne(orgId, projectId, id);
  }

  @Post(':id/simulate')
  @ApiOperation({ summary: 'Run deterministic What-If blast radius simulation against project baseline' })
  async simulate(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') id: string
  ) {
    const orgId = req.user.organizationId;
    return await this.changeSetsService.simulate(orgId, projectId, id);
  }

  @Post(':id/approve')
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @ApiOperation({ summary: 'Approve a ChangeSet and generate cryptographic Change Evidence Pack' })
  async approve(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() dto: ApproveChangeSetDto
  ) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.changeSetsService.approve(orgId, projectId, id, userId, dto);
  }
}
