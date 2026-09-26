import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { AuthRateLimitGuard } from './guards/auth-rate-limit.guard';
import { VerifiedEmailGuard } from './guards/verified-email.guard';
import { ActionTokenStore } from './action-token.store';
import { EmailVerificationService } from './email-verification.service';
import { AccountSecurityService } from './account-security.service';
import { TwoFactorService } from './two-factor.service';
import { SecurityAuditService } from './security-audit.service';
import { SessionService } from './session.service';
import { SessionCookieService } from './session-cookie';
import { CsrfGuard } from './csrf.guard';
import { MagicLinkService } from './magic-link.service';
import { MagicLinkController } from './magic-link.controller';

import { ApiKeysModule } from '../api-keys/api-keys.module';
import { MailModule } from '../mail/mail.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    ApiKeysModule,
    MailModule,
    AuditModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Validated in config/env.validation.ts (required in production, no fallback here)
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: (config.get<string>('JWT_EXPIRES_IN') || '7d') as any,
        },
      }),
    }),
  ],
  controllers: [AuthController, MagicLinkController],
  providers: [
    AuthService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    AuthRateLimitGuard,
    VerifiedEmailGuard,
    ActionTokenStore,
    EmailVerificationService,
    AccountSecurityService,
    TwoFactorService,
    SecurityAuditService,
    SessionService,
    SessionCookieService,
    MagicLinkService,
    // CSRF protection for every cookie-authenticated unsafe request (csrf.guard.ts).
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
  exports: [
    AuthService,
    JwtAuthGuard,
    RolesGuard,
    VerifiedEmailGuard,
    AuthRateLimitGuard,
    JwtModule,
    AccountSecurityService,
    TwoFactorService,
    SecurityAuditService,
    SessionService,
    SessionCookieService,
    MailModule,
  ],
})
export class AuthModule {}
