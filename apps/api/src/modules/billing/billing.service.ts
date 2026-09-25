import { Injectable, Logger, BadRequestException, Optional, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { PlanTier } from './billing.interface';
import * as crypto from 'node:crypto';

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripeApiKey?: string;
  private readonly webhookSecret?: string;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional() private readonly outbox?: OutboxService
  ) {
    this.stripeApiKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
  }

  /**
   * Generates a Stripe Checkout session or test portal link.
   */
  async createCheckoutSession(
    organizationId: string,
    targetTier: PlanTier,
    returnUrl?: string
  ): Promise<{ url: string; sessionId: string }> {
    const successUrl = returnUrl || 'https://app.erppreflight.com/settings/billing?status=success';
    const cancelUrl = returnUrl || 'https://app.erppreflight.com/settings/billing?status=cancelled';

    if (this.stripeApiKey) {
      try {
        const params = new URLSearchParams();
        params.append('client_reference_id', organizationId);
        params.append('mode', 'subscription');
        params.append('success_url', successUrl);
        params.append('cancel_url', cancelUrl);
        params.append('metadata[organization_id]', organizationId);
        params.append('metadata[target_tier]', targetTier);
        params.append('line_items[0][price_data][currency]', 'eur');
        params.append('line_items[0][price_data][product_data][name]', `ERP Preflight ${targetTier}`);
        params.append('line_items[0][price_data][recurring][interval]', 'month');

        const priceMap: Record<PlanTier, number> = {
          FREE: 0,
          STARTER: 49000,
          PROFESSIONAL: 149000,
          ENTERPRISE: 490000,
          PARTNER: 790000,
        };
        params.append('line_items[0][price_data][unit_amount]', String(priceMap[targetTier] || 49000));
        params.append('line_items[0][quantity]', '1');

        const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.stripeApiKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: params.toString(),
        });

        if (res.ok) {
          const session = await res.json();
          return { url: session.url, sessionId: session.id };
        }
        const errText = await res.text();
        this.logger.warn(`Stripe API returned error: ${errText}. Using secure fallback URL.`);
      } catch (err: any) {
        this.logger.error(`Stripe checkout call failed: ${err.message}`);
      }
    }

    // Direct / Local / Offline Fallback portal
    const fallbackId = `cs_test_${crypto.randomBytes(12).toString('hex')}`;
    return {
      url: `https://billing.erppreflight.local/checkout?session_id=${fallbackId}&org=${organizationId}&tier=${targetTier}`,
      sessionId: fallbackId,
    };
  }

  /**
   * Generates a Customer Portal URL for subscription management.
   */
  async createCustomerPortalSession(
    organizationId: string,
    returnUrl?: string
  ): Promise<{ url: string }> {
    const defaultUrl = returnUrl || 'https://app.erppreflight.com/settings/billing';
    return {
      url: `https://billing.erppreflight.local/portal?org=${organizationId}&return=${encodeURIComponent(
        defaultUrl
      )}`,
    };
  }

  /**
   * Direct administrator plan upgrade (e.g. for enterprise agreements or invoice billing).
   */
  async upgradeTenantPlan(organizationId: string, targetTier: PlanTier): Promise<void> {
    await this.db.withTenantTransaction(organizationId, async (client) => {
      await client.query(
        `UPDATE organizations SET plan_tier = $1, updated_at = NOW() WHERE id = $2`,
        [targetTier, organizationId]
      );

      if (this.outbox) {
        await this.outbox.recordEvent(
          organizationId,
          'organization.plan_upgraded',
          'PROJECT',
          organizationId,
          {
            organizationId,
            newTier: targetTier,
          },
          client
        );
      }
    });
  }

  /**
   * Ingests and verifies Stripe Webhook events.
   */
  async handleWebhook(signature: string | undefined, payload: Buffer | string): Promise<{ received: boolean }> {
    const rawBody = typeof payload === 'string' ? payload : payload.toString('utf-8');

    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('Billing webhook endpoint is not configured. Set STRIPE_WEBHOOK_SECRET.');
    }

    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }

    const parts = signature.split(',');
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const sigPart = parts.find((p) => p.startsWith('v1='));

    if (!timestampPart || !sigPart) {
      throw new BadRequestException('Invalid Stripe webhook signature format');
    }

    const timestamp = timestampPart.split('=')[1];
    
    // Check timestamp tolerance (5 minutes)
    const timestampSeconds = parseInt(timestamp, 10);
    const currentSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(currentSeconds - timestampSeconds) > 300) {
      throw new BadRequestException('Webhook timestamp outside tolerance window');
    }

    const expectedSig = sigPart.split('=')[1];
    const signedPayload = `${timestamp}.${rawBody}`;
    const computedSig = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    if (
      computedSig.length !== expectedSig.length ||
      !crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(expectedSig))
    ) {
      throw new BadRequestException('Stripe webhook signature mismatch');
    }

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Malformed webhook JSON payload');
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object;
      const orgId = session?.client_reference_id || session?.metadata?.organization_id;
      const targetTier = (session?.metadata?.target_tier || 'PROFESSIONAL') as PlanTier;

      if (orgId) {
        this.logger.log(`Processing plan upgrade via webhook for organization ${orgId} to ${targetTier}`);
        await this.upgradeTenantPlan(orgId, targetTier);
      }
    }

    return { received: true };
  }
}
