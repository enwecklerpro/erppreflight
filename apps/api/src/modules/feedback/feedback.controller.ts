import { Controller, Get, Post, Patch, Body, Param, UseGuards, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, UpdateFeedbackStatusDto } from './dto/feedback.dto';

@Controller('feedback')
@UseGuards(JwtAuthGuard)
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Get()
  async listFeedback(@Req() req: any) {
    const userId = req.user?.id || req.user?.sub;
    return this.feedbackService.listFeedback(userId);
  }

  @Post()
  async createFeedback(@Req() req: any, @Body() dto: CreateFeedbackDto) {
    const orgId = req.user?.organizationId || req.user?.organization_id;
    const userId = req.user?.id || req.user?.sub;
    return this.feedbackService.createFeedback(orgId, userId, dto);
  }

  @Post(':id/vote')
  async voteFeedback(@Req() req: any, @Param('id') id: string) {
    const userId = req.user?.id || req.user?.sub;
    return this.feedbackService.toggleVote(id, userId);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body() dto: UpdateFeedbackStatusDto) {
    return this.feedbackService.updateStatus(id, dto);
  }
}
