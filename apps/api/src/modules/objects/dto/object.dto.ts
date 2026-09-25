import { IsString, IsOptional, IsEnum, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class QueryObjectsDto {
  @ApiPropertyOptional({ description: 'Search term for name or description' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Filter by SAP object type (comma-separated or single)' })
  @IsOptional()
  @IsString()
  objectType?: string;

  @ApiPropertyOptional({ description: 'Filter by Clean Core tier (comma-separated or single)' })
  @IsOptional()
  @IsString()
  cleanCoreTier?: string;

  @ApiPropertyOptional({ description: 'Filter by package' })
  @IsOptional()
  @IsString()
  package?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Page size', default: 50 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  pageSize?: number;

  @ApiPropertyOptional({ description: 'Field to sort by' })
  @IsOptional()
  @IsString()
  sortField?: string;

  @ApiPropertyOptional({ description: 'Sort order', enum: ['asc', 'desc'] })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortOrder?: 'asc' | 'desc';
}

export class CreateSapObjectDto {
  @ApiProperty({ description: 'SAP object name (e.g. Z_I_SalesOrderEnhanced)' })
  @IsString()
  name!: string;

  @ApiProperty({ description: 'Technical object type (e.g. CDS, TABL, CLAS)' })
  @IsString()
  objectType!: string;

  @ApiPropertyOptional({ description: 'Human-readable description' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: 'Development package / class', default: '$TMP' })
  @IsOptional()
  @IsString()
  package?: string;

  @ApiPropertyOptional({ description: 'Software component', default: 'ZCUSTOM' })
  @IsOptional()
  @IsString()
  softwareComponent?: string;

  @ApiPropertyOptional({ description: 'Clean Core tier', default: 'TIER_1_CLOUD' })
  @IsOptional()
  @IsString()
  cleanCoreTier?: string;

  @ApiPropertyOptional({ description: 'Modification status', default: 'CUSTOM_Z' })
  @IsOptional()
  @IsString()
  modificationStatus?: string;

  @ApiPropertyOptional({ description: 'Complexity metrics' })
  @IsOptional()
  complexity?: any;

  @ApiPropertyOptional({ description: 'Inbound and outbound dependencies' })
  @IsOptional()
  dependencies?: any[];

  @ApiPropertyOptional({ description: 'Associated transport request' })
  @IsOptional()
  @IsString()
  transportRequest?: string;
}
