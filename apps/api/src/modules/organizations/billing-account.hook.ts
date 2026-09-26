import { Injectable } from '@nestjs/common';

/**
 * Port through which organization deletion cancels a paid subscription.
 *
 * Billing currently stores no subscription identifiers (checkout sessions only), so
 * there is nothing to cancel on our side; the default implementation reports
 * NOT_INTEGRATED and the deletion result surfaces that status to the caller.
 * When billing persists Stripe subscriptions, bind BILLING_ACCOUNT_HOOK to an
 * implementation that cancels them (OrganizationsModule provider).
 */
export interface BillingAccountHook {
  onOrganizationDeletion(organizationId: string): Promise<{
    status: 'CANCELLED' | 'NO_SUBSCRIPTION' | 'NOT_INTEGRATED';
    detail?: string;
  }>;
}

export const BILLING_ACCOUNT_HOOK = Symbol('BILLING_ACCOUNT_HOOK');

@Injectable()
export class NoSubscriptionStorageBillingHook implements BillingAccountHook {
  async onOrganizationDeletion(): Promise<{ status: 'NOT_INTEGRATED'; detail: string }> {
    return {
      status: 'NOT_INTEGRATED',
      detail: 'Billing does not persist subscription identifiers; cancel any Stripe subscription in the Stripe dashboard.',
    };
  }
}
