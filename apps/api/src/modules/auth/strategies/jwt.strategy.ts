import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { AuthTokenPayload } from '@erppreflight/auth';

import type { Request } from 'express';

export const cookieExtractor = (req: Request | any): string | null => {
  if (!req) return null;
  if (req.cookies && req.cookies['erppreflight_session']) {
    return req.cookies['erppreflight_session'];
  }
  const cookieHeader = req.headers?.cookie;
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)erppreflight_session=([^;]+)/);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return null;
      }
    }
  }
  return null;
};

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        cookieExtractor,
      ]),
      ignoreExpiration: false,
      // Validated in config/env.validation.ts (required in production, no fallback here)
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  async validate(payload: AuthTokenPayload) {
    if (!payload.sub || !payload.organizationId) {
      throw new UnauthorizedException('Invalid token payload');
    }
    return {
      id: payload.sub,
      // Alias used by several controllers (req.user.userId)
      userId: payload.sub,
      email: payload.email,
      organizationId: payload.organizationId,
      role: payload.role,
      systemRole: payload.systemRole || 'USER',
    };
  }
}
