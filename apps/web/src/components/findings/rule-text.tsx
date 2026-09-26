'use client';

import * as React from 'react';
import { useT } from '@/i18n/client';
import { useLocalizedRule } from '@/i18n/rule-catalog/client';

/**
 * Finding title in the UI language: the German rule-catalog title when the UI is German
 * (the engine's finding-specific wording is exposed as tooltip), the engine title otherwise.
 */
export function RuleTitle({ ruleId, title, className }: { ruleId: string; title: string; className?: string }) {
  const t = useT();
  const text = useLocalizedRule(ruleId, title, null);
  return (
    <span className={className} title={text.engineTitle ? t('app.findings.rule.engineTitle', { title: text.engineTitle }) : undefined}>
      {text.title}
    </span>
  );
}

/** Remediation in the UI language; finding-specific engine details stay visible (original wording). */
export function RuleRemediation({ ruleId, title, remediation }: { ruleId: string; title?: string; remediation: string }) {
  const t = useT();
  const text = useLocalizedRule(ruleId, title ?? null, remediation);
  return (
    <>
      {text.remediation}
      {text.engineRemediation && (
        <span className="mt-1 block text-xs opacity-80" lang="en">
          {t('app.findings.rule.engineRemediation')} {text.engineRemediation}
        </span>
      )}
    </>
  );
}
