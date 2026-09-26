import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Audited } from '../audit/audited.decorator';
import { RouterService } from './router.service';

/** AI Problem Router (Part 05 §5.1): advisory engine routing, never findings. */
@Controller('router')
@UseGuards(JwtAuthGuard, TenancyGuard)
export class RouterController {
  constructor(private readonly router: RouterService) {}

  @Post('route')
  @HttpCode(200)
  @Audited({
    action: 'router.routed',
    targetType: 'ROUTING',
    targetId: ({ result }) => result?.routingId,
    payload: ({ result }) => ({
      classifierVersion: result?.classifierVersion ?? null,
      engines: (result?.suggestions ?? []).map((s: any) => `${s.engine}:${s.role}`),
      ai: result?.ai?.status ?? null,
      aiModel: result?.ai?.model ?? null,
      aiTokens: result?.ai?.tokens ?? null,
    }),
  })
  async route(@CurrentTenant() tenantId: string, @CurrentUser('id') userId: string, @Body() body: unknown) {
    return this.router.route(tenantId, userId, body);
  }

  @Get('engines')
  async engines() {
    return this.router.engineCatalog();
  }
}
