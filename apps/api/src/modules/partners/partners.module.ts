import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { PartnersService } from './partners.service';
import { PartnersController } from './partners.controller';

@Module({
  imports: [DatabaseModule, ConnectorsModule],
  controllers: [PartnersController],
  providers: [PartnersService],
  exports: [PartnersService],
})
export class PartnersModule {}
