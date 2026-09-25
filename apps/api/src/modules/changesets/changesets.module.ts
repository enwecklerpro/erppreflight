import { Module } from '@nestjs/common';
import { ChangeSetsService } from './changesets.service';
import { ChangeSetsController } from './changesets.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [ChangeSetsController],
  providers: [ChangeSetsService],
  exports: [ChangeSetsService],
})
export class ChangeSetsModule {}
