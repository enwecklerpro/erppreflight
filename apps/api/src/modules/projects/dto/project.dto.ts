import { IsNotEmpty, IsOptional, IsString, IsIn } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  targetRelease?: string;
}

export class UpdateProjectDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  targetRelease?: string;
}

export class SetBaselineDto {
  @IsString()
  @IsNotEmpty()
  analysisId: string;
}

