import { Controller, Get, Response, HttpStatus } from '@nestjs/common';
import { Response as ExpressResponse } from 'express';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('liveness')
  getLiveness() {
    return this.healthService.getLiveness();
  }

  @Get('readiness')
  async getReadiness(@Response({ passthrough: true }) res: ExpressResponse) {
    const health = await this.healthService.getReadiness();
    if (health.status !== 'ready') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }
}
