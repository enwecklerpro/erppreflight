import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

/** Validates a request payload with a Zod schema; 400 with field-level messages on failure. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`),
    });
  }
  return parsed.data;
}
