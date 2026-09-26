import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { RouterController } from './router.controller';
import { RouterService } from './router.service';

@Module({
  imports: [JobsModule, AiGatewayModule],
  controllers: [RouterController],
  providers: [RouterService],
})
export class ProblemRouterModule {}
