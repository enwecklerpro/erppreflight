export interface ImportAtcDto {
  fileName?: string;
  format?: 'XML' | 'JSON' | 'CSV';
  rawContent: string;
}

export interface ImportReadinessDto {
  fileName?: string;
  sourceAnalysisId?: string;
  targetRelease?: string;
  rawContent: string;
}

export interface ImportFioriUsageDto {
  fileName?: string;
  rawContent: string;
}
