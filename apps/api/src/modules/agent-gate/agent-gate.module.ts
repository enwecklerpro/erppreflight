import { Module } from '@nestjs/common';
import { AgentGateService } from './agent-gate.service';
import { AgentGateController } from './agent-gate.controller';
import { DatabaseModule } from '../database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [AgentGateController],
  providers: [AgentGateService],
  exports: [AgentGateService],
})
export class AgentGateModule {}
