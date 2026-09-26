import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AccountController } from './account.controller';
import { AccountDataService } from './account-data.service';

@Module({
  imports: [AuthModule, OrganizationsModule],
  controllers: [AccountController],
  providers: [AccountDataService],
})
export class AccountModule {}
