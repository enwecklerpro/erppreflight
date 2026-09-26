import { z } from 'zod';
import { resolveMailConfig } from '../modules/mail/mail.config';

const booleanFlag = z.preprocess(
  (val) => (val === undefined || val === null || val === '' ? undefined : val === 'true' || val === true),
  z.boolean().optional()
);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3001),
  API_PORT: z.coerce.number().optional().default(3001),
  // Schema-owner connection (migrations). Required in production.
  DATABASE_URL: z.string().optional(),
  // Optional dedicated runtime connection (non-owner login). Falls back to DATABASE_URL.
  APP_DATABASE_URL: z.string().optional(),
  // Role used via SET LOCAL ROLE for tenant-scoped transactions (see migration 010).
  DB_RUNTIME_ROLE: z.string().optional(),
  REDIS_URL: z.string().optional(),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),
  // Billing provider: 'stripe' (needs STRIPE_SECRET_KEY), 'local' (non-production simulator) or 'none'.
  BILLING_PROVIDER: z.enum(['stripe', 'local', 'none']).optional(),
  TRIAL_DAYS: z.coerce.number().int().min(0).max(90).default(14),
  // Knowledge graph sync (docs/KNOWLEDGE_GRAPH.md): weekly cron in UTC or 'off'; optional repository file subset.
  KNOWLEDGE_SYNC_CRON: z.string().optional(),
  KNOWLEDGE_CR_FILES: z.string().optional(),
  JWT_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ANALYSIS_SERVICE_URL: z.string().default('http://localhost:8000'),
  CORS_ORIGIN: z.string().optional(),
  S3_ENDPOINT: z.string().default('http://localhost:9000'),
  S3_REGION: z.string().default('us-east-1'),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
  S3_BUCKET_QUARANTINE: z.string().default('erppreflight-quarantine'),
  S3_BUCKET_CLEAN: z.string().default('erppreflight-clean'),
  S3_BUCKET_REPORTS: z.string().default('erppreflight-reports'),
  CLAMAV_HOST: z.string().default('localhost'),
  CLAMAV_PORT: z.coerce.number().default(3310),
  CLAMAV_MOCK_MODE: booleanFlag,
  MASTER_ENCRYPTION_KEY: z.string().optional(),
  AUTO_MIGRATE: z.preprocess((val) => val === 'true' || val === true || val === undefined, z.boolean()).default(true),
  STRICT_MIGRATIONS: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().optional().or(z.literal('')),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().optional(),
  METRICS_TOKEN: z.string().optional(),
  ENABLE_SWAGGER: booleanFlag,
  // Account lifecycle / e-mail (see modules/mail and .env.coolify.example)
  APP_PUBLIC_URL: z.string().optional(),
  MAIL_TRANSPORT: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().optional(),
  SMTP_SECURE: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_TLS_REJECT_UNAUTHORIZED: z.string().optional(),
  SMTP_TIMEOUT_MS: z.coerce.number().int().optional(),
  SMTP_EHLO_NAME: z.string().optional(),
  MAIL_HTTP_PROVIDER: z.string().optional(),
  MAIL_HTTP_URL: z.string().optional(),
  MAIL_HTTP_API_KEY: z.string().optional(),
  MAIL_HTTP_TIMEOUT_MS: z.coerce.number().int().optional(),
  MAIL_DEV_OUTBOX_TOKEN: z.string().optional(),
  // Unverified accounts may sign in but cannot run analyses / exports (default true).
  EMAIL_VERIFICATION_REQUIRED: booleanFlag,
});

type ParsedEnv = z.infer<typeof envSchema>;

export type EnvConfig = Omit<
  ParsedEnv,
  'DATABASE_URL' | 'JWT_SECRET' | 'S3_ACCESS_KEY' | 'S3_SECRET_KEY' | 'MASTER_ENCRYPTION_KEY' | 'CLAMAV_MOCK_MODE'
> & {
  DATABASE_URL: string;
  JWT_SECRET: string;
  S3_ACCESS_KEY: string;
  S3_SECRET_KEY: string;
  MASTER_ENCRYPTION_KEY: string;
  CLAMAV_MOCK_MODE: boolean;
};

/**
 * Local development / test defaults. These are NEVER applied when
 * NODE_ENV=production: the corresponding variables are required there.
 */
export const NON_PRODUCTION_DEFAULTS = {
  DATABASE_URL: 'postgres://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev',
  JWT_SECRET: 'dev-only-jwt-secret-not-for-production-0123456789abcdef',
  S3_ACCESS_KEY: 'minioadmin',
  S3_SECRET_KEY: 'minioadmin',
  MASTER_ENCRYPTION_KEY: 'dev-only-master-key-not-for-production-0123456789abcdef',
} as const;

/** Well-known values that must never be accepted as production secrets. */
const KNOWN_INSECURE_SECRETS = new Set<string>([
  ...Object.values(NON_PRODUCTION_DEFAULTS),
  'secret-key-must-be-at-least-32-chars-long-abcdef123456',
  'erppreflight-default-master-key-32-chars-minimum-abcdef',
  'super-secret-development-jwt-key-minimum-32-chars-long',
  'minioadmin',
  'dev_test_signing_secret_key_only',
]);

const PRODUCTION_REQUIRED_SECRETS = [
  'DATABASE_URL',
  'JWT_SECRET',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'MASTER_ENCRYPTION_KEY',
] as const;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    console.error('Environment validation error:', parsed.error.format());
    throw new Error('Environment configuration validation failed');
  }

  const env = { ...parsed.data } as Record<string, any>;
  const isProduction = env.NODE_ENV === 'production';
  const errors: string[] = [];

  for (const key of PRODUCTION_REQUIRED_SECRETS) {
    const value = env[key];
    if (typeof value === 'string' && value.trim() !== '') {
      if (isProduction && key !== 'DATABASE_URL' && KNOWN_INSECURE_SECRETS.has(value)) {
        errors.push(`${key} uses a publicly known default value`);
      }
      continue;
    }
    if (isProduction) {
      errors.push(`${key} is required when NODE_ENV=production`);
    } else {
      env[key] = NON_PRODUCTION_DEFAULTS[key];
    }
  }

  if (isProduction && typeof env.MASTER_ENCRYPTION_KEY === 'string' && env.MASTER_ENCRYPTION_KEY.length < 32) {
    errors.push('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }

  // Antivirus must fail closed in production unless explicitly overridden.
  if (env.CLAMAV_MOCK_MODE === undefined) {
    env.CLAMAV_MOCK_MODE = !isProduction;
  }

  errors.push(...resolveMailConfig(env).errors);

  if (errors.length > 0) {
    console.error(`Environment validation error:\n - ${errors.join('\n - ')}`);
    throw new Error('Environment configuration validation failed');
  }

  return env as EnvConfig;
}
