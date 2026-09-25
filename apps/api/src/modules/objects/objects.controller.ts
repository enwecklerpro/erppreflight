import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ObjectsService } from './objects.service';
import { QueryObjectsDto, CreateSapObjectDto } from './dto/object.dto';

@ApiTags('SAP Objects & Clean Core Catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/objects')
export class ObjectsController {
  constructor(private readonly objectsService: ObjectsService) {}

  @ApiOperation({ summary: 'List and filter SAP technical objects for a project workspace' })
  @Get()
  async findAll(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query() query: QueryObjectsDto
  ) {
    const orgId = req.user.organizationId;
    return await this.objectsService.findAll(orgId, projectId, query);
  }

  @ApiOperation({ summary: 'Get details, dependencies, and findings for a specific SAP object' })
  @Get(':id')
  async findOne(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('id') id: string
  ) {
    const orgId = req.user.organizationId;
    return await this.objectsService.findOne(orgId, projectId, id);
  }

  @ApiOperation({ summary: 'Register a new SAP custom object into the catalog' })
  @Post()
  async create(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Body() dto: CreateSapObjectDto
  ) {
    const orgId = req.user.organizationId;
    return await this.objectsService.create(orgId, projectId, dto);
  }
}
