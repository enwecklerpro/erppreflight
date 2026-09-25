import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateLandscapeDto {
  @IsString()
  @IsNotEmpty()
  systemId: string;

  @IsString()
  @IsNotEmpty()
  product: string;

  @IsString()
  @IsNotEmpty()
  edition: string;

  @IsString()
  @IsNotEmpty()
  release: string;

  @IsString()
  @IsNotEmpty()
  environment: string;

  @IsString()
  @IsOptional()
  url?: string;

  @IsString()
  @IsOptional()
  businessRole?: string;

  @IsString()
  @IsOptional()
  criticality?: string;
}
