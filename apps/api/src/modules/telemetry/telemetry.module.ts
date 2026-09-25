import { Module, Global, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';
import { TelemetryMiddleware } from './telemetry.middleware';

@Global()
@Module({
  imports: [DatabaseModule],
  controllers: [TelemetryController],
  providers: [TelemetryService],
  exports: [TelemetryService],
})
export class TelemetryModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TelemetryMiddleware).forRoutes('*');
  }
}
