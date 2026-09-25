import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { TelemetryService } from './telemetry.service';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('Telemetry & Observability')
@Controller()
export class TelemetryController {
  constructor(private readonly telemetryService: TelemetryService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({
    summary: 'Prometheus Plaintext Metrics Endpoint',
    description:
      'Exports application throughput, preflight engine runs, rule evaluation volume, and outbox lag.',
  })
  @ApiResponse({ status: 200, description: 'Prometheus metrics successfully returned' })
  async getMetrics(): Promise<string> {
    return await this.telemetryService.getPrometheusMetrics();
  }

  @Get('telemetry/summary')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Telemetry Summary for the tenant' })
  @ApiResponse({ status: 200, description: 'Summary successfully returned' })
  async getSummary(@CurrentTenant() tenantId: string) {
    return this.telemetryService.getTenantSummary(tenantId);
  }
}
