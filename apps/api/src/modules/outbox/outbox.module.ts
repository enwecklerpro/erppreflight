import { Module, Global } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { DatabaseModule } from '../database/database.module';

@Global()
@Module({
  imports: [DatabaseModule],
  providers: [OutboxService],
  exports: [OutboxService],
})
export class OutboxModule {}
