import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Get,
  UseGuards,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  AuthRateLimit,
  AuthRateLimitGuard,
  LOGIN_RATE_LIMIT,
  REGISTER_RATE_LIMIT,
} from './guards/auth-rate-limit.guard';

export const SESSION_COOKIE_NAME = 'erppreflight_session';
export const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(REGISTER_RATE_LIMIT)
  async register(
    @Body() dto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(dto);
    if (res && typeof res.cookie === 'function') {
      res.cookie(SESSION_COOKIE_NAME, result.accessToken, SESSION_COOKIE_OPTIONS);
    }
    return result;
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AuthRateLimitGuard)
  @AuthRateLimit(LOGIN_RATE_LIMIT)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    if (res && typeof res.cookie === 'function') {
      res.cookie(SESSION_COOKIE_NAME, result.accessToken, SESSION_COOKIE_OPTIONS);
    }
    return result;
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Res({ passthrough: true }) res: Response) {
    if (res && typeof res.clearCookie === 'function') {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    }
    return { success: true, message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  async me(@CurrentUser() user: any) {
    return { user };
  }
}

