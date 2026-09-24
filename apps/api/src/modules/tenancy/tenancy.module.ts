import { Module, Global } from '@nestjs/common';
import { TenancyService } from './tenancy.service';
import { TenancyGuard } from './tenancy.guard';

@Global()
@Module({
  providers: [TenancyService, TenancyGuard],
  exports: [TenancyService, TenancyGuard],
})
export class TenancyModule {}
