import { IsNotEmpty, IsOptional, IsArray, IsUrl, IsString, ArrayMaxSize, MaxLength } from 'class-validator';

export class CreateWebhookDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: true })
  @IsNotEmpty()
  @MaxLength(2048)
  url: string;

  @IsArray()
  @IsOptional()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  events?: string[];
}
