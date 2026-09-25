import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { EntitlementGuard, RequireEntitlement } from '../billing/guards/entitlement.guard';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AgentGateService } from './agent-gate.service';
import { RegisterAgentDto, SubmitProposalDto } from './dto/agent-gate.dto';

@ApiTags('Agentic Change Gate')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, EntitlementGuard)
@Controller('agent-gate')
export class AgentGateController {
  constructor(private readonly agentGateService: AgentGateService) {}

  @Post('agents')
  @ApiOperation({ summary: 'Register an external AI Agent or MCP Client' })
  async registerAgent(@Req() req: any, @Body() dto: RegisterAgentDto) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.agentGateService.registerAgent(orgId, userId, dto);
  }

  @Get('agents')
  @ApiOperation({ summary: 'List all registered agents' })
  async getAgents(@Req() req: any) {
    const orgId = req.user.organizationId;
    return await this.agentGateService.getAgents(orgId);
  }

  @Post('propose')
  @RequireEntitlement('AGENT_GATE')
  @ApiOperation({ summary: 'Submit an agent-generated ChangeProposal for preflight simulation & verdict' })
  async propose(@Req() req: any, @Body() dto: SubmitProposalDto) {
    const orgId = req.user.organizationId;
    return await this.agentGateService.submitProposal(orgId, dto);
  }

  @Get('projects/:projectId/proposals')
  @ApiOperation({ summary: 'List all change proposals for a project' })
  async getProposals(@Req() req: any, @Param('projectId') projectId: string) {
    const orgId = req.user.organizationId;
    return await this.agentGateService.getProposals(orgId, projectId);
  }

  @Post('proposals/:id/approve')
  @ApiOperation({ summary: 'Human approval issuing a cryptographic short-lived Execution Token' })
  async approve(@Req() req: any, @Param('id') proposalId: string) {
    const orgId = req.user.organizationId;
    const userId = req.user.userId;
    return await this.agentGateService.approveProposal(orgId, proposalId, userId);
  }

  @Post('proposals/:id/execute')
  async executeProposal(
    @CurrentTenant() tenantId: string,
    @CurrentUser('id') userId: string,
    @Param('id') proposalId: string,
    @Body() body: { executionToken: string },
  ) {
    return this.agentGateService.verifyAndConsumeExecutionToken(
      tenantId,
      body.executionToken,
    );
  }
}
