import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { zodParse } from '../knowledge-graph/zod-parse';
import { ReleaseIntelligenceService } from './release-intelligence.service';
import {
  CreateWatchSchema,
  ReleaseDiffQuerySchema,
  SnapshotDiffQuerySchema,
  UpdateWatchSchema,
  WatchListQuerySchema,
} from './release-intelligence.types';

@ApiTags('Release Intelligence')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenancyGuard)
@Controller('release-intelligence')
export class ReleaseIntelligenceController {
  constructor(private readonly service: ReleaseIntelligenceService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Release catalog: products, editions, releases with support-state counts and sources' })
  catalog() {
    return this.service.catalog();
  }

  @Get('diff/snapshots')
  @ApiOperation({ summary: 'What changed between two knowledge snapshots (added, deprecated, successor changed, ...)' })
  snapshotDiff(@Query() query: Record<string, unknown>) {
    return this.service.snapshotChanges(zodParse(SnapshotDiffQuerySchema, query));
  }

  @Get('diff/releases')
  @ApiOperation({ summary: 'Compare the released-object lists of two releases (e.g. 2023 FPS03 vs 2025 FPS01)' })
  releaseDiff(@Query() query: Record<string, unknown>) {
    return this.service.releaseDiff(zodParse(ReleaseDiffQuerySchema, query));
  }

  @Get('watches')
  @ApiOperation({ summary: 'Release watches of the current organization' })
  listWatches(@CurrentTenant() orgId: string, @Query() query: Record<string, unknown>) {
    return this.service.listWatches(orgId, zodParse(WatchListQuerySchema, query).limit);
  }

  @Post('watches')
  @ApiOperation({ summary: 'Watch an object, API, gap, successor mapping or finding for release changes' })
  createWatch(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.service.createWatch(orgId, req.user.id, zodParse(CreateWatchSchema, body));
  }

  @Get('watches/:id')
  getWatch(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.getWatch(orgId, id);
  }

  @Patch('watches/:id')
  @ApiOperation({ summary: 'Pause/resume or rename a watch' })
  updateWatch(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown) {
    return this.service.updateWatch(orgId, id, zodParse(UpdateWatchSchema, body));
  }

  @Delete('watches/:id')
  deleteWatch(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.deleteWatch(orgId, id);
  }

  @Get('watches/:id/events')
  @ApiOperation({ summary: 'Change events detected for a watch (gap closed, new deprecation, successor changed, ...)' })
  watchEvents(@CurrentTenant() orgId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.service.watchEvents(orgId, id);
  }
}
