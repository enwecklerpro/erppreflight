import { z } from 'zod';

export const AgentPublisherEnum = z.enum([
  'SAP_JOULE',
  'ANTHROPIC_CLAUDE',
  'OPENAI_AGENT',
  'INTERNAL_CI_BOT',
  'PARTNER_COPILOT',
  'OTHER',
]);
export type AgentPublisher = z.infer<typeof AgentPublisherEnum>;

export const AgentStatusEnum = z.enum(['ACTIVE', 'SUSPENDED', 'REVOKED']);
export type AgentStatus = z.infer<typeof AgentStatusEnum>;

export const AgentVerdictEnum = z.enum([
  'CLEAR',
  'CLEAR_WITH_WARNINGS',
  'BLOCKED',
  'HUMAN_REVIEW_REQUIRED',
  'INSUFFICIENT_EVIDENCE',
]);
export type AgentVerdict = z.infer<typeof AgentVerdictEnum>;

export const AgentIdentitySchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  name: z.string().min(2),
  publisher: AgentPublisherEnum,
  runtime: z.string(),
  allowedEnvironments: z.array(z.string()).default(['DEV', 'QA']),
  allowedProjects: z.array(z.string()).default(['*']),
  scopes: z.array(z.string()).default(['preflight:read', 'simulation:propose']),
  maxRiskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED']).default('MEDIUM'),
  status: AgentStatusEnum.default('ACTIVE'),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentIdentity = z.infer<typeof AgentIdentitySchema>;

export const RegisterAgentIdentitySchema = z.object({
  name: z.string().min(2),
  publisher: AgentPublisherEnum,
  runtime: z.string().default('MCP_SERVER'),
  allowedEnvironments: z.array(z.string()).default(['DEV', 'QA']),
  allowedProjects: z.array(z.string()).default(['*']),
  scopes: z.array(z.string()).default(['preflight:read', 'simulation:propose']),
  maxRiskTier: z.enum(['LOW', 'MEDIUM', 'HIGH', 'RESTRICTED']).default('MEDIUM'),
});
export type RegisterAgentIdentityDto = z.infer<typeof RegisterAgentIdentitySchema>;

export const AgentChangeProposalSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  agentId: z.string().uuid(),
  projectId: z.string().uuid(),
  changeSetId: z.string().uuid().nullable().optional(),
  targetEnvironment: z.enum(['DEV', 'QA', 'STAGING', 'PROD']),
  changeType: z.string(),
  businessReason: z.string(),
  proposedDiff: z.record(z.any()),
  proposalHash: z.string().length(64),
  verdict: AgentVerdictEnum,
  verdictDetails: z.object({
    policyViolations: z.array(z.string()).default([]),
    criticalFindingsCount: z.number().default(0),
    blockerFindingsCount: z.number().default(0),
    requiredRegressionTests: z.array(z.string()).default([]),
    humanApprovalMandatory: z.boolean().default(false),
  }),
  approvalStatus: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
  reviewedBy: z.string().uuid().nullable().optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
  reviewNotes: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type AgentChangeProposal = z.infer<typeof AgentChangeProposalSchema>;

export const SubmitAgentProposalSchema = z.object({
  agentId: z.string().uuid(),
  projectId: z.string().uuid(),
  targetEnvironment: z.enum(['DEV', 'QA', 'STAGING', 'PROD']),
  changeType: z.string().min(2),
  businessReason: z.string().min(5),
  proposedDiff: z.record(z.any()),
});
export type SubmitAgentProposalDto = z.infer<typeof SubmitAgentProposalSchema>;

export const ReviewAgentProposalSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED', 'CHANGES_REQUESTED']),
  expectedProposalHash: z.string().length(64, 'Cryptographic proposal hash must match to prevent race condition/mutation'),
  reviewNotes: z.string().min(5, 'Review explanation is required for enterprise audit compliance'),
});
export type ReviewAgentProposalDto = z.infer<typeof ReviewAgentProposalSchema>;

// MCP JSON-RPC 2.0 & Tool Contracts (Part 16.14)
export const McpToolDefinitionSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.any()),
});
export type McpToolDefinition = z.infer<typeof McpToolDefinitionSchema>;

export const McpCallToolRequestSchema = z.object({
  name: z.string(),
  arguments: z.record(z.any()).default({}),
});
export type McpCallToolRequest = z.infer<typeof McpCallToolRequestSchema>;
