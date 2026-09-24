import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { EnginesModule } from '../engines/engines.module';
import { FindingsModule } from '../findings/findings.module';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [DatabaseModule, EnginesModule, FindingsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
