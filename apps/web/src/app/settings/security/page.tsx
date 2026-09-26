'use client';

import { SettingsNav } from '@/components/settings/settings-nav';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { TwoFactorPanel } from '@/components/account/two-factor-panel';
import { SessionsPanel } from '@/components/account/sessions-panel';
import { OrgSecurityPanel } from '@/components/account/org-security-panel';
import { useT } from '@/i18n/client';

export default function SecuritySettingsPage() {
  const t = useT();
  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold tracking-tight mb-1">{t('app.security.title')}</h1>
      <p className="text-sm text-muted-foreground mb-4">{t('app.security.subtitle')}</p>
      <SettingsNav />
      <div className="space-y-6">
        <TwoFactorPanel />
        <ChangePasswordForm />
        <SessionsPanel />
        <OrgSecurityPanel />
      </div>
    </div>
  );
}
