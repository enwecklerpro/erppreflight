import { BadRequestException } from '@nestjs/common';
import type { ZodType, ZodTypeDef } from 'zod';

/** Validates an untrusted request payload with Zod; 400 with field messages on failure. */
export function zodParse<T>(schema: ZodType<T, ZodTypeDef, unknown>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) {
    throw new BadRequestException(
      parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
    );
  }
  return parsed.data;
}
