import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { AiGatewayService } from './ai-gateway.service';
import {
  FindingExplanationRequest,
  FindingExplanationResponse,
  IntentClassificationRequest,
  IntentClassificationResponse,
} from './ai-gateway.interface';

@ApiTags('AI Governance & Gateway')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenancyGuard)
@Controller('ai')
export class AiGatewayController {
  constructor(private readonly aiGatewayService: AiGatewayService) {}

  @Post('explain-finding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Explain audit finding and generate remediation plan',
    description:
      'Enforces tenant deterministicOnly governance: bypasses external LLMs when policy dictates and caps confidence at 0.60.',
  })
  @ApiResponse({ status: 200, description: 'Finding explanation successfully generated' })
  async explainFinding(
    @CurrentTenant() tenantId: string,
    @Body() body: FindingExplanationRequest
  ): Promise<FindingExplanationResponse> {
    return await this.aiGatewayService.explainFinding(body, { tenantId });
  }

  @Post('classify-intent')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Classify problem intent and recommend preflight engines',
  })
  @ApiResponse({ status: 200, description: 'Engine recommendations generated' })
  async classifyIntent(
    @CurrentTenant() tenantId: string,
    @Body() body: IntentClassificationRequest
  ): Promise<IntentClassificationResponse> {
    return await this.aiGatewayService.classifyIntent(body, { tenantId });
  }
}
