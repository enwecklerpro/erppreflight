import { IsString, IsNotEmpty, IsEnum, IsOptional, IsObject, IsArray } from 'class-validator';

export enum ScenarioDomain {
  OPD = 'OPD',
  FORM = 'FORM',
  MFS = 'MFS',
  CHANGE_POINTER = 'CHANGE_POINTER',
}

export enum ScenarioFailureType {
  CLEAN_PASS = 'CLEAN_PASS',
  OPD_MISSING_RECIPIENT = 'OPD_MISSING_RECIPIENT',
  OPD_INVALID_CHANNEL = 'OPD_INVALID_CHANNEL',
  OPD_SHADOWED_RULE = 'OPD_SHADOWED_RULE',
  FORM_MISSING_BINDING = 'FORM_MISSING_BINDING',
  FORM_BINDING_MISMATCH = 'FORM_BINDING_MISMATCH',
  FORM_TRUNCATION_RISK = 'FORM_TRUNCATION_RISK',
  MFS_LOCATION_JUMP = 'MFS_LOCATION_JUMP',
  MFS_ACK_TIMEOUT = 'MFS_ACK_TIMEOUT',
  CP_MISSING_FIELD_TRIGGER = 'CP_MISSING_FIELD_TRIGGER',
  CP_GLOBAL_DISABLED = 'CP_GLOBAL_DISABLED',
}

export class GenerateScenarioDto {
  @IsEnum(ScenarioDomain)
  domain: ScenarioDomain;

  @IsEnum(ScenarioFailureType)
  failureType: ScenarioFailureType;

  @IsString()
  @IsOptional()
  scenarioName?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsObject()
  @IsOptional()
  options?: Record<string, any>;
}

export class RunScenarioDto {
  @IsEnum(ScenarioDomain)
  domain: ScenarioDomain;

  @IsString()
  @IsNotEmpty()
  payload: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  scenarioId?: string;

  @IsString()
  @IsOptional()
  scenarioName?: string;

  @IsString()
  @IsOptional()
  targetRelease?: string;

  @IsArray()
  @IsOptional()
  expectedFindings?: Array<{
    ruleId: string;
    severity: string;
    description: string;
  }>;

  @IsObject()
  @IsOptional()
  configuration?: Record<string, any>;

  @IsArray()
  @IsOptional()
  engineTypes?: string[];
}
