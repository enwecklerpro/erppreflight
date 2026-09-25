import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, UpdateFeedbackStatusDto } from './dto/feedback.dto';

@Controller('feedback')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  async listFeedback(@CurrentTenant() tenantId: string, @CurrentUser('id') userId: string) {
    return this.feedbackService.listFeedback(tenantId, userId);
  }

  @Post()
  async createFeedback(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateFeedbackDto
  ) {
    return this.feedbackService.createFeedback(tenantId, userId, dto);
  }

  @Post(':id/vote')
  async voteFeedback(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id', new ParseUUIDPipe()) id: string
  ) {
    return this.feedbackService.toggleVote(tenantId, id, userId);
  }

  @Patch(':id/status')
  @UseGuards(SuperAdminGuard)
  async updateStatus(
    @CurrentTenant() tenantId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateFeedbackStatusDto
  ) {
    return this.feedbackService.updateStatus(tenantId, id, dto);
  }
}
