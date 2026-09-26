import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { SupportService } from './support.service';
import { SupportAdminController, SupportController } from './support.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [SupportController, SupportAdminController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
