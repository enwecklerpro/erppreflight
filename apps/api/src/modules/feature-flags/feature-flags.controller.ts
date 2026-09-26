import { BadRequestException, Body, Controller, Delete, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { FeatureFlagKeySchema, FeatureFlagUpsertSchema } from '@erppreflight/schemas';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { SuperAdminGuard } from '../admin/guards/super-admin.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { EntitlementsService } from '../billing/entitlements.service';
import { DatabaseService } from '../database/database.service';
import { FeatureFlagsService } from './feature-flags.service';

function parseKey(key: string): string {
  const parsed = FeatureFlagKeySchema.safeParse(key);
  if (!parsed.success) throw new BadRequestException(parsed.error.issues[0]?.message ?? 'Invalid flag key');
  return parsed.data;
}

/** Evaluated flags for the calling user in the current tenant. */
@Controller('feature-flags')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class FeatureFlagsController {
  constructor(
    private readonly flags: FeatureFlagsService,
    private readonly entitlements: EntitlementsService,
    private readonly db: DatabaseService
  ) {}

  @Get()
  async evaluate(@CurrentTenant() tenantId: string, @Req() req: any) {
    const [plan, beta] = await Promise.all([
      this.entitlements.getPlanState(tenantId),
      this.db.query(`SELECT beta_opt_in FROM organizations WHERE id = $1`, [tenantId], { bypassRls: true }),
    ]);
    const evaluations = await this.flags.evaluateAll({
      organizationId: tenantId,
      userId: req.user?.id ?? null,
      planTier: plan.effectiveTier,
      betaOptIn: Boolean(beta.rows?.[0]?.beta_opt_in),
    });
    return { environment: this.flags.environment(), flags: evaluations };
  }
}

/** Super Admin management (no redeploy needed; cached ≤15 s per instance). */
@Controller('admin/feature-flags')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class FeatureFlagsAdminController {
  constructor(private readonly flags: FeatureFlagsService) {}

  @Get()
  async list() {
    return { environment: this.flags.environment(), flags: await this.flags.list(true) };
  }

  @Put(':key')
  async upsert(@Param('key') key: string, @Body() body: unknown, @Req() req: any) {
    const parsed = FeatureFlagUpsertSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid feature flag: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
      );
    }
    return this.flags.upsert(parseKey(key), parsed.data, {
      id: req.user?.id ?? null,
      organizationId: req.user?.organizationId ?? null,
      email: req.user?.email ?? null,
    });
  }

  @Delete(':key')
  async remove(@Param('key') key: string, @Req() req: any) {
    return this.flags.remove(parseKey(key), {
      id: req.user?.id ?? null,
      organizationId: req.user?.organizationId ?? null,
      email: req.user?.email ?? null,
    });
  }
}
