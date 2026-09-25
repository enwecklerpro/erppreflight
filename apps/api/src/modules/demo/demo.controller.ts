import { Controller, Post, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { DemoService } from './demo.service';

@ApiTags('Demo & Sandbox')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('demo')
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post('explore')
  @ApiOperation({ summary: 'Provision or retrieve the interactive Demo Sandbox with all 7 failure scenarios' })
  async explore(@Req() req: any) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.demoService.provisionDemoProject(orgId, userId);
  }
}
