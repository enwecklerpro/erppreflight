import type { ConfigService } from '@nestjs/config';
import { AI_TASKS, SELF_HOSTED_PROVIDERS, isAiTaskType, type AiExternalProvider, type ResolvedAiTaskPolicy } from './ai-governance.types';
import { defaultModelFor, defaultProviderFrom, envOllamaBaseUrl } from './ai-provider-defaults';

/** Platform default policy of a task (no AI Admin override): env provider, task default token limit, no ceiling. */
export function defaultAiTaskPolicy(task: string, config?: ConfigService | null): ResolvedAiTaskPolicy {
  const known = isAiTaskType(task) ? AI_TASKS[task] : null;
  return {
    task,
    configured: false,
    enabled: true,
    provider: defaultProviderFrom(config),
    primaryModel: null,
    fallbackProvider: null,
    fallbackModel: null,
    maxTokens: known?.defaultMaxTokens ?? 512,
    temperature: null,
    privacyMode: 'STANDARD',
    costCeilingEurMonthly: null,
    inputPriceEurPer1k: 0,
    outputPriceEurPer1k: 0,
    killedProviders: [],
    endpointOverrides: {},
  };
}

export interface AiRouteCandidate {
  provider: AiExternalProvider;
  model: string;
  /** Base URL for OpenAI-compatible self-hosted providers (null for fixed cloud endpoints). */
  endpoint: string | null;
  role: 'PRIMARY' | 'FALLBACK';
}

export type AiRouteBlock = 'TASK_DISABLED' | 'KILL_SWITCH' | 'PRIVACY_MODE' | 'NO_PROVIDER';

export interface AiRoute {
  candidates: AiRouteCandidate[];
  /** Why no candidate is left (null when at least one candidate may be called). */
  blocked: AiRouteBlock | null;
  /** Providers skipped because of a kill switch (never called). */
  killed: AiExternalProvider[];
}

/**
 * Pure routing decision of the AI gateway (spec 10.11): primary then fallback provider,
 * skipping any provider whose global kill switch is active and — in SELF_HOSTED_ONLY
 * privacy mode — every provider outside the operator's infrastructure. A killed provider
 * is never part of the result, so it is never called.
 */
export function routeAiCandidates(
  policy: ResolvedAiTaskPolicy,
  preferred: AiExternalProvider | null,
  config?: ConfigService | null
): AiRoute {
  if (!policy.enabled) return { candidates: [], blocked: 'TASK_DISABLED', killed: [] };
  const killedSet = new Set(policy.killedProviders);
  const wanted: Array<{ provider: AiExternalProvider; model: string | null; role: 'PRIMARY' | 'FALLBACK' }> = [];
  const primary = preferred ?? policy.provider;
  if (primary) wanted.push({ provider: primary, model: primary === policy.provider ? policy.primaryModel : null, role: 'PRIMARY' });
  if (policy.fallbackProvider) wanted.push({ provider: policy.fallbackProvider, model: policy.fallbackModel, role: 'FALLBACK' });

  const candidates: AiRouteCandidate[] = [];
  const killed: AiExternalProvider[] = [];
  let privacySkipped = false;
  for (const w of wanted) {
    if (killedSet.has(w.provider)) {
      if (!killed.includes(w.provider)) killed.push(w.provider);
      continue;
    }
    if (policy.privacyMode === 'SELF_HOSTED_ONLY' && !SELF_HOSTED_PROVIDERS.has(w.provider)) {
      privacySkipped = true;
      continue;
    }
    const model = w.model ?? defaultModelFor(w.provider, config);
    if (candidates.some((c) => c.provider === w.provider && c.model === model)) continue;
    const endpoint = SELF_HOSTED_PROVIDERS.has(w.provider)
      ? (policy.endpointOverrides[w.provider] ?? envOllamaBaseUrl(config)).replace(/\/+$/, '')
      : null;
    candidates.push({ provider: w.provider, model, endpoint, role: w.role });
  }
  let blocked: AiRouteBlock | null = null;
  if (candidates.length === 0) blocked = killed.length > 0 ? 'KILL_SWITCH' : privacySkipped ? 'PRIVACY_MODE' : 'NO_PROVIDER';
  return { candidates, blocked, killed };
}

/** Rough prompt size estimate (4 characters per token) for the worst-case cost projection. */
export function estimateTokens(...texts: string[]): number {
  return Math.ceil(texts.reduce((n, t) => n + t.length, 0) / 4);
}
