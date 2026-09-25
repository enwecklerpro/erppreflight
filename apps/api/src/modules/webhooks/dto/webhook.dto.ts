import { IsString, IsNotEmpty, IsOptional, IsArray, IsUrl } from 'class-validator';

export class CreateWebhookDto {
  @IsUrl()
  @IsNotEmpty()
  url: string;

  @IsArray()
  @IsOptional()
  events?: string[];
}
