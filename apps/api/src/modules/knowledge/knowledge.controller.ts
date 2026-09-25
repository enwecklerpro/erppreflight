import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { KnowledgeService } from './knowledge.service';

@ApiTags('Release Governance & Knowledge')
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get('matrix')
  @ApiOperation({ summary: 'Get canonical SAP Release Compatibility Matrix across all 19 engines' })
  async getMatrix() {
    return await this.knowledgeService.getMatrix();
  }

  @Get('snapshots')
  @ApiOperation({ summary: 'Get immutable SAP knowledge snapshots with cryptographic checksums' })
  async getSnapshots() {
    return await this.knowledgeService.getSnapshots();
  }

  @Get('stability')
  @ApiOperation({ summary: 'Get shadow evaluation finding stability metrics and rule churn rates' })
  getFindingStability() {
    return this.knowledgeService.getFindingStabilityDiff();
  }
}
