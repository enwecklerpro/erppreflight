import { BadRequestException } from '@nestjs/common';
import type { z } from 'zod';
import { clientIpOf } from './client-ip';
import type { OperatorContext } from './tenant-admin.service';

/** Zod validation with the API's 400 envelope (`code: VALIDATION_FAILED`). */
export function parseBody<S extends z.ZodTypeAny>(schema: S, body: unknown, what: string): z.output<S> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: `Invalid ${what}: ${parsed.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ')}`,
    });
  }
  return parsed.data;
}

export function operatorOf(req: any): OperatorContext {
  return {
    id: req?.user?.id ?? null,
    email: req?.user?.email ?? null,
    clientIp: clientIpOf(req),
    userAgent: String(req?.headers?.['user-agent'] ?? '').slice(0, 500) || null,
  };
}
