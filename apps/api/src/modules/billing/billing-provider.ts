import { BadGatewayException, Logger } from '@nestjs/common';
import type { InvoiceSummary } from '@erppreflight/schemas';
import type { PlanTier } from './billing.interface';

export type BillingProviderName = 'stripe' | 'local';

export interface CheckoutRequest {
  organizationId: string;
  tier: PlanTier;
  successUrl: string;
  cancelUrl: string;
  customerId: string | null;
  /** Stripe Price id bound via STRIPE_PRICE_ID_<TIER>, if configured. */
  priceId: string | null;
  /** Configured list price in EUR cents (used when no Price id is bound). */
  unitAmountCents: number | null;
}

/**
 * Billing provider abstraction (spec 10.4). BillingService owns entitlement
 * state; providers only talk to the payment system.
 */
export interface BillingProvider {
  readonly name: BillingProviderName;
  createCheckout(req: CheckoutRequest): Promise<{ url: string; sessionId: string }>;
  createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  listInvoices(customerId: string): Promise<InvoiceSummary[]>;
}

const STRIPE_API = 'https://api.stripe.com/v1';

/** Production adapter: Stripe REST API (form-encoded, no SDK dependency). */
export class StripeBillingProvider implements BillingProvider {
  readonly name = 'stripe' as const;
  private readonly logger = new Logger('StripeBillingProvider');

  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  private async call(path: string, init: { method: 'GET' | 'POST'; form?: URLSearchParams; idempotencyKey?: string }) {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.secretKey}` };
    if (init.form) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;
    let res: Response;
    try {
      res = await this.fetchImpl(`${STRIPE_API}${path}`, {
        method: init.method,
        headers,
        body: init.form ? init.form.toString() : undefined,
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err: any) {
      this.logger.error(`Stripe ${init.method} ${path} failed: ${err?.message ?? err}`);
      throw new BadGatewayException('Payment provider is unavailable. Please try again later.');
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      this.logger.warn(`Stripe ${init.method} ${path} returned HTTP ${res.status}: ${text.slice(0, 500)}`);
      throw new BadGatewayException('Payment provider rejected the request.');
    }
    return res.json() as Promise<any>;
  }

  async createCheckout(req: CheckoutRequest) {
    const form = new URLSearchParams();
    form.append('mode', 'subscription');
    form.append('client_reference_id', req.organizationId);
    form.append('success_url', req.successUrl);
    form.append('cancel_url', req.cancelUrl);
    form.append('metadata[organization_id]', req.organizationId);
    form.append('metadata[target_tier]', req.tier);
    form.append('subscription_data[metadata][organization_id]', req.organizationId);
    form.append('subscription_data[metadata][target_tier]', req.tier);
    form.append('allow_promotion_codes', 'true');
    form.append('tax_id_collection[enabled]', 'true');
    if (req.customerId) form.append('customer', req.customerId);
    if (req.priceId) {
      form.append('line_items[0][price]', req.priceId);
    } else if (req.unitAmountCents !== null) {
      form.append('line_items[0][price_data][currency]', 'eur');
      form.append('line_items[0][price_data][product_data][name]', `ERP Preflight ${req.tier}`);
      form.append('line_items[0][price_data][recurring][interval]', 'month');
      form.append('line_items[0][price_data][unit_amount]', String(req.unitAmountCents));
    }
    form.append('line_items[0][quantity]', '1');
    // Collapse double-submits within one minute into a single Checkout Session.
    const idempotencyKey = `checkout:${req.organizationId}:${req.tier}:${Math.floor(Date.now() / 60_000)}`;
    const session = await this.call('/checkout/sessions', { method: 'POST', form, idempotencyKey });
    return { url: String(session.url), sessionId: String(session.id) };
  }

  async createPortal(customerId: string, returnUrl: string) {
    const form = new URLSearchParams();
    form.append('customer', customerId);
    form.append('return_url', returnUrl);
    const session = await this.call('/billing_portal/sessions', { method: 'POST', form });
    return { url: String(session.url) };
  }

  async listInvoices(customerId: string): Promise<InvoiceSummary[]> {
    const qs = new URLSearchParams({ customer: customerId, limit: '24' });
    const list = await this.call(`/invoices?${qs.toString()}`, { method: 'GET' });
    return (Array.isArray(list?.data) ? list.data : []).map((inv: any) => ({
      id: String(inv.id),
      number: inv.number ?? null,
      status: inv.status ?? null,
      amountDue: Number(inv.amount_due ?? 0),
      amountPaid: Number(inv.amount_paid ?? 0),
      currency: String(inv.currency ?? 'eur').toUpperCase(),
      createdAt: new Date(Number(inv.created ?? 0) * 1000).toISOString(),
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
    }));
  }
}

/**
 * Local development adapter (BILLING_PROVIDER=local, never in production).
 * Checkout does not collect money: BillingService applies the subscription
 * through the same state transition a verified Stripe webhook would, so the
 * whole UI → entitlement → audit path can be exercised offline.
 */
export class LocalBillingProvider implements BillingProvider {
  readonly name = 'local' as const;

  async createCheckout(req: CheckoutRequest) {
    const sessionId = `cs_local_${req.organizationId.slice(0, 8)}_${Date.now().toString(36)}`;
    const url = new URL(req.successUrl);
    url.searchParams.set('session_id', sessionId);
    url.searchParams.set('provider', 'local');
    return { url: url.toString(), sessionId };
  }

  async createPortal(_customerId: string, returnUrl: string) {
    const url = new URL(returnUrl);
    url.searchParams.set('portal', 'local');
    return { url: url.toString() };
  }

  async listInvoices(): Promise<InvoiceSummary[]> {
    return [];
  }
}
