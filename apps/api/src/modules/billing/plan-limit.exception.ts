import { HttpException, HttpStatus } from '@nestjs/common';
import type { PlanLimitKey } from '@erppreflight/schemas';

/**
 * 402 Payment Required: a metered/numeric plan limit is exhausted. The client
 * can resolve it by upgrading (or waiting for the next billing period).
 * Feature gating (feature not in plan) stays 403 Forbidden.
 */
export class PlanLimitExceededException extends HttpException {
  constructor(
    public readonly limitKey: PlanLimitKey,
    public readonly used: number,
    public readonly limit: number,
    public readonly planTier: string,
    message: string
  ) {
    super(
      {
        statusCode: HttpStatus.PAYMENT_REQUIRED,
        error: 'Payment Required',
        code: 'PLAN_LIMIT_EXCEEDED',
        message,
        limitKey,
        used,
        limit,
        planTier,
      },
      HttpStatus.PAYMENT_REQUIRED
    );
  }
}
