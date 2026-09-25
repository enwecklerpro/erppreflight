import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum } from 'class-validator';

export class CreateChangeSetDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  targetEnvironment?: string;

  @IsString()
  @IsOptional()
  targetRelease?: string;

  @IsString()
  @IsOptional()
  baselineAnalysisId?: string;

  @IsArray()
  @IsNotEmpty()
  proposedChanges: Array<{
    type: 'MODIFY_OPD_RULE' | 'REMOVE_CUSTOM_FIELD' | 'MIGRATE_API_VERSION' | 'SPLIT_TRANSPORT' | 'CUSTOM_CODE_REFACTOR';
    targetObject: string;
    details: Record<string, any>;
  }>;
}

export class ApproveChangeSetDto {
  @IsString()
  @IsNotEmpty()
  reason: string;
}
