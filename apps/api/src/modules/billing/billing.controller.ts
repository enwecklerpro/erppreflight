import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateCheckoutDto, CreatePortalDto } from './dto/billing.dto';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { EntitlementsService } from './entitlements.service';
import { BillingService } from './billing.service';
import { TenantUsage } from './billing.interface';

@ApiTags('Billing & Entitlements')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly entitlementsService: EntitlementsService,
    private readonly billingService: BillingService
  ) {}

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard)
  @Get('entitlements')
  @ApiOperation({ summary: 'Get organization subscription tier, limits, and usage quotas' })
  @ApiResponse({ status: 200, description: 'Usage and quota status returned successfully' })
  async getEntitlements(@CurrentTenant() tenantId: string): Promise<TenantUsage> {
    return await this.entitlementsService.getTenantUsage(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
  @Roles('ORGANIZATION_OWNER')
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate Stripe subscription checkout session' })
  async createCheckout(
    @CurrentTenant() tenantId: string,
    @Body() body: CreateCheckoutDto
  ): Promise<{ url: string; sessionId: string }> {
    return await this.billingService.createCheckoutSession(
      tenantId,
      body.targetTier,
      body.returnUrl
    );
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
  @Roles('ORGANIZATION_OWNER')
  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Create Customer Billing Portal session' })
  async createPortal(
    @CurrentTenant() tenantId: string,
    @Body() body: CreatePortalDto
  ): Promise<{ url: string }> {
    return await this.billingService.createCustomerPortalSession(tenantId, body.returnUrl);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe Webhook Receiver' })
  async handleWebhook(
    @Headers('stripe-signature') signature: string,
    @Req() req: any
  ): Promise<{ received: boolean }> {
    // Signatures are computed over the exact request bytes; main.ts enables rawBody.
    const rawBody: unknown = req.rawBody;
    if (!Buffer.isBuffer(rawBody)) {
      throw new BadRequestException('Raw request body unavailable for signature verification');
    }
    return await this.billingService.handleWebhook(signature, rawBody);
  }
}
