'use client';

import { useMemo } from 'react';
import { useLocale } from '../client';
import { localizeRule, type LocalizedRuleText } from './index';

/** Display text (title + remediation) of a finding in the active UI language. */
export function useLocalizedRule(
  ruleId: string | null | undefined,
  title: string | null | undefined,
  remediation: string | null | undefined
): LocalizedRuleText {
  const locale = useLocale();
  return useMemo(() => localizeRule(locale, ruleId, title, remediation), [locale, ruleId, title, remediation]);
}
