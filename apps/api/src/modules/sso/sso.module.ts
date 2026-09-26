import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorsModule } from '../connectors/connectors.module';
import { SsoService } from './sso.service';
import { ScimService } from './scim.service';
import { ScimController, SsoAdminController, SsoLoginController } from './sso.controller';

/**
 * Enterprise identity (C §8.4): OIDC SSO + SCIM 2.0. Kept separate from the auth
 * module; sessions are issued through AuthService.issueSessionForMembership.
 */
@Module({
  imports: [DatabaseModule, AuthModule, ConnectorsModule],
  controllers: [SsoAdminController, SsoLoginController, ScimController],
  providers: [SsoService, ScimService],
  exports: [SsoService, ScimService],
})
export class SsoModule {}
