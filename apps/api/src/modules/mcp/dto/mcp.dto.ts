import { IsString, IsNotEmpty, IsOptional, IsObject } from 'class-validator';

export class McpRpcRequestDto {
  @IsString()
  @IsNotEmpty()
  jsonrpc: string;

  @IsString()
  @IsNotEmpty()
  method: string;

  @IsOptional()
  params?: Record<string, any>;

  @IsOptional()
  id?: string | number;
}
