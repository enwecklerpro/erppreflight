import { IsString, IsNotEmpty, IsOptional, IsArray, IsIn, ArrayMaxSize, MaxLength, IsISO8601 } from 'class-validator';
import { API_KEY_SCOPES } from '../api-key-scopes';

export class CreateApiKeyDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(API_KEY_SCOPES.length)
  @IsIn(API_KEY_SCOPES as unknown as string[], { each: true })
  scopes?: string[];

  @IsISO8601()
  @IsOptional()
  expiresAt?: string;
}
