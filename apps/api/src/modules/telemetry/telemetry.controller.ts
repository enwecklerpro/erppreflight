import { Controller, Get, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { TelemetryService } from './telemetry.service';

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
}
