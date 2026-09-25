import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';

export class CreateTraceabilityNodeDto {
  @IsString()
  @IsNotEmpty()
  requirementId: string;

  @IsString()
  @IsNotEmpty()
  requirementTitle: string;

  @IsString()
  @IsOptional()
  processHierarchy?: string;

  @IsString()
  @IsOptional()
  findingId?: string;

  @IsString()
  @IsOptional()
  remediationTaskId?: string;

  @IsString()
  @IsOptional()
  taskStatus?: string;

  @IsString()
  @IsOptional()
  testCaseId?: string;

  @IsString()
  @IsOptional()
  defectId?: string;

  @IsString()
  @IsOptional()
  transportId?: string;

  @IsString()
  @IsOptional()
  releaseId?: string;

  @IsString()
  @IsOptional()
  businessCriticality?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

  @IsString()
  @IsOptional()
  externalSystem?: 'SAP_CLOUD_ALM' | 'JIRA' | 'AZURE_DEVOPS';
}

export class CreateRemediationTaskDto {
  @IsString()
  @IsNotEmpty()
  findingId: string;

  @IsString()
  @IsOptional()
  externalSystem?: 'SAP_CLOUD_ALM' | 'JIRA' | 'AZURE_DEVOPS';

  @IsString()
  @IsOptional()
  assignee?: string;
}
