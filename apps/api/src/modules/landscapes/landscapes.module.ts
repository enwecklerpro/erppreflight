import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LandscapesService } from './landscapes.service';
import { LandscapesController } from './landscapes.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [BillingModule, DatabaseModule],
  controllers: [LandscapesController],
  providers: [LandscapesService],
  exports: [LandscapesService],
})
export class LandscapesModule {}
