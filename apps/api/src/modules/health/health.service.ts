import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class HealthService {
  constructor(private readonly db: DatabaseService) {}

  getLiveness() {
    return {
      status: 'ok',
      service: 'erppreflight-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    };
  }

  async getReadiness() {
    const dbResult = await this.db.checkHealth();

    const isReady = dbResult.healthy;

    return {
      status: isReady ? 'ready' : 'degraded',
      service: 'erppreflight-api',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbResult.healthy ? 'healthy' : `unreachable: ${dbResult.error || 'unknown'}`,
      },
    };
  }
}
