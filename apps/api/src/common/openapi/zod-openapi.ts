import { applyDecorators } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Minimal Zod (v3) → OpenAPI 3 schema conversion so endpoints that validate with
 * Zod publish their real request contracts in the OpenAPI document / Scalar
 * reference (C §47). Covers the Zod constructs used by request schemas.
 */
export function zodToOpenApi(schema: z.ZodTypeAny): Record<string, any> {
  const def: any = (schema as any)._def;
  if (schema instanceof z.ZodOptional) return zodToOpenApi(schema.unwrap());
  if (schema instanceof z.ZodNullable) return { ...zodToOpenApi(schema.unwrap()), nullable: true };
  if (schema instanceof z.ZodDefault) return { ...zodToOpenApi(def.innerType), default: def.defaultValue() };
  if (schema instanceof z.ZodEffects) return zodToOpenApi(def.schema);
  if (schema instanceof z.ZodString) {
    const out: Record<string, any> = { type: 'string' };
    for (const c of def.checks || []) {
      if (c.kind === 'min') out.minLength = c.value;
      if (c.kind === 'max') out.maxLength = c.value;
      if (c.kind === 'uuid') out.format = 'uuid';
      if (c.kind === 'url') out.format = 'uri';
      if (c.kind === 'email') out.format = 'email';
      if (c.kind === 'regex') out.pattern = c.regex.source;
    }
    return out;
  }
  if (schema instanceof z.ZodNumber) {
    const out: Record<string, any> = { type: (def.checks || []).some((c: any) => c.kind === 'int') ? 'integer' : 'number' };
    for (const c of def.checks || []) {
      if (c.kind === 'min') out.minimum = c.value;
      if (c.kind === 'max') out.maximum = c.value;
    }
    return out;
  }
  if (schema instanceof z.ZodBoolean) return { type: 'boolean' };
  if (schema instanceof z.ZodLiteral) return { type: typeof def.value, enum: [def.value] };
  if (schema instanceof z.ZodEnum) return { type: 'string', enum: def.values };
  if (schema instanceof z.ZodArray) {
    const out: Record<string, any> = { type: 'array', items: zodToOpenApi(def.type) };
    if (def.minLength) out.minItems = def.minLength.value;
    if (def.maxLength) out.maxItems = def.maxLength.value;
    return out;
  }
  if (schema instanceof z.ZodRecord) return { type: 'object', additionalProperties: zodToOpenApi(def.valueType) };
  if (schema instanceof z.ZodObject) {
    const shape = schema.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, any> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = zodToOpenApi(v);
      if (!(v instanceof z.ZodOptional) && !(v instanceof z.ZodDefault)) required.push(k);
    }
    return {
      type: 'object',
      properties,
      ...(required.length ? { required } : {}),
      ...(def.unknownKeys === 'strict' ? { additionalProperties: false } : {}),
    };
  }
  if (schema instanceof z.ZodDiscriminatedUnion || schema instanceof z.ZodUnion) {
    const options: z.ZodTypeAny[] = schema instanceof z.ZodDiscriminatedUnion ? [...(schema.options as any)] : def.options;
    return { oneOf: options.map(zodToOpenApi) };
  }
  if (schema instanceof z.ZodUnknown || schema instanceof z.ZodAny) return {};
  return {};
}

/** `@ZodBody(schema)` — documents a Zod-validated request body in OpenAPI. */
export function ZodBody(schema: z.ZodTypeAny, description?: string) {
  return applyDecorators(ApiBody({ schema: zodToOpenApi(schema) as any, description, required: true }));
}
