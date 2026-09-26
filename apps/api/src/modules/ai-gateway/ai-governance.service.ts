import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DatabaseService } from '../database/database.service';
import {
  AI_PROVIDERS,
  AI_TASKS,
  AI_TASK_TYPES,
  SELF_HOSTED_PROVIDERS,
  isAiTaskType,
  type AiExternalProvider,
  type AiPrivacyMode,
  type AiProviderControlInput,
  type AiTaskConfigInput,
  type AiTaskType,
  type ResolvedAiTaskPolicy,
} from './ai-governance.types';
import { defaultModelFor, defaultProviderFrom, envOllamaBaseUrl, providerCredentialsConfigured } from './ai-provider-defaults';
import { defaultAiTaskPolicy } from './ai-governance.routing';

const TASK_COLUMNS = `task_type, enabled, provider, primary_model, fallback_provider, fallback_model, max_tokens,
  temperature::float AS temperature, privacy_mode, cost_ceiling_eur_monthly::float AS cost_ceiling_eur_monthly,
  input_price_eur_per_1k::float AS input_price_eur_per_1k, output_price_eur_per_1k::float AS output_price_eur_per_1k,
  updated_by, updated_at`;

const MONTH_SQL = `(date_trunc('month', (NOW() AT TIME ZONE 'UTC'))::date)`;

function asProvider(value: unknown): AiExternalProvider | null {
  return typeof value === 'string' && (AI_PROVIDERS as readonly string[]).includes(value) ? (value as AiExternalProvider) : null;
}

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * AI Admin (spec 10.11): per-task model configuration, provider kill switches and the
 * monthly spend ledger used for cost ceilings. The AI gateway resolves the policy on
 * EVERY call (no cache), so a kill switch takes effect for the next request on every
 * API instance. Configuration is platform data: read and written through the login
 * pool (bypassRls), never inside a tenant transaction.
 */
@Injectable()
export class AiGovernanceService {
  private readonly logger = new Logger(AiGovernanceService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly config?: ConfigService
  ) {}

  private defaultPolicy(task: string): ResolvedAiTaskPolicy {
    return defaultAiTaskPolicy(task, this.config);
  }

  /** Effective policy for a task at call time. Fails closed: when the configuration cannot be read, AI is off. */
  async resolvePolicy(task: string): Promise<ResolvedAiTaskPolicy> {
    const [taskRes, controlRes] = await Promise.all([
      this.db.query(`SELECT ${TASK_COLUMNS} FROM ai_task_configs WHERE task_type = $1`, [task], { bypassRls: true }),
      this.db.query(`SELECT provider, kill_switch, endpoint_url FROM ai_provider_controls`, [], { bypassRls: true }),
    ]);
    return this.mergePolicy(task, taskRes?.rows?.[0], controlRes?.rows ?? []);
  }

  /** Config row + provider controls merged over the platform defaults (pure). */
  mergePolicy(task: string, row: any, controls: any[]): ResolvedAiTaskPolicy {
    const policy = this.defaultPolicy(task);
    if (row) {
      policy.configured = true;
      policy.enabled = Boolean(row.enabled);
      policy.provider = asProvider(row.provider) ?? policy.provider;
      policy.primaryModel = row.primary_model ?? null;
      policy.fallbackProvider = asProvider(row.fallback_provider);
      policy.fallbackModel = row.fallback_model ?? null;
      policy.maxTokens = num(row.max_tokens, policy.maxTokens);
      policy.temperature = row.temperature === null || row.temperature === undefined ? null : num(row.temperature, 0);
      policy.privacyMode = (row.privacy_mode === 'SELF_HOSTED_ONLY' ? 'SELF_HOSTED_ONLY' : 'STANDARD') as AiPrivacyMode;
      policy.costCeilingEurMonthly =
        row.cost_ceiling_eur_monthly === null || row.cost_ceiling_eur_monthly === undefined ? null : num(row.cost_ceiling_eur_monthly, 0);
      policy.inputPriceEurPer1k = num(row.input_price_eur_per_1k, 0);
      policy.outputPriceEurPer1k = num(row.output_price_eur_per_1k, 0);
    }
    for (const c of controls) {
      const provider = asProvider(c.provider);
      if (!provider) continue;
      if (c.kill_switch) policy.killedProviders.push(provider);
      if (c.endpoint_url && SELF_HOSTED_PROVIDERS.has(provider)) policy.endpointOverrides[provider] = String(c.endpoint_url);
    }
    return policy;
  }

  /** EUR spent by a task in the current UTC month (all providers/models). */
  async spentThisMonth(task: string): Promise<number> {
    const res = await this.db.query(
      `SELECT COALESCE(SUM(cost_eur), 0)::float AS spent FROM ai_task_spend WHERE task_type = $1 AND period_month = ${MONTH_SQL}`,
      [task],
      { bypassRls: true }
    );
    return num(res?.rows?.[0]?.spent, 0);
  }

  static costOf(policy: Pick<ResolvedAiTaskPolicy, 'inputPriceEurPer1k' | 'outputPriceEurPer1k'>, inputTokens: number, outputTokens: number): number {
    return (Math.max(inputTokens, 0) * policy.inputPriceEurPer1k + Math.max(outputTokens, 0) * policy.outputPriceEurPer1k) / 1000;
  }

  /** Adds one completed call to the monthly ledger; returns the cost charged. Never throws. */
  async recordCall(
    policy: ResolvedAiTaskPolicy,
    provider: AiExternalProvider,
    model: string,
    inputTokens: number,
    outputTokens: number
  ): Promise<number> {
    const cost = AiGovernanceService.costOf(policy, inputTokens, outputTokens);
    try {
      await this.db.query(
        `INSERT INTO ai_task_spend (task_type, period_month, provider, model, requests, input_tokens, output_tokens, cost_eur)
         VALUES ($1, ${MONTH_SQL}, $2, $3, 1, $4, $5, $6)
         ON CONFLICT (task_type, period_month, provider, model) DO UPDATE SET
           requests = ai_task_spend.requests + 1,
           input_tokens = ai_task_spend.input_tokens + EXCLUDED.input_tokens,
           output_tokens = ai_task_spend.output_tokens + EXCLUDED.output_tokens,
           cost_eur = ai_task_spend.cost_eur + EXCLUDED.cost_eur,
           updated_at = NOW()`,
        [policy.task, provider, model.slice(0, 120), Math.max(inputTokens, 0), Math.max(outputTokens, 0), cost],
        { bypassRls: true }
      );
    } catch (err: any) {
      this.logger.error(`AI spend ledger write failed for task ${policy.task}: ${err?.message ?? err}`);
    }
    return cost;
  }

  /** Counts a call refused by governance (kill switch, disabled task, privacy mode or ceiling). Never throws. */
  async recordBlocked(task: string, provider: AiExternalProvider | null): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO ai_task_spend (task_type, period_month, provider, model, blocked_requests)
         VALUES ($1, ${MONTH_SQL}, $2, '', 1)
         ON CONFLICT (task_type, period_month, provider, model) DO UPDATE SET
           blocked_requests = ai_task_spend.blocked_requests + 1, updated_at = NOW()`,
        [task, provider ?? 'NONE'],
        { bypassRls: true }
      );
    } catch (err: any) {
      this.logger.error(`AI blocked-request ledger write failed for task ${task}: ${err?.message ?? err}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Admin API
  // ---------------------------------------------------------------------------

  async overview() {
    const [configs, controls, spend] = await Promise.all([
      this.db.query(`SELECT ${TASK_COLUMNS} FROM ai_task_configs`, [], { bypassRls: true }),
      this.db.query(
        `SELECT provider, kill_switch, kill_reason, killed_at, endpoint_url, updated_at FROM ai_provider_controls`,
        [],
        { bypassRls: true }
      ),
      this.db.query(
        `SELECT task_type, provider, model, requests, blocked_requests, input_tokens::float AS input_tokens,
                output_tokens::float AS output_tokens, cost_eur::float AS cost_eur
           FROM ai_task_spend WHERE period_month = ${MONTH_SQL} ORDER BY task_type, provider, model`,
        [],
        { bypassRls: true }
      ),
    ]);
    const month = new Date();
    const periodMonth = `${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`;
    const configByTask = new Map<string, any>((configs.rows ?? []).map((r: any) => [r.task_type, r]));
    const controlByProvider = new Map<string, any>((controls.rows ?? []).map((r: any) => [r.provider, r]));

    const tasks = AI_TASK_TYPES.map((task) => {
        const policy = this.mergePolicy(task, configByTask.get(task), controls.rows ?? []);
        const rows = (spend.rows ?? []).filter((s: any) => s.task_type === task);
        const totals = rows.reduce(
          (acc: any, s: any) => ({
            requests: acc.requests + num(s.requests, 0),
            blockedRequests: acc.blockedRequests + num(s.blocked_requests, 0),
            inputTokens: acc.inputTokens + num(s.input_tokens, 0),
            outputTokens: acc.outputTokens + num(s.output_tokens, 0),
            costEur: acc.costEur + num(s.cost_eur, 0),
          }),
          { requests: 0, blockedRequests: 0, inputTokens: 0, outputTokens: 0, costEur: 0 }
        );
        const row = configByTask.get(task);
        return {
          task,
          usedBy: AI_TASKS[task].usedBy,
          configured: policy.configured,
          config: {
            enabled: policy.enabled,
            provider: row ? asProvider(row.provider) : null,
            effectiveProvider: policy.provider,
            primaryModel: policy.primaryModel,
            effectiveModel: policy.primaryModel ?? (policy.provider ? defaultModelFor(policy.provider, this.config) : null),
            fallbackProvider: policy.fallbackProvider,
            fallbackModel: policy.fallbackModel,
            maxTokens: policy.maxTokens,
            temperature: policy.temperature,
            privacyMode: policy.privacyMode,
            costCeilingEurMonthly: policy.costCeilingEurMonthly,
            inputPriceEurPer1k: policy.inputPriceEurPer1k,
            outputPriceEurPer1k: policy.outputPriceEurPer1k,
          },
          spend: { periodMonth, ...totals, byProvider: rows.map((s: any) => ({
            provider: s.provider,
            model: s.model,
            requests: num(s.requests, 0),
            blockedRequests: num(s.blocked_requests, 0),
            costEur: num(s.cost_eur, 0),
          })) },
          ceilingReached: policy.costCeilingEurMonthly !== null && totals.costEur >= policy.costCeilingEurMonthly,
          updatedAt: row?.updated_at ?? null,
        };
      });

    const providers = AI_PROVIDERS.map((provider) => {
      const c = controlByProvider.get(provider);
      return {
        provider,
        selfHosted: SELF_HOSTED_PROVIDERS.has(provider),
        killSwitch: Boolean(c?.kill_switch),
        killReason: c?.kill_reason ?? null,
        killedAt: c?.killed_at ?? null,
        endpointUrl: c?.endpoint_url ?? null,
        environmentEndpoint: provider === 'OLLAMA_LOCAL' ? envOllamaBaseUrl(this.config) : null,
        credentialsConfigured: providerCredentialsConfigured(provider, this.config),
        defaultModel: defaultModelFor(provider, this.config),
        updatedAt: c?.updated_at ?? null,
      };
    });

    return {
      defaultProvider: defaultProviderFrom(this.config),
      confidenceCap: 0.6,
      periodMonth,
      tasks,
      providers,
    };
  }

  private assertTask(task: string): asserts task is AiTaskType {
    if (!isAiTaskType(task)) throw new NotFoundException(`Unknown AI task '${task}'`);
  }

  async upsertTask(task: string, input: AiTaskConfigInput, actorId: string | null) {
    this.assertTask(task);
    await this.db.query(
      `INSERT INTO ai_task_configs (task_type, enabled, provider, primary_model, fallback_provider, fallback_model, max_tokens,
                                    temperature, privacy_mode, cost_ceiling_eur_monthly, input_price_eur_per_1k,
                                    output_price_eur_per_1k, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
       ON CONFLICT (task_type) DO UPDATE SET
         enabled = EXCLUDED.enabled, provider = EXCLUDED.provider, primary_model = EXCLUDED.primary_model,
         fallback_provider = EXCLUDED.fallback_provider, fallback_model = EXCLUDED.fallback_model,
         max_tokens = EXCLUDED.max_tokens, temperature = EXCLUDED.temperature, privacy_mode = EXCLUDED.privacy_mode,
         cost_ceiling_eur_monthly = EXCLUDED.cost_ceiling_eur_monthly,
         input_price_eur_per_1k = EXCLUDED.input_price_eur_per_1k, output_price_eur_per_1k = EXCLUDED.output_price_eur_per_1k,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [
        task,
        input.enabled,
        input.provider,
        input.primaryModel,
        input.fallbackProvider,
        input.fallbackModel,
        input.maxTokens,
        input.temperature,
        input.privacyMode,
        input.costCeilingEurMonthly,
        input.inputPriceEurPer1k,
        input.outputPriceEurPer1k,
        actorId,
      ],
      { bypassRls: true }
    );
    this.logger.log(`AI task '${task}' configuration updated (provider=${input.provider ?? 'default'}, enabled=${input.enabled})`);
    return this.taskView(task);
  }

  /** Removes the task override: the task falls back to the platform defaults. */
  async resetTask(task: string) {
    this.assertTask(task);
    await this.db.query(`DELETE FROM ai_task_configs WHERE task_type = $1`, [task], { bypassRls: true });
    return this.taskView(task);
  }

  private async taskView(task: AiTaskType) {
    const all = await this.overview();
    return all.tasks.find((t) => t.task === task)!;
  }

  async setProviderControl(provider: string, input: AiProviderControlInput, actorId: string | null) {
    const p = asProvider(provider);
    if (!p) throw new NotFoundException(`Unknown AI provider '${provider}'`);
    if (input.endpointUrl && !SELF_HOSTED_PROVIDERS.has(p)) {
      throw new BadRequestException(`Provider '${p}' has a fixed endpoint; endpointUrl applies to self-hosted providers only`);
    }
    const res = await this.db.query(
      `INSERT INTO ai_provider_controls (provider, kill_switch, kill_reason, killed_at, endpoint_url, updated_by, updated_at)
       VALUES ($1, $2, $3, CASE WHEN $2 THEN NOW() ELSE NULL END, $4, $5, NOW())
       ON CONFLICT (provider) DO UPDATE SET
         kill_switch = EXCLUDED.kill_switch,
         kill_reason = EXCLUDED.kill_reason,
         killed_at = CASE WHEN EXCLUDED.kill_switch AND NOT ai_provider_controls.kill_switch THEN NOW()
                          WHEN EXCLUDED.kill_switch THEN ai_provider_controls.killed_at ELSE NULL END,
         endpoint_url = CASE WHEN $6 THEN EXCLUDED.endpoint_url ELSE ai_provider_controls.endpoint_url END,
         updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING provider, kill_switch, kill_reason, killed_at, endpoint_url, updated_at`,
      [
        p,
        input.killSwitch,
        input.killSwitch ? (input.reason ?? null) : null,
        input.endpointUrl ?? null,
        actorId,
        input.endpointUrl !== undefined,
      ],
      { bypassRls: true }
    );
    const r = res.rows[0];
    this.logger.warn(`AI provider ${p} kill switch ${r.kill_switch ? 'ACTIVATED' : 'released'}`);
    return {
      provider: r.provider,
      killSwitch: r.kill_switch,
      killReason: r.kill_reason,
      killedAt: r.killed_at,
      endpointUrl: r.endpoint_url,
      updatedAt: r.updated_at,
    };
  }
}
