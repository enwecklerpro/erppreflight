import {
  Injectable,
  Logger,
  BadRequestException,
  BadGatewayException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { PlanTier } from './billing.interface';
import { PURCHASABLE_TIERS } from './dto/billing.dto';
import * as crypto from 'node:crypto';

const ALL_TIERS: PlanTier[] = ['FREE', 'STARTER', 'PROFESSIONAL', 'ENTERPRISE', 'PARTNER'];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_WEB_ORIGINS = ['https://erppreflight.com', 'https://www.erppreflight.com'];
const BILLING_PATH = '/settings/billing';

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

  private isProduction(): boolean {
    return (this.config.get<string>('NODE_ENV') || process.env.NODE_ENV) === 'production';
  }

  /** Web origins that Stripe may redirect back to (BILLING_RETURN_ORIGINS, else CORS_ORIGIN). */
  private allowedReturnOrigins(): string[] {
    const raw =
      this.config.get<string>('BILLING_RETURN_ORIGINS') || this.config.get<string>('CORS_ORIGIN') || '';
    const origins = raw
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)
      .map((o) => {
        try {
          return new URL(o).origin;
        } catch {
          return null;
        }
      })
      .filter((o): o is string => !!o);
    return origins.length > 0 ? origins : DEFAULT_WEB_ORIGINS;
  }

  /**
   * Validates a caller-supplied return URL against the allowlisted web origins
   * (prevents open redirects through Stripe). Returns the default billing page when absent.
   */
  resolveReturnUrl(returnUrl: string | undefined, status?: 'success' | 'cancelled'): string {
    const allowed = this.allowedReturnOrigins();
    let url: URL;
    if (!returnUrl) {
      url = new URL(BILLING_PATH, allowed[0]);
    } else {
      try {
        url = new URL(returnUrl);
      } catch {
        throw new BadRequestException('returnUrl must be an absolute URL');
      }
      if (!allowed.includes(url.origin) || url.username || url.password) {
        throw new BadRequestException('returnUrl origin is not allowed');
      }
      if (this.isProduction() && url.protocol !== 'https:') {
        throw new BadRequestException('returnUrl must use https');
      }
    }
    if (status) {
      url.searchParams.set('status', status);
    }
    return url.toString();
  }

  /**
   * Generates a Stripe Checkout session (or a local placeholder outside production).
   */
  async createCheckoutSession(
    organizationId: string,
    targetTier: PlanTier,
    returnUrl?: string
  ): Promise<{ url: string; sessionId: string }> {
    if (!PURCHASABLE_TIERS.includes(targetTier)) {
      throw new BadRequestException('targetTier is not purchasable');
    }
    const successUrl = this.resolveReturnUrl(returnUrl, 'success');
    const cancelUrl = this.resolveReturnUrl(returnUrl, 'cancelled');

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
        this.logger.warn(`Stripe API returned error: ${errText}`);
      } catch (err: any) {
        this.logger.error(`Stripe checkout call failed: ${err.message}`);
      }
      throw new BadGatewayException('Payment provider is unavailable. Please try again later.');
    }

    if (this.isProduction()) {
      throw new ServiceUnavailableException('Billing is not configured (STRIPE_SECRET_KEY missing).');
    }

    // Local / offline development placeholder (never used in production)
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
    const defaultUrl = this.resolveReturnUrl(returnUrl);
    if (this.isProduction()) {
      throw new ServiceUnavailableException('Customer billing portal is not configured.');
    }
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

    const signedPayload = `${timestamp}.${rawBody}`;
    const computedSig = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(signedPayload)
      .digest('hex');

    // Stripe may send several v1 signatures (secret rotation); any match is valid.
    const candidates = parts
      .filter((p) => p.startsWith('v1='))
      .map((p) => p.slice(3));
    const matches = candidates.some(
      (expectedSig) =>
        computedSig.length === expectedSig.length &&
        crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(expectedSig))
    );
    if (!matches) {
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
      const targetTier = session?.metadata?.target_tier as PlanTier;

      if (!ALL_TIERS.includes(targetTier)) {
        throw new BadRequestException('Webhook metadata target_tier is invalid');
      }
      if (orgId && !UUID_RE.test(String(orgId))) {
        throw new BadRequestException('Webhook organization reference is invalid');
      }

      if (orgId) {
        this.logger.log(`Processing plan upgrade via webhook for organization ${orgId} to ${targetTier}`);
        await this.upgradeTenantPlan(orgId, targetTier);
      }
    }

    return { received: true };
  }
}
