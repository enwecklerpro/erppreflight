import { Module } from '@nestjs/common';
import { EnginesController } from './engines.controller';
import { EnginesService } from './engines.service';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [EnginesController],
  providers: [EnginesService],
  exports: [EnginesService],
})
export class EnginesModule {}
