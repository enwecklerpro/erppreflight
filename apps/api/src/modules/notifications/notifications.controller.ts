import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { DenyApiKeyAuth } from '../api-keys/api-key-scopes';
import { zodParse } from '../knowledge-graph/zod-parse';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_EVENT_TYPES, NOTIFICATION_LOCALES } from './notification-renderer';

const ListQuerySchema = z.object({
  status: z.enum(['all', 'unread']).default('all'),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().datetime().optional(),
});

const PreferencesSchema = z.object({
  items: z
    .array(
      z.object({
        eventType: z.enum(NOTIFICATION_EVENT_TYPES),
        inApp: z.boolean().optional(),
        email: z.boolean().optional(),
      })
    )
    .min(1)
    .max(NOTIFICATION_EVENT_TYPES.length),
});

const LocaleSchema = z.object({ locale: z.enum(NOTIFICATION_LOCALES) }).strict();

/** Personal notification inbox (the caller's notifications in the active organization). */
@ApiTags('Notifications')
@ApiBearerAuth()
@DenyApiKeyAuth()
@UseGuards(JwtAuthGuard, TenancyGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List my notifications (newest first, cursor pagination via `before`)' })
  list(@CurrentTenant() orgId: string, @Req() req: any, @Query() query: Record<string, unknown>) {
    return this.notifications.list(orgId, req.user.id, zodParse(ListQuerySchema, query));
  }

  @Get('unread-count')
  unread(@CurrentTenant() orgId: string, @Req() req: any) {
    return this.notifications.unreadCount(orgId, req.user.id);
  }

  @Get('channels')
  @ApiOperation({ summary: 'Which delivery channels are active (e-mail uses the platform mail transport)' })
  channels() {
    return this.notifications.channels();
  }

  @Post('read-all')
  @HttpCode(200)
  readAll(@CurrentTenant() orgId: string, @Req() req: any) {
    return this.notifications.markAllRead(orgId, req.user.id);
  }

  @Post(':id/read')
  @HttpCode(200)
  read(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.setRead(orgId, req.user.id, id, true);
  }

  @Post(':id/unread')
  @HttpCode(200)
  unreadOne(@CurrentTenant() orgId: string, @Req() req: any, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.notifications.setRead(orgId, req.user.id, id, false);
  }

  @Get('preferences')
  preferences(@CurrentTenant() orgId: string, @Req() req: any) {
    return this.notifications.preferences(orgId, req.user.id);
  }

  @Put('preferences')
  updatePreferences(@CurrentTenant() orgId: string, @Req() req: any, @Body() body: unknown) {
    return this.notifications.updatePreferences(orgId, req.user.id, zodParse(PreferencesSchema, body).items);
  }

  @Get('locale')
  @ApiOperation({ summary: 'Language of my notification texts and e-mails (en | de; English when never set)' })
  locale(@Req() req: any) {
    return this.notifications.emailLocale(req.user.id);
  }

  @Put('locale')
  @ApiOperation({ summary: 'Set the language of my notification texts and e-mails' })
  setLocale(@Req() req: any, @Body() body: unknown) {
    return this.notifications.setEmailLocale(req.user.id, zodParse(LocaleSchema, body).locale);
  }
}
