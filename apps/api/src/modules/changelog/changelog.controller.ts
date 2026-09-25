import { Controller, Get, Query } from '@nestjs/common';
import { ChangelogService } from './changelog.service';

@Controller('changelog')
export class ChangelogController {
  constructor(private readonly changelogService: ChangelogService) {}

  @Get()
  async getChangelogs(@Query('category') category?: string) {
    return this.changelogService.listChangelogs(category);
  }
}
