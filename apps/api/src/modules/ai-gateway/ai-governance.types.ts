import { z } from 'zod';

/** External model providers the gateway can call (DETERMINISTIC_FALLBACK is not a provider). */
export const AI_PROVIDERS = ['ANTHROPIC', 'OPENAI', 'OLLAMA_LOCAL'] as const;
export type AiExternalProvider = (typeof AI_PROVIDERS)[number];

/** Self-hosted providers: prompts never leave the operator's infrastructure. */
export const SELF_HOSTED_PROVIDERS: ReadonlySet<AiExternalProvider> = new Set(['OLLAMA_LOCAL']);

export const AI_PRIVACY_MODES = ['STANDARD', 'SELF_HOSTED_ONLY'] as const;
export type AiPrivacyMode = (typeof AI_PRIVACY_MODES)[number];

/**
 * AI task types used by the gateway and the Problem Router (spec 10.11 "configure per task").
 * The key is the `purpose` passed to AiGatewayService.completeJson().
 */
export const AI_TASKS = {
  problem_routing: { defaultMaxTokens: 400, usedBy: 'Problem Router AI refinement (POST /router/route with useAi)' },
  intent_classification: { defaultMaxTokens: 512, usedBy: 'Intent classification (POST /ai/classify-intent)' },
  finding_explanation: { defaultMaxTokens: 800, usedBy: 'Finding explanation (POST /ai/explain-finding)' },
} as const;
export type AiTaskType = keyof typeof AI_TASKS;
export const AI_TASK_TYPES = Object.keys(AI_TASKS) as AiTaskType[];

export function isAiTaskType(value: string): value is AiTaskType {
  return Object.prototype.hasOwnProperty.call(AI_TASKS, value);
}

/** Hosts that must never receive prompts (cloud metadata services). */
const METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', '100.100.100.200', '[fd00:ec2::254]', 'fd00:ec2::254']);

/**
 * Self-hosted endpoint override (operator configuration, SUPER_ADMIN only, audited).
 * A local model normally runs on the operator's private network, so private and loopback
 * hosts are allowed like OLLAMA_BASE_URL; credentials, query strings, fragments and cloud
 * metadata hosts are rejected.
 */
export const AiEndpointUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((raw) => {
    try {
      const u = new URL(raw);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      if (u.username || u.password || u.search || u.hash) return false;
      return !METADATA_HOSTS.has(u.hostname.toLowerCase());
    } catch {
      return false;
    }
  }, 'endpointUrl must be an http(s) URL without credentials, query or fragment');

const ModelSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9._:/@-]+$/, 'model identifiers contain letters, digits and . _ : / @ - only');

const MoneySchema = z.number().finite().min(0).max(1_000_000);

export const AiTaskConfigSchema = z
  .object({
    enabled: z.boolean(),
    provider: z.enum(AI_PROVIDERS).nullable(),
    primaryModel: ModelSchema.nullable(),
    fallbackProvider: z.enum(AI_PROVIDERS).nullable(),
    fallbackModel: ModelSchema.nullable(),
    maxTokens: z.number().int().min(64).max(4096),
    temperature: z.number().min(0).max(2).nullable(),
    privacyMode: z.enum(AI_PRIVACY_MODES),
    costCeilingEurMonthly: MoneySchema.nullable(),
    inputPriceEurPer1k: MoneySchema,
    outputPriceEurPer1k: MoneySchema,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.fallbackModel && !v.fallbackProvider) {
      ctx.addIssue({ code: 'custom', path: ['fallbackProvider'], message: 'fallbackModel requires fallbackProvider' });
    }
    if (v.privacyMode === 'SELF_HOSTED_ONLY') {
      for (const key of ['provider', 'fallbackProvider'] as const) {
        const p = v[key];
        if (p && !SELF_HOSTED_PROVIDERS.has(p)) {
          ctx.addIssue({ code: 'custom', path: [key], message: 'SELF_HOSTED_ONLY allows self-hosted providers (OLLAMA_LOCAL) only' });
        }
      }
    }
    if (v.costCeilingEurMonthly !== null && v.inputPriceEurPer1k === 0 && v.outputPriceEurPer1k === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputPriceEurPer1k'],
        message: 'a cost ceiling needs token prices (EUR per 1,000 tokens) to compute spend',
      });
    }
  });
export type AiTaskConfigInput = z.infer<typeof AiTaskConfigSchema>;

export const AiProviderControlSchema = z
  .object({
    killSwitch: z.boolean(),
    reason: z.string().trim().max(500).nullable().optional(),
    endpointUrl: AiEndpointUrlSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => !v.killSwitch || (v.reason ?? '').length >= 5, {
    path: ['reason'],
    message: 'a reason (min. 5 characters) is required when the kill switch is activated',
  });
export type AiProviderControlInput = z.infer<typeof AiProviderControlSchema>;

/** Effective policy for one task at call time (config row merged with defaults and provider controls). */
export interface ResolvedAiTaskPolicy {
  task: string;
  configured: boolean;
  enabled: boolean;
  provider: AiExternalProvider | null;
  primaryModel: string | null;
  fallbackProvider: AiExternalProvider | null;
  fallbackModel: string | null;
  maxTokens: number;
  temperature: number | null;
  privacyMode: AiPrivacyMode;
  costCeilingEurMonthly: number | null;
  inputPriceEurPer1k: number;
  outputPriceEurPer1k: number;
  killedProviders: AiExternalProvider[];
  endpointOverrides: Partial<Record<AiExternalProvider, string>>;
}
