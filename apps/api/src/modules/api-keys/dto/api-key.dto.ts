import { IsString, IsNotEmpty, IsOptional, IsArray } from 'class-validator';

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsArray()
  @IsOptional()
  scopes?: string[];

  @IsString()
  @IsOptional()
  expiresAt?: string;
}
