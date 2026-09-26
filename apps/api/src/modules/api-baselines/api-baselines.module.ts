import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ApiBaselinesController } from './api-baselines.controller';
import { ApiBaselinesService } from './api-baselines.service';

@Module({
  imports: [StorageModule],
  controllers: [ApiBaselinesController],
  providers: [ApiBaselinesService],
  exports: [ApiBaselinesService],
})
export class ApiBaselinesModule {}
