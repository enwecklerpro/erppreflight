import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { LandscapesService } from './landscapes.service';
import { CreateLandscapeDto } from './dto/landscape.dto';

@ApiTags('Enterprise Landscape Registry')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EntitlementGuard)
@Controller('landscapes')
export class LandscapesController {
  constructor(private readonly landscapesService: LandscapesService) {}

  @Post()
  @RequireEntitlement('ADD_LANDSCAPE')
  @ApiOperation({ summary: 'Register a new SAP system in the Landscape Registry' })
  async create(@Req() req: any, @Body() dto: CreateLandscapeDto) {
    const orgId = req.user.organizationId;
    return await this.landscapesService.create(orgId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all landscape systems (DEV, QA, PROD) for current organization' })
  async findAll(@Req() req: any) {
    const orgId = req.user.organizationId;
    return await this.landscapesService.findAll(orgId);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a system from the Landscape Registry' })
  async remove(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return await this.landscapesService.remove(orgId, id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Perform connector capability handshake and production write safety verification' })
  async testConnection(@Req() req: any, @Param('id') id: string) {
    const orgId = req.user.organizationId;
    return await this.landscapesService.testConnection(orgId, id);
  }
}

