import { Controller, Get, Headers, Query } from '@nestjs/common';
import { resolveRequestLocale } from '../../common/i18n/request-locale';
import { ChangelogService } from './changelog.service';

@Controller('changelog')
export class ChangelogController {
  constructor(private readonly changelogService: ChangelogService) {}

  /** Release notes in the requested language (`?locale=` or Accept-Language; English fallback). */
  @Get()
  async getChangelogs(
    @Query('category') category?: string,
    @Query('locale') locale?: string,
    @Headers('accept-language') acceptLanguage?: string
  ) {
    return this.changelogService.listChangelogs(category, resolveRequestLocale(locale, acceptLanguage));
  }
}
