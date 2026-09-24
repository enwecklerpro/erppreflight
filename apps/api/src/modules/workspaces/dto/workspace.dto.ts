import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateWorkspaceDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  dataPolicy?: Record<string, unknown>;
}
