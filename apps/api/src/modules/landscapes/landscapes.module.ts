import { Module } from '@nestjs/common';
import { LandscapesService } from './landscapes.service';
import { LandscapesController } from './landscapes.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [LandscapesController],
  providers: [LandscapesService],
  exports: [LandscapesService],
})
export class LandscapesModule {}
