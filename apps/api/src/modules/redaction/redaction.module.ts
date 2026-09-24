import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SecretRedactorService } from './secret-redactor.service';

@Module({
  imports: [ConfigModule],
  providers: [SecretRedactorService],
  exports: [SecretRedactorService],
})
export class RedactionModule {}
