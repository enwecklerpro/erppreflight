import {
  Injectable,
  CanActivate,
  ExecutionContext,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { DatabaseService } from '../database/database.service';
import { cookieExtractor } from '../auth/strategies/jwt.strategy';

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Protects the Prometheus endpoint. Access is granted to:
 *  1. a scraper presenting `Authorization: Bearer <METRICS_TOKEN>` (when METRICS_TOKEN is set), or
 *  2. an authenticated, ACTIVE SUPER_ADMIN session (JWT bearer or session cookie).
 * Everyone else gets 401 (or 404 in production when no METRICS_TOKEN is configured,
 * so the endpoint is not advertised).
 */
@Injectable()
export class MetricsAccessGuard implements CanActivate {
  private readonly jwt = new JwtService({});

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const metricsToken = this.config.get<string>('METRICS_TOKEN');
    const auth = typeof req.headers?.authorization === 'string' ? req.headers.authorization : '';
    const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

    if (metricsToken && metricsToken.length >= 16 && bearer && safeEqual(bearer, metricsToken)) {
      return true;
    }

    const token = bearer || cookieExtractor(req);
    if (token) {
      try {
        const payload: any = this.jwt.verify(token, {
          secret: this.config.getOrThrow<string>('JWT_SECRET'),
        });
        if (payload?.sub) {
          const res = await this.db.query(
            `SELECT system_role, status FROM users WHERE id = $1`,
            [payload.sub],
            { bypassRls: true }
          );
          const row = res.rows[0];
          if (row?.system_role === 'SUPER_ADMIN' && row.status === 'ACTIVE') {
            return true;
          }
        }
      } catch {
        // fall through to rejection
      }
    }

    if (!metricsToken && this.config.get<string>('NODE_ENV') === 'production') {
      throw new NotFoundException();
    }
    throw new UnauthorizedException('Metrics access requires METRICS_TOKEN or a Super Admin session');
  }
}
