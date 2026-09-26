import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  InvoiceSummary,
  PLAN_CATALOG,
  PLAN_TIERS,
  PlanDefinition,
  SubscriptionStatus,
} from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { AuditService } from '../audit/audit.service';
import { PlanTier } from './billing.interface';
import { PURCHASABLE_TIERS } from './dto/billing.dto';
import {
  BillingProvider,
  BillingProviderName,
  LocalBillingProvider,
  StripeBillingProvider,
} from './billing-provider';
import * as crypto from 'node:crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_WEB_ORIGINS = ['https://erppreflight.com', 'https://www.erppreflight.com'];
const BILLING_PATH = '/settings/billing';
const WEBHOOK_TOLERANCE_SECONDS = 300;

/** Stripe subscription.status → internal SubscriptionStatus. */
export function mapStripeStatus(status: unknown): SubscriptionStatus {
  switch (String(status ?? '').toLowerCase()) {
    case 'active':
      return 'ACTIVE';
    case 'trialing':
      return 'TRIALING';
    case 'past_due':
      return 'PAST_DUE';
    case 'unpaid':
      return 'UNPAID';
    case 'canceled':
      return 'CANCELED';
    case 'incomplete':
    case 'incomplete_expired':
    case 'paused':
      return 'INCOMPLETE';
    default:
      return 'NONE';
  }
}

export interface ActorRef {
  actorId?: string | null;
  actorType?: 'HUMAN' | 'SYSTEM' | 'API_KEY' | 'AI_AGENT';
}

interface SubscriptionPatch {
  planTier?: PlanTier;
  subscriptionStatus?: SubscriptionStatus;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
}

export interface PlanCatalogEntry extends PlanDefinition {
  purchasable: boolean;
}

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);
  private readonly stripeApiKey?: string;
  private readonly webhookSecret?: string;
  private readonly provider: BillingProvider | null;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional() private readonly outbox?: OutboxService,
    @Optional() private readonly audit?: AuditService
  ) {
    this.stripeApiKey = this.config.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    this.provider = this.createProvider();
  }

  private isProduction(): boolean {
    return (this.config.get<string>('NODE_ENV') || process.env.NODE_ENV) === 'production';
  }

  /**
   * BILLING_PROVIDER=stripe|local|none. Unset: stripe when STRIPE_SECRET_KEY is
   * set, otherwise none ("billing not configured"). The local simulator is
   * refused in production.
   */
  private createProvider(): BillingProvider | null {
    const requested = (this.config.get<string>('BILLING_PROVIDER') || '').toLowerCase();
    if (requested === 'none') return null;
    if (requested === 'local') {
      if (this.isProduction()) {
        this.logger.error('BILLING_PROVIDER=local is not allowed in production; billing disabled.');
        return null;
      }
      return new LocalBillingProvider();
    }
    if (this.stripeApiKey) return new StripeBillingProvider(this.stripeApiKey);
    if (requested === 'stripe') {
      this.logger.error('BILLING_PROVIDER=stripe but STRIPE_SECRET_KEY is missing; billing disabled.');
    }
    return null;
  }

  providerInfo(): { configured: boolean; name: BillingProviderName | 'none'; checkoutAvailable: boolean; portalAvailable: boolean } {
    const name = this.provider?.name ?? 'none';
    return {
      configured: !!this.provider,
      name,
      checkoutAvailable: !!this.provider,
      portalAvailable: !!this.provider,
    };
  }

  private requireProvider(): BillingProvider {
    if (!this.provider) {
      throw new ServiceUnavailableException(
        'Billing is not configured on this deployment (set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET).'
      );
    }
    return this.provider;
  }

  /** Configured list price in EUR (PLAN_PRICE_EUR_<TIER> overrides the catalog value). */
  priceForTier(tier: PlanTier): number | null {
    const raw = this.config.get<string>(`PLAN_PRICE_EUR_${tier}`);
    if (raw !== undefined && raw !== null && String(raw).trim() !== '') {
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return PLAN_CATALOG[tier].monthlyPriceEur;
  }

  private priceIdForTier(tier: PlanTier): string | null {
    const v = this.config.get<string>(`STRIPE_PRICE_ID_${tier}`);
    return v && v.trim() ? v.trim() : null;
  }

  private tierForPriceId(priceId: unknown): PlanTier | null {
    if (typeof priceId !== 'string') return null;
    return PLAN_TIERS.find((t) => this.priceIdForTier(t) === priceId) ?? null;
  }

  /** Plan catalog with deployment-configured prices (public pricing + billing page). */
  getPlanCatalog(): PlanCatalogEntry[] {
    return PLAN_TIERS.map((tier) => {
      const plan = PLAN_CATALOG[tier];
      const monthlyPriceEur = this.priceForTier(tier);
      return {
        ...plan,
        monthlyPriceEur,
        purchasable: plan.selfServe && PURCHASABLE_TIERS.includes(tier) && monthlyPriceEur !== null,
      };
    });
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

  private async loadBillingRow(organizationId: string) {
    const res = await this.db.query(
      `SELECT id, plan_tier, subscription_status, stripe_customer_id, stripe_subscription_id
         FROM organizations WHERE id = $1`,
      [organizationId],
      { bypassRls: true }
    );
    return res.rows?.[0] ?? null;
  }

  /**
   * Starts a subscription checkout for a self-service tier.
   */
  async createCheckoutSession(
    organizationId: string,
    targetTier: PlanTier,
    returnUrl?: string,
    actor: ActorRef = {}
  ): Promise<{ url: string; sessionId: string }> {
    if (!PURCHASABLE_TIERS.includes(targetTier) || !PLAN_CATALOG[targetTier]?.selfServe) {
      throw new BadRequestException('targetTier is not purchasable through self-service checkout; contact sales');
    }
    const successUrl = this.resolveReturnUrl(returnUrl, 'success');
    const cancelUrl = this.resolveReturnUrl(returnUrl, 'cancelled');
    const provider = this.requireProvider();

    const priceId = this.priceIdForTier(targetTier);
    const price = this.priceForTier(targetTier);
    if (!priceId && price === null) {
      throw new BadRequestException(`No price is configured for ${targetTier}; contact sales`);
    }
    const row = await this.loadBillingRow(organizationId);

    const session = await provider.createCheckout({
      organizationId,
      tier: targetTier,
      successUrl,
      cancelUrl,
      customerId: row?.stripe_customer_id ?? null,
      priceId,
      unitAmountCents: price === null ? null : Math.round(price * 100),
    });

    if (provider.name === 'local') {
      // Simulated provider: apply exactly the transition a verified webhook would.
      await this.applySubscriptionPatch(
        organizationId,
        {
          planTier: targetTier,
          subscriptionStatus: 'ACTIVE',
          stripeCustomerId: row?.stripe_customer_id ?? `cus_local_${organizationId.slice(0, 8)}`,
          stripeSubscriptionId: `sub_local_${session.sessionId.slice(-10)}`,
          currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
          cancelAtPeriodEnd: false,
        },
        { source: 'local_checkout', eventId: session.sessionId },
        actor
      );
    }
    return session;
  }

  /**
   * Opens the provider's customer portal (manage payment method, cancel, invoices).
   */
  async createCustomerPortalSession(organizationId: string, returnUrl?: string): Promise<{ url: string }> {
    const target = this.resolveReturnUrl(returnUrl);
    const provider = this.requireProvider();
    const row = await this.loadBillingRow(organizationId);
    if (!row?.stripe_customer_id) {
      throw new ConflictException('This organization has no billing account yet. Choose a plan first.');
    }
    return provider.createPortal(row.stripe_customer_id, target);
  }

  async listInvoices(organizationId: string): Promise<{ configured: boolean; invoices: InvoiceSummary[] }> {
    if (!this.provider) return { configured: false, invoices: [] };
    const row = await this.loadBillingRow(organizationId);
    if (!row?.stripe_customer_id) return { configured: true, invoices: [] };
    return { configured: true, invoices: await this.provider.listInvoices(row.stripe_customer_id) };
  }

  /**
   * Single state transition for subscription/plan changes (webhooks, local
   * provider, super-admin overrides). Updates the organization, emits the
   * outbox event in the same transaction and appends a fail-closed audit event.
   */
  async applySubscriptionPatch(
    organizationId: string,
    patch: SubscriptionPatch,
    source: { source: string; eventId?: string | null; eventType?: string },
    actor: ActorRef = {}
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [organizationId];
    const set = (col: string, value: unknown) => {
      params.push(value);
      sets.push(`${col} = $${params.length}`);
    };
    if (patch.planTier) set('plan_tier', patch.planTier);
    if (patch.subscriptionStatus) set('subscription_status', patch.subscriptionStatus);
    if (patch.stripeCustomerId !== undefined) set('stripe_customer_id', patch.stripeCustomerId);
    if (patch.stripeSubscriptionId !== undefined) set('stripe_subscription_id', patch.stripeSubscriptionId);
    if (patch.currentPeriodEnd !== undefined) set('current_period_end', patch.currentPeriodEnd);
    if (patch.cancelAtPeriodEnd !== undefined) set('cancel_at_period_end', patch.cancelAtPeriodEnd);
    if (sets.length === 0) return;

    const previous = await this.db.withTenantTransaction(organizationId, async (client) => {
      const before = await client.query(
        `SELECT plan_tier, subscription_status FROM organizations WHERE id = $1 FOR UPDATE`,
        [organizationId]
      );
      await client.query(
        `UPDATE organizations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`,
        params
      );
      if (this.outbox && patch.planTier && patch.planTier !== before.rows?.[0]?.plan_tier) {
        await this.outbox.recordEvent(
          organizationId,
          'organization.plan_changed',
          'PROJECT',
          organizationId,
          { organizationId, previousTier: before.rows?.[0]?.plan_tier ?? null, newTier: patch.planTier },
          client
        );
      }
      return before.rows?.[0] ?? null;
    });

    if (this.audit) {
      await this.audit.recordEvent({
        organizationId,
        action: 'billing.subscription.changed',
        resourceType: 'SUBSCRIPTION',
        resourceId: organizationId,
        payload: {
          source: source.source,
          providerEventId: source.eventId ?? null,
          providerEventType: source.eventType ?? null,
          previousTier: previous?.plan_tier ?? null,
          previousStatus: previous?.subscription_status ?? null,
          newTier: patch.planTier ?? null,
          newStatus: patch.subscriptionStatus ?? null,
          cancelAtPeriodEnd: patch.cancelAtPeriodEnd ?? null,
        },
        actorType: actor.actorType ?? (actor.actorId ? 'HUMAN' : 'SYSTEM'),
        actorId: actor.actorId ?? null,
      });
    }
  }

  /**
   * Direct plan change (enterprise agreements / invoice billing). Kept for
   * compatibility; routes through applySubscriptionPatch.
   */
  async upgradeTenantPlan(organizationId: string, targetTier: PlanTier, actor: ActorRef = {}): Promise<void> {
    await this.applySubscriptionPatch(organizationId, { planTier: targetTier }, { source: 'manual' }, actor);
  }

  /** Verifies the Stripe-Signature header over the raw body (HMAC-SHA256, 5-minute tolerance). */
  verifyWebhookSignature(signature: string | undefined, rawBody: string): void {
    if (!this.webhookSecret) {
      throw new ServiceUnavailableException('Billing webhook endpoint is not configured. Set STRIPE_WEBHOOK_SECRET.');
    }
    if (!signature) {
      throw new UnauthorizedException('Missing webhook signature');
    }
    const parts = signature.split(',').map((p) => p.trim());
    const timestampPart = parts.find((p) => p.startsWith('t='));
    const candidates = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
    if (!timestampPart || candidates.length === 0) {
      throw new BadRequestException('Invalid Stripe webhook signature format');
    }
    const timestamp = timestampPart.slice(2);
    const timestampSeconds = parseInt(timestamp, 10);
    if (!Number.isFinite(timestampSeconds)) {
      throw new BadRequestException('Invalid Stripe webhook signature timestamp');
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
      throw new BadRequestException('Webhook timestamp outside tolerance window');
    }
    const computedSig = crypto
      .createHmac('sha256', this.webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');
    // Stripe may send several v1 signatures (secret rotation); any match is valid.
    const matches = candidates.some(
      (expectedSig) =>
        computedSig.length === expectedSig.length &&
        crypto.timingSafeEqual(Buffer.from(computedSig), Buffer.from(expectedSig))
    );
    if (!matches) {
      throw new BadRequestException('Stripe webhook signature mismatch');
    }
  }

  private async findOrgByCustomer(customerId: unknown): Promise<string | null> {
    if (typeof customerId !== 'string' || !customerId) return null;
    const res = await this.db.query(
      `SELECT id FROM organizations WHERE stripe_customer_id = $1`,
      [customerId],
      { bypassRls: true }
    );
    return res.rows?.[0]?.id ?? null;
  }

  private async resolveOrg(obj: any): Promise<string | null> {
    const candidate = obj?.metadata?.organization_id ?? obj?.client_reference_id ?? null;
    if (candidate) {
      if (!UUID_RE.test(String(candidate))) {
        throw new BadRequestException('Webhook organization reference is invalid');
      }
      return String(candidate);
    }
    return this.findOrgByCustomer(obj?.customer);
  }

  private tierFromSubscription(sub: any): PlanTier | null {
    const metaTier = String(sub?.metadata?.target_tier ?? '').toUpperCase();
    if ((PLAN_TIERS as readonly string[]).includes(metaTier)) return metaTier as PlanTier;
    const priceId = sub?.items?.data?.[0]?.price?.id;
    return this.tierForPriceId(priceId);
  }

  private async alreadyProcessed(eventId: string): Promise<boolean> {
    const res = await this.db.query(
      `SELECT 1 FROM billing_events WHERE provider_event_id = $1`,
      [eventId],
      { bypassRls: true }
    );
    return (res.rows?.length ?? 0) > 0;
  }

  private async markProcessed(eventId: string, type: string, orgId: string | null, rawBody: string, outcome: string) {
    await this.db.query(
      `INSERT INTO billing_events (provider_event_id, provider, event_type, organization_id, payload_sha256, outcome)
       VALUES ($1, 'stripe', $2, $3, $4, $5)
       ON CONFLICT (provider_event_id) DO NOTHING`,
      [eventId, type, orgId, crypto.createHash('sha256').update(rawBody).digest('hex'), outcome],
      { bypassRls: true }
    );
  }

  /**
   * Ingests a verified Stripe webhook and derives internal entitlement state.
   * Handled: checkout.session.completed, customer.subscription.created|updated|deleted,
   * invoice.payment_failed, invoice.paid|payment_succeeded. Idempotent per event id.
   */
  async handleWebhook(
    signature: string | undefined,
    payload: Buffer | string
  ): Promise<{ received: boolean; duplicate?: boolean; handled?: boolean }> {
    const rawBody = typeof payload === 'string' ? payload : payload.toString('utf-8');
    this.verifyWebhookSignature(signature, rawBody);

    let event: any;
    try {
      event = JSON.parse(rawBody);
    } catch {
      throw new BadRequestException('Malformed webhook JSON payload');
    }
    const eventId: string | null = typeof event?.id === 'string' ? event.id : null;
    const type = String(event?.type ?? '');
    const obj = event?.data?.object ?? {};

    if (eventId && (await this.alreadyProcessed(eventId))) {
      return { received: true, duplicate: true };
    }

    const source = { source: 'stripe_webhook', eventId, eventType: type };
    let orgId: string | null = null;
    let handled = true;

    switch (type) {
      case 'checkout.session.completed': {
        const targetTier = String(obj?.metadata?.target_tier ?? '').toUpperCase() as PlanTier;
        if (!(PLAN_TIERS as readonly string[]).includes(targetTier)) {
          throw new BadRequestException('Webhook metadata target_tier is invalid');
        }
        orgId = await this.resolveOrg(obj);
        if (orgId) {
          await this.applySubscriptionPatch(
            orgId,
            {
              planTier: targetTier,
              subscriptionStatus: 'ACTIVE',
              ...(typeof obj.customer === 'string' ? { stripeCustomerId: obj.customer } : {}),
              ...(typeof obj.subscription === 'string' ? { stripeSubscriptionId: obj.subscription } : {}),
            },
            source
          );
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        orgId = await this.resolveOrg(obj);
        if (orgId) {
          const status = mapStripeStatus(obj.status);
          const tier = this.tierFromSubscription(obj);
          const downgrade = status === 'CANCELED' || status === 'UNPAID';
          await this.applySubscriptionPatch(
            orgId,
            {
              subscriptionStatus: status,
              ...(downgrade ? { planTier: 'FREE' as PlanTier } : tier ? { planTier: tier } : {}),
              ...(typeof obj.customer === 'string' ? { stripeCustomerId: obj.customer } : {}),
              ...(typeof obj.id === 'string' ? { stripeSubscriptionId: obj.id } : {}),
              currentPeriodEnd: obj.current_period_end
                ? new Date(Number(obj.current_period_end) * 1000).toISOString()
                : null,
              cancelAtPeriodEnd: Boolean(obj.cancel_at_period_end),
            },
            source
          );
        }
        break;
      }
      case 'customer.subscription.deleted': {
        orgId = await this.resolveOrg(obj);
        if (orgId) {
          await this.applySubscriptionPatch(
            orgId,
            {
              planTier: 'FREE',
              subscriptionStatus: 'CANCELED',
              stripeSubscriptionId: null,
              cancelAtPeriodEnd: false,
            },
            source
          );
        }
        break;
      }
      case 'invoice.payment_failed': {
        orgId = await this.findOrgByCustomer(obj?.customer);
        if (orgId) {
          await this.applySubscriptionPatch(orgId, { subscriptionStatus: 'PAST_DUE' }, source);
        }
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        orgId = await this.findOrgByCustomer(obj?.customer);
        if (orgId) {
          const row = await this.loadBillingRow(orgId);
          if (row?.subscription_status === 'PAST_DUE') {
            await this.applySubscriptionPatch(orgId, { subscriptionStatus: 'ACTIVE' }, source);
          }
        }
        break;
      }
      default:
        handled = false;
    }

    if (eventId) {
      await this.markProcessed(eventId, type, orgId, rawBody, handled ? (orgId ? 'APPLIED' : 'NO_TENANT') : 'IGNORED');
    }
    return { received: true, handled };
  }
}
