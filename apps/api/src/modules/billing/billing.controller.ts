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
  Query,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { BillingOverview, UsageMetricEnum } from '@erppreflight/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CreateCheckoutDto, CreatePortalDto } from './dto/billing.dto';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { EntitlementsService } from './entitlements.service';
import { BillingService } from './billing.service';
import { TenantUsage } from './billing.interface';
import { UsageService } from '../usage/usage.service';
import { Audited } from '../audit/audited.decorator';
import { SkipCsrf } from '../auth/csrf.guard';

@ApiTags('Billing & Entitlements')
@Controller('billing')
export class BillingController {
  constructor(
    private readonly entitlementsService: EntitlementsService,
    private readonly billingService: BillingService,
    private readonly usageService: UsageService
  ) {}

  /** Public plan catalog with deployment-configured prices (pricing page, billing page). */
  @Get('plans')
  @ApiOperation({ summary: 'List plans, limits, features and configured prices' })
  getPlans() {
    return { plans: this.billingService.getPlanCatalog(), provider: this.billingService.providerInfo() };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard)
  @Get('entitlements')
  @ApiOperation({ summary: 'Get organization subscription tier, limits, and usage quotas' })
  @ApiResponse({ status: 200, description: 'Usage and quota status returned successfully' })
  async getEntitlements(@CurrentTenant() tenantId: string): Promise<TenantUsage> {
    return await this.entitlementsService.getTenantUsage(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard)
  @Get('overview')
  @ApiOperation({ summary: 'Current plan, trial, subscription and usage meters for the billing page' })
  async getOverview(@CurrentTenant() tenantId: string): Promise<BillingOverview> {
    const usage = await this.entitlementsService.getTenantUsage(tenantId);
    return {
      organizationId: tenantId,
      planTier: usage.planTier,
      effectiveTier: usage.effectiveTier,
      subscriptionStatus: usage.subscriptionStatus,
      currentPeriodEnd: usage.currentPeriodEnd,
      cancelAtPeriodEnd: usage.cancelAtPeriodEnd,
      trial: usage.trial,
      periodStart: usage.periodStart,
      meters: usage.meters,
      metered: usage.metered,
      hasLimitOverrides: usage.hasLimitOverrides,
      provider: this.billingService.providerInfo(),
    };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard)
  @Get('usage/daily')
  @ApiOperation({ summary: 'Daily usage series for one metric (last N days)' })
  async getDailyUsage(
    @CurrentTenant() tenantId: string,
    @Query('metric') metric?: string,
    @Query('days') days?: string
  ) {
    const m = UsageMetricEnum.safeParse(metric ?? 'ANALYSIS_RUN');
    if (!m.success) throw new BadRequestException('Unknown usage metric');
    const d = Math.min(Math.max(parseInt(days ?? '30', 10) || 30, 1), 366);
    return { metric: m.data, days: d, series: await this.usageService.getDailySeries(tenantId, m.data, d) };
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
  @Roles('ORGANIZATION_OWNER', 'SECURITY_ADMIN')
  @Get('invoices')
  @ApiOperation({ summary: 'Invoices from the billing provider (Stripe)' })
  async getInvoices(@CurrentTenant() tenantId: string) {
    return this.billingService.listInvoices(tenantId);
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
  @Roles('ORGANIZATION_OWNER')
  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @Audited({
    action: 'billing.checkout.started',
    targetType: 'SUBSCRIPTION',
    security: true,
    payload: ({ body, result }) => ({ targetTier: body?.targetTier, sessionId: result?.sessionId ?? null }),
  })
  @ApiOperation({ summary: 'Initiate Stripe subscription checkout session' })
  async createCheckout(
    @CurrentTenant() tenantId: string,
    @Req() req: any,
    @Body() body: CreateCheckoutDto
  ): Promise<{ url: string; sessionId: string }> {
    return await this.billingService.createCheckoutSession(tenantId, body.targetTier, body.returnUrl, {
      actorId: req.user?.id ?? null,
      actorType: 'HUMAN',
    });
  }

  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, TenancyGuard, RolesGuard)
  @Roles('ORGANIZATION_OWNER')
  @Post('portal')
  @HttpCode(HttpStatus.OK)
  @Audited({ action: 'billing.portal.opened', targetType: 'SUBSCRIPTION' })
  @ApiOperation({ summary: 'Create Customer Billing Portal session' })
  async createPortal(
    @CurrentTenant() tenantId: string,
    @Body() body: CreatePortalDto
  ): Promise<{ url: string }> {
    return await this.billingService.createCustomerPortalSession(tenantId, body.returnUrl);
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @SkipCsrf() // authenticated by the Stripe-Signature HMAC, not by the session cookie
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
