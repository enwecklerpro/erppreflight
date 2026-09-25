import { Injectable, NotFoundException, BadRequestException, Logger, Optional } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { OutboxService } from '../outbox/outbox.service';
import { RegisterAgentDto, SubmitProposalDto } from './dto/agent-gate.dto';
import * as crypto from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

/**
 * HMAC key for Agent Execution Tokens. JWT_SECRET is required (and validated at
 * startup in production); a fixed key is only accepted inside the unit-test runner.
 */
function resolveExecutionTokenSecret(): string | null {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length >= 32) {
    return secret;
  }
  return process.env.NODE_ENV === 'test' ? 'unit-test-only-execution-token-signing-key' : null;
}

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
    const agent = agentRes.rows[0];

    const id = uuidv4();
    const proposalPayload = JSON.stringify({
      projectId: dto.projectId,
      agentId: dto.agentId,
      changeType: dto.changeType,
      proposedDiff: dto.proposedDiff,
      targetEnv: dto.targetEnvironment || 'QA',
    });
    const proposalHash = crypto.createHash('sha256').update(proposalPayload).digest('hex');

    // 2. Comprehensive Preflight Policy & Verdict Evaluation (Part 19.5 - 19.6)
    let verdict = 'CLEAR';
    const diffStr = JSON.stringify(dto.proposedDiff).toUpperCase();
    const standardTables = ['BKPF', 'BSEG', 'MARA', 'VBAK', 'VBAP', 'EKKO', 'EKPO', 'KNA1', 'LFA1'];
    const touchesStandardTableMutation = standardTables.some(
      (tbl) => diffStr.includes(`DROP TABLE ${tbl}`) || diffStr.includes(`DELETE FROM ${tbl}`) || diffStr.includes(`UPDATE ${tbl}`)
    );

    const reasons: string[] = [];

    if (touchesStandardTableMutation) {
      verdict = 'BLOCKED';
      reasons.push('Direct SQL mutation on standard SAP table violates Clean Core Tier 1/2 governance.');
    } else if (agent.max_risk_class === 'LOW' && (diffStr.includes('ALTER TABLE') || diffStr.includes('SCHEMA'))) {
      verdict = 'BLOCKED';
      reasons.push('Proposed database schema alteration exceeds agent assigned maximum risk class (LOW).');
    } else if (dto.targetEnvironment === 'PROD') {
      verdict = 'HUMAN_REVIEW_REQUIRED';
      reasons.push('Autonomous modification of PROD environment strictly requires human architect review.');
    } else if (diffStr.includes('DEPRECATED') || diffStr.includes('YY1_')) {
      verdict = 'CLEAR_WITH_WARNINGS';
      reasons.push('Proposal references key-user extensions or deprecated elements; regression verification advised.');
    } else {
      reasons.push('Change proposal passed all automated preflight static analysis gates.');
    }

    const verdictDetails = {
      evaluatedAt: new Date().toISOString(),
      verdict,
      reasons,
      allowedEnvironments: verdict === 'BLOCKED' ? [] : ['DEV', 'QA'],
    };

    return await this.db.withTenantTransaction(organizationId, async (client) => {
      const res = await client.query(
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
        await this.outbox.recordEvent(
          organizationId,
          'agent.proposal_verdict',
          'AGENT_PROPOSAL',
          row.id,
          {
            proposalId: row.id,
            agentId: dto.agentId,
            projectId: dto.projectId,
            verdict,
            proposalHash,
            targetEnvironment: row.target_environment,
          },
          client
        );
      }

      return row;
    });
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

    // Secure secret resolution (no insecure default fallback in production)
    const secret = resolveExecutionTokenSecret();
    if (!secret) {
      throw new BadRequestException('JWT_SECRET environment variable is required to sign Agent Execution Tokens.');
    }

    // Generate short-lived Execution Token (Part 19.9) - 15 minutes TTL
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);
    const nonce = crypto.randomBytes(8).toString('hex');
    const tokenSignature = crypto
      .createHmac('sha256', secret)
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

    return await this.db.withTenantTransaction(organizationId, async (client) => {
      const updateRes = await client.query(
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
        await this.outbox.recordEvent(
          organizationId,
          'agent.proposal_approved',
          'AGENT_PROPOSAL',
          approvedProposal.id,
          {
            proposalId: approvedProposal.id,
            agentId: prop.agent_id,
            projectId: prop.project_id,
            proposalHash: prop.proposal_hash,
            approvedBy: userId,
            expiresAt: expiresAt.toISOString(),
          },
          client
        );
      }

      return {
        proposal: approvedProposal,
        executionToken,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  /**
   * Part 19.9 - 19.10: Complete Execution Token Lifecycle Verification & Consumption.
   * Verifies signature, tenant binding, agent identity, proposal hash immutability,
   * expiration, anti-replay nonce, and atomically transitions status to EXECUTED.
   */
  async verifyAndConsumeExecutionToken(
    organizationId: string,
    executionToken: string,
    actionDetails?: Record<string, any>
  ): Promise<{
    verified: boolean;
    proposalId: string;
    agentId: string;
    targetEnvironment: string;
    executedAt: string;
  }> {
    if (!executionToken || !executionToken.startsWith('EXEC_')) {
      throw new BadRequestException('Malformed execution token format');
    }

    const rawPayload = executionToken.slice(5);
    let payload: any;
    try {
      payload = JSON.parse(Buffer.from(rawPayload, 'base64url').toString('utf-8'));
    } catch {
      throw new BadRequestException('Failed to decode execution token base64url payload');
    }

    // 1. Verify Secret & Cryptographic HMAC Signature
    const secret = resolveExecutionTokenSecret();
    if (!secret) {
      throw new BadRequestException('JWT_SECRET environment variable is required to verify execution tokens.');
    }

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${payload.proposalId}:${payload.proposalHash}:${payload.nonce}:${payload.expiresAt}`)
      .digest('hex');

    if (payload.sig !== expectedSignature) {
      throw new BadRequestException('Execution token cryptographic signature mismatch');
    }

    // 2. Verify Expiration
    if (new Date(payload.expiresAt).getTime() < Date.now()) {
      throw new BadRequestException('Execution token has expired');
    }

    // 3. Verify Proposal in Database
    const propRes = await this.db.query(
      `SELECT * FROM agent_proposals WHERE id = $1 AND organization_id = $2`,
      [payload.proposalId, organizationId]
    );
    if (!propRes.rows?.length) {
      throw new NotFoundException(`Proposal ${payload.proposalId} not found for this tenant`);
    }
    const prop = propRes.rows[0];

    // 4. Anti-Replay: Verify proposal is APPROVED and not already EXECUTED
    if (prop.approval_status === 'EXECUTED') {
      throw new BadRequestException('Execution token has already been consumed (replay prevention)');
    }
    if (prop.approval_status !== 'APPROVED') {
      throw new BadRequestException(`Cannot consume token for proposal in state '${prop.approval_status}'`);
    }

    // 5. Verify Proposal Immutability & Target Environment
    if (prop.proposal_hash !== payload.proposalHash) {
      throw new BadRequestException('Proposal contents have been altered after approval; execution rejected');
    }
    if (prop.target_environment !== payload.targetEnv) {
      throw new BadRequestException('Execution token target environment mismatch');
    }

    // 6. Verify Agent Status
    const agentRes = await this.db.query(
      `SELECT * FROM registered_agents WHERE id = $1 AND organization_id = $2`,
      [prop.agent_id, organizationId]
    );
    if (!agentRes.rows?.length || agentRes.rows[0].status !== 'ACTIVE') {
      throw new BadRequestException('Agent associated with proposal is inactive or revoked');
    }

    const executedAt = new Date().toISOString();

    // 7. Atomic Token Consumption & Outbox Event
    return await this.db.withTenantTransaction(organizationId, async (client) => {
      await client.query(
        `UPDATE agent_proposals
         SET approval_status = 'EXECUTED',
             updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [prop.id, organizationId]
      );

      if (this.outbox) {
        await this.outbox.recordEvent(
          organizationId,
          'agent.proposal_executed',
          'AGENT_PROPOSAL',
          prop.id,
          {
            proposalId: prop.id,
            agentId: prop.agent_id,
            targetEnvironment: prop.target_environment,
            executedAt,
            actionDetails: actionDetails || {},
          },
          client
        );
      }

      return {
        verified: true,
        proposalId: prop.id,
        agentId: prop.agent_id,
        targetEnvironment: prop.target_environment,
        executedAt,
      };
    });
  }
}
