import { Injectable } from '@nestjs/common';
import { TenancyContext, TenantContext } from '@erppreflight/tenancy';

@Injectable()
export class TenancyService {
  getCurrentTenant(): TenantContext | undefined {
    return TenancyContext.get();
  }

  getCurrentTenantId(): string {
    return TenancyContext.getTenantId();
  }
}
