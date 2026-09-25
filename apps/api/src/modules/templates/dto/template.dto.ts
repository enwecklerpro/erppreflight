import { IsString, IsNotEmpty, IsArray, IsOptional } from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  description: string;

  @IsString()
  @IsNotEmpty()
  targetDomain: string;

  @IsArray()
  engines: string[];

  @IsArray()
  @IsOptional()
  requiredInputs?: string[];

  @IsArray()
  @IsOptional()
  optionalInputs?: string[];

  @IsArray()
  @IsOptional()
  standardChecks?: string[];

  @IsString()
  @IsOptional()
  reportType?: string;
}

export class ApplyTemplateDto {
  @IsString()
  @IsNotEmpty()
  projectId: string;
}
