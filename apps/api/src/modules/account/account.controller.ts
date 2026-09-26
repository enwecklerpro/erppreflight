import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Req, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { DeleteAccountDto } from '../auth/dto/auth.dto';
import { SESSION_COOKIE_NAME, requestMeta } from '../auth/auth.controller';
import { AccountDataService } from './account-data.service';

/** Self-service GDPR endpoints for the signed-in user (interactive sessions only). */
@Controller('account')
@UseGuards(JwtAuthGuard)
@DenyApiKeyAuth()
export class AccountController {
  constructor(private readonly accountData: AccountDataService) {}

  @Get('export')
  async export(@CurrentUser('id') userId: string, @Req() req: Request): Promise<StreamableFile> {
    const data = await this.accountData.exportAccount(userId, requestMeta(req));
    const buffer = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
    return new StreamableFile(buffer, {
      type: 'application/json',
      disposition: `attachment; filename="erppreflight-account-export-${new Date().toISOString().slice(0, 10)}.json"`,
      length: buffer.length,
    });
  }

  @Get('deletion-impact')
  async deletionImpact(@CurrentUser('id') userId: string) {
    return this.accountData.deletionImpact(userId);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  async delete(
    @CurrentUser('id') userId: string,
    @Body() dto: DeleteAccountDto,
    @Res({ passthrough: true }) res: Response,
    @Req() req: Request
  ) {
    const result = await this.accountData.deleteAccount(
      userId,
      {
        password: dto.password,
        factor: { code: dto.code, recoveryCode: dto.recoveryCode },
        confirmOrganizationDeletion: dto.confirmOrganizationDeletion,
      },
      requestMeta(req)
    );
    if (res && typeof res.clearCookie === 'function') {
      res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    }
    return result;
  }
}
