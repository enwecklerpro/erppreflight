import { Controller, Get, UseGuards } from '@nestjs/common';
import { EnginesService } from './engines.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenancyGuard } from '../tenancy/tenancy.guard';

@Controller('engines')
export class EnginesController {
  constructor(private readonly enginesService: EnginesService) {}

  @Get('status')
  async getStatus() {
    return this.enginesService.getEngineStatus();
  }
}
