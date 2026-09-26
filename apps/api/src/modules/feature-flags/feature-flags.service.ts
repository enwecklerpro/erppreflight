import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'node:crypto';
import {
  FeatureFlag,
  FeatureFlagEvaluation,
  FeatureFlagUpsert,
  PlanTierId,
} from '@erppreflight/schemas';
import { DatabaseService } from '../database/database.service';
import { AuditService } from '../audit/audit.service';

export interface FlagContext {
  environment: string;
  organizationId?: string | null;
  userId?: string | null;
  planTier?: PlanTierId | null;
  betaOptIn?: boolean;
}

/** Stable 0..99 bucket for (flag, subject); the same user always lands in the same cohort. */
export function rolloutBucket(flagKey: string, subject: string): number {
  const digest = crypto.createHash('sha256').update(`${flagKey}:${subject}`).digest();
  return digest.readUInt32BE(0) % 100;
}

/**
 * Pure evaluation (unit-tested). Order: kill switch → environment → org deny
 * → org allow → plan → beta → percentage rollout.
 */
export function evaluateFlag(flag: FeatureFlag, ctx: FlagContext): FeatureFlagEvaluation {
  const key = flag.key;
  if (!flag.enabled) return { key, enabled: false, reason: 'KILL_SWITCH_OFF' };
  if (flag.environments.length > 0 && !flag.environments.includes(ctx.environment as any)) {
    return { key, enabled: false, reason: 'ENVIRONMENT_EXCLUDED' };
  }
  if (ctx.organizationId && flag.denyOrganizations.includes(ctx.organizationId)) {
    return { key, enabled: false, reason: 'ORGANIZATION_DENIED' };
  }
  if (ctx.organizationId && flag.allowOrganizations.includes(ctx.organizationId)) {
    return { key, enabled: true, reason: 'ORGANIZATION_ALLOWED' };
  }
  if (flag.planTiers.length > 0 && (!ctx.planTier || !flag.planTiers.includes(ctx.planTier))) {
    return { key, enabled: false, reason: 'PLAN_EXCLUDED' };
  }
  if (flag.betaOnly && !ctx.betaOptIn) return { key, enabled: false, reason: 'BETA_ONLY' };
  if (flag.rolloutPercentage < 100) {
    const subject = ctx.userId || ctx.organizationId;
    if (!subject || rolloutBucket(key, subject) >= flag.rolloutPercentage) {
      return { key, enabled: false, reason: 'OUTSIDE_ROLLOUT' };
    }
  }
  return { key, enabled: true, reason: 'ENABLED' };
}

function toFlag(row: any): FeatureFlag {
  const arr = (v: unknown) => (Array.isArray(v) ? v : []);
  return {
    key: row.key,
    description: row.description ?? '',
    enabled: Boolean(row.enabled),
    environments: arr(row.environments),
    planTiers: arr(row.plan_tiers),
    allowOrganizations: arr(row.allow_organizations),
    denyOrganizations: arr(row.deny_organizations),
    rolloutPercentage: Number(row.rollout_percentage ?? 100),
    betaOnly: Boolean(row.beta_only),
    updatedBy: row.updated_by ?? null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

const CACHE_TTL_MS = 15_000;

/**
 * Admin-managed feature flags. Changes take effect without a redeploy: reads
 * are cached per API instance for at most 15 s and invalidated on write.
 */
@Injectable()
export class FeatureFlagsService {
  private readonly logger = new Logger(FeatureFlagsService.name);
  private cache: { at: number; flags: FeatureFlag[] } | null = null;

  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Optional() private readonly audit?: AuditService
  ) {}

  environment(): string {
    return this.config.get<string>('NODE_ENV') || process.env.NODE_ENV || 'development';
  }

  async list(fresh = false): Promise<FeatureFlag[]> {
    if (!fresh && this.cache && Date.now() - this.cache.at < CACHE_TTL_MS) return this.cache.flags;
    const res = await this.db.query(`SELECT * FROM feature_flags ORDER BY key`, [], { bypassRls: true });
    const flags = (res.rows ?? []).map(toFlag);
    this.cache = { at: Date.now(), flags };
    return flags;
  }

  async evaluateAll(ctx: Omit<FlagContext, 'environment'>): Promise<FeatureFlagEvaluation[]> {
    const env = this.environment();
    return (await this.list()).map((f) => evaluateFlag(f, { ...ctx, environment: env }));
  }

  async isEnabled(key: string, ctx: Omit<FlagContext, 'environment'>): Promise<boolean> {
    const flag = (await this.list()).find((f) => f.key === key);
    if (!flag) return false;
    return evaluateFlag(flag, { ...ctx, environment: this.environment() }).enabled;
  }

  async upsert(
    key: string,
    dto: FeatureFlagUpsert,
    actor: { id: string | null; organizationId?: string | null; email?: string | null }
  ): Promise<FeatureFlag> {
    const before = (await this.list(true)).find((f) => f.key === key) ?? null;
    const res = await this.db.query(
      `INSERT INTO feature_flags (key, description, enabled, environments, plan_tiers, allow_organizations,
                                  deny_organizations, rollout_percentage, beta_only, updated_by, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, NOW())
       ON CONFLICT (key) DO UPDATE SET
         description = EXCLUDED.description, enabled = EXCLUDED.enabled, environments = EXCLUDED.environments,
         plan_tiers = EXCLUDED.plan_tiers, allow_organizations = EXCLUDED.allow_organizations,
         deny_organizations = EXCLUDED.deny_organizations, rollout_percentage = EXCLUDED.rollout_percentage,
         beta_only = EXCLUDED.beta_only, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [
        key,
        dto.description,
        dto.enabled,
        JSON.stringify(dto.environments),
        JSON.stringify(dto.planTiers),
        JSON.stringify(dto.allowOrganizations),
        JSON.stringify(dto.denyOrganizations),
        dto.rolloutPercentage,
        dto.betaOnly,
        actor.id,
      ],
      { bypassRls: true }
    );
    this.cache = null;
    const flag = toFlag(res.rows[0]);
    await this.auditChange(before ? 'admin.feature_flag.updated' : 'admin.feature_flag.created', flag.key, actor, {
      enabled: flag.enabled,
      environments: flag.environments,
      planTiers: flag.planTiers,
      rolloutPercentage: flag.rolloutPercentage,
      betaOnly: flag.betaOnly,
      allowOrganizations: flag.allowOrganizations.length,
      denyOrganizations: flag.denyOrganizations.length,
      previousEnabled: before?.enabled ?? null,
    });
    return flag;
  }

  async remove(key: string, actor: { id: string | null; organizationId?: string | null; email?: string | null }) {
    const res = await this.db.query(`DELETE FROM feature_flags WHERE key = $1 RETURNING key`, [key], { bypassRls: true });
    if (!res.rows?.length) throw new NotFoundException(`Feature flag '${key}' not found`);
    this.cache = null;
    await this.auditChange('admin.feature_flag.deleted', key, actor, {});
    return { deleted: key };
  }

  /**
   * Flags are platform configuration; the change is recorded (fail-closed) in
   * the acting super admin's own organization ledger.
   */
  private async auditChange(
    action: string,
    key: string,
    actor: { id: string | null; organizationId?: string | null; email?: string | null },
    payload: Record<string, unknown>
  ) {
    if (!this.audit || !actor.organizationId) {
      this.logger.warn(`${action} '${key}' not audited: no actor organization`);
      return;
    }
    await this.audit.recordEvent({
      organizationId: actor.organizationId,
      action,
      resourceType: 'FEATURE_FLAG',
      payload: { flagKey: key, byEmail: actor.email ?? null, ...payload },
      actorType: 'HUMAN',
      actorId: actor.id,
    });
  }
}
