import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z
    .string()
    .default('postgres://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev'),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6380),
  REDIS_PASSWORD: z.string().optional().default(''),
  JWT_SECRET: z
    .string()
    .min(32)
    .default('secret-key-must-be-at-least-32-chars-long-abcdef123456'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ANALYSIS_SERVICE_URL: z.string().default('http://localhost:8000'),
  CORS_ORIGIN: z.string().optional(),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().default('minioadmin'),
  S3_SECRET_KEY: z.string().default('minioadmin'),
  S3_BUCKET_QUARANTINE: z.string().default('erppreflight-quarantine'),
  S3_BUCKET_CLEAN: z.string().default('erppreflight-clean'),
  S3_BUCKET_REPORTS: z.string().default('erppreflight-reports'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  CLAMAV_MOCK_MODE: z.preprocess((val) => val === 'true' || val === true || val === undefined, z.boolean()).default(true),
  MASTER_ENCRYPTION_KEY: z.string().default('erppreflight-default-master-key-32-chars-minimum-abcdef'),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    console.error('Environment validation error:', parsed.error.format());
    throw new Error('Environment configuration validation failed');
  }
  return parsed.data;
}
