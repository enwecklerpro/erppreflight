import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class RegisterAgentDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  runtime?: string;

  @IsString()
  @IsOptional()
  maxRiskClass?: string;

  @IsString()
  @IsOptional()
  approvalMode?: string;
}

export class SubmitProposalDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;

  @IsString()
  @IsNotEmpty()
  agentId: string;

  @IsString()
  @IsNotEmpty()
  changeType: string;

  @IsObject()
  @IsNotEmpty()
  proposedDiff: Record<string, any>;

  @IsString()
  @IsOptional()
  targetEnvironment?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
