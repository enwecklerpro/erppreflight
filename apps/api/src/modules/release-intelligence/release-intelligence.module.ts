import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ReleaseIntelligenceController } from './release-intelligence.controller';
import { ReleaseIntelligenceService } from './release-intelligence.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ReleaseIntelligenceController],
  providers: [ReleaseIntelligenceService],
  exports: [ReleaseIntelligenceService],
})
export class ReleaseIntelligenceModule {}
