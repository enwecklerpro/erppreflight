import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { RegisterAgentDto, SubmitProposalDto } from './dto/agent-gate.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AgentGateService {
  private readonly logger = new Logger(AgentGateService.name);

  constructor(
    private readonly db: DatabaseService,
    @Optional() private readonly outbox?: OutboxService
  ) {}

  async registerAgent(organizationId: string, userId: string, dto: RegisterAgentDto) {
    const id = uuidv4();
    const res = await this.db.query(
      `INSERT INTO registered_agents (
        id, organization_id, name, runtime, max_risk_class, approval_mode, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        id,
        organizationId,
        dto.name,
        dto.runtime || 'MCP_CLIENT',
        dto.maxRiskClass || 'MEDIUM',
        dto.approvalMode || 'APPROVAL_REQUIRED',
        userId,
      ]
    );
    return res.rows[0];
  }

  async getAgents(organizationId: string) {
    const res = await this.db.query(
      `SELECT * FROM registered_agents WHERE organization_id = $1 ORDER BY created_at DESC`,
      [organizationId]
    );
    return res.rows;
  }

  async submitProposal(organizationId: string, dto: SubmitProposalDto) {
    // 1. Verify Agent
    const agentRes = await this.db.query(
      `SELECT * FROM registered_agents WHERE id = $1 AND organization_id = $2`,
      [dto.agentId, organizationId]
    );
    if (!agentRes.rows?.length) {
      throw new NotFoundException(`Registered agent with ID '${dto.agentId}' not found`);
    }

    const id = uuidv4();
    const proposalPayload = JSON.stringify({
      projectId: dto.projectId,
      agentId: dto.agentId,
      changeType: dto.changeType,
      proposedDiff: dto.proposedDiff,
      targetEnv: dto.targetEnvironment || 'QA',
    });
    const proposalHash = crypto.createHash('sha256').update(proposalPayload).digest('hex');

    // 2. Evaluate Preflight Policy & Verdict (Part 19.5 - 19.6)
    let verdict = 'CLEAR';
    const diffStr = JSON.stringify(dto.proposedDiff).toUpperCase();

    if (dto.targetEnvironment === 'PROD') {
      verdict = 'HUMAN_REVIEW_REQUIRED';
    } else if (diffStr.includes('DROP TABLE') || diffStr.includes('DELETE FROM BKPF')) {
      verdict = 'BLOCKED';
    } else if (diffStr.includes('DEPRECATED') || diffStr.includes('YY1_')) {
      verdict = 'CLEAR_WITH_WARNINGS';
    }

    const verdictDetails = {
      evaluatedAt: new Date().toISOString(),
      verdict,
      reasons: [
        verdict === 'BLOCKED'
          ? 'Direct mutation of standard tables violates Clean Core policy.'
          : verdict === 'HUMAN_REVIEW_REQUIRED'
          ? 'Autonomous write to PROD requires manual architect dual-approval.'
          : 'Change proposal passed preflight static analysis gates.',
      ],
      allowedEnvironments: ['DEV', 'QA'],
    };

    const res = await this.db.query(
      `INSERT INTO agent_proposals (
        id, organization_id, project_id, agent_id, change_type, proposed_diff,
        proposal_hash, target_environment, verdict, verdict_details, approval_status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING_REVIEW')
      RETURNING *`,
      [
        id,
        organizationId,
        dto.projectId,
        dto.agentId,
        dto.changeType,
        JSON.stringify(dto.proposedDiff),
        proposalHash,
        dto.targetEnvironment || 'QA',
        verdict,
        JSON.stringify(verdictDetails),
      ]
    );

    const row = res.rows[0];
    if (this.outbox) {
      await this.outbox
        .recordEvent(organizationId, 'agent.proposal_verdict', 'AGENT_PROPOSAL', row.id, {
          proposalId: row.id,
          agentId: dto.agentId,
          projectId: dto.projectId,
          verdict,
          proposalHash,
          targetEnvironment: row.target_environment,
        })
        .catch(() => {});
    }

    return row;
  }

  async getProposals(organizationId: string, projectId: string) {
    const res = await this.db.query(
      `SELECT p.*, a.name as agent_name
       FROM agent_proposals p
       JOIN registered_agents a ON p.agent_id = a.id
       WHERE p.organization_id = $1 AND p.project_id = $2
       ORDER BY p.created_at DESC`,
      [organizationId, projectId]
    );
    return res.rows;
  }

  async approveProposal(organizationId: string, proposalId: string, userId: string) {
    const res = await this.db.query(
      `SELECT * FROM agent_proposals WHERE id = $1 AND organization_id = $2`,
      [proposalId, organizationId]
    );
    if (!res.rows?.length) {
      throw new NotFoundException(`Proposal ${proposalId} not found`);
    }
    const prop = res.rows[0];

    if (prop.verdict === 'BLOCKED') {
      throw new BadRequestException('Cannot approve proposal with BLOCKED verdict');
    }

    // Generate short-lived Execution Token (Part 19.9) - 15 minutes TTL
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const nonce = crypto.randomBytes(8).toString('hex');
    const tokenSignature = crypto
      .createHmac('sha256', process.env.JWT_SECRET || 'erp_secret_key')
      .update(`${prop.id}:${prop.proposal_hash}:${nonce}:${expiresAt.toISOString()}`)
      .digest('hex');

    const executionToken = `EXEC_${Buffer.from(
      JSON.stringify({
        proposalId: prop.id,
        proposalHash: prop.proposal_hash,
        targetEnv: prop.target_environment,
        expiresAt: expiresAt.toISOString(),
        nonce,
        sig: tokenSignature,
      })
    ).toString('base64url')}`;

    const updateRes = await this.db.query(
      `UPDATE agent_proposals
       SET approval_status = 'APPROVED',
           execution_token = $1,
           token_expires_at = $2,
           reviewed_by = $3,
           reviewed_at = NOW()
       WHERE id = $4 AND organization_id = $5
       RETURNING *`,
      [executionToken, expiresAt.toISOString(), userId, proposalId, organizationId]
    );

    const approvedProposal = updateRes.rows[0];

    if (this.outbox) {
      await this.outbox
        .recordEvent(organizationId, 'agent.proposal_approved', 'AGENT_PROPOSAL', approvedProposal.id, {
          proposalId: approvedProposal.id,
          agentId: prop.agent_id,
          projectId: prop.project_id,
          proposalHash: prop.proposal_hash,
          approvedBy: userId,
          expiresAt: expiresAt.toISOString(),
        })
        .catch(() => {});
    }

    return {
      proposal: approvedProposal,
      executionToken,
      expiresAt: expiresAt.toISOString(),
    };
  }
}
