import { Finding, Severity, ConfidenceClass, CleanCoreTier, EngineType } from '@erppreflight/schemas';
import { FilterDef } from '../data-table/types';

export interface FindingFilterState {
  severity?: Severity[];
  confidence?: ConfidenceClass[];
  cleanCoreTier?: CleanCoreTier[];
  engineType?: EngineType[];
  search?: string;
}

export interface FindingDetailRowProps {
  finding: Finding;
  onCopySuccess?: (label: string) => void;
}

export interface SeverityBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  severity: Severity;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}

export interface ConfidenceBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  confidence: ConfidenceClass;
  score?: number;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}

export interface CleanCoreBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tier?: CleanCoreTier | null;
  size?: 'sm' | 'default';
  showIcon?: boolean;
}
