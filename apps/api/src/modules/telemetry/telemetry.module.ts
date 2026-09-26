import { Module, Global, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DatabaseModule } from '../database/database.module';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryMiddleware } from './telemetry.middleware';
import { MetricsAccessGuard } from './metrics-access.guard';

@Global()
@Module({
  // The analysis queue is registered here too so /metrics can report queue depth.
  imports: [DatabaseModule, BullModule.registerQueue({ name: 'analysis-queue' })],
  controllers: [TelemetryController],
  providers: [TelemetryService, MetricsAccessGuard],
  exports: [TelemetryService],
})
export class TelemetryModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TelemetryMiddleware).forRoutes('*');
  }
}
