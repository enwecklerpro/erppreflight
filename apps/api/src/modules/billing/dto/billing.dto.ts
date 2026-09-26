import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PlanTier } from '../billing.interface';

/**
 * Tiers that can be purchased through self-service checkout (mirrors
 * PLAN_CATALOG[tier].selfServe in @erppreflight/schemas; Enterprise and
 * Partner are sold through sales).
 */
export const PURCHASABLE_TIERS: PlanTier[] = ['STARTER', 'PROFESSIONAL'];

export class CreateCheckoutDto {
  @IsIn(PURCHASABLE_TIERS)
  targetTier: PlanTier;

  /** Must be an absolute URL on an allowlisted web origin (validated in BillingService). */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnUrl?: string;
}

export class CreatePortalDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnUrl?: string;
}
