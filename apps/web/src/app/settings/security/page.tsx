'use client';

import { SettingsNav } from '@/components/account/settings-nav';
import { ChangePasswordForm } from '@/components/account/change-password-form';
import { TwoFactorPanel } from '@/components/account/two-factor-panel';
import { SessionsPanel } from '@/components/account/sessions-panel';
import { OrgSecurityPanel } from '@/components/account/org-security-panel';

export default function SecuritySettingsPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-bold tracking-tight mb-1">Security</h1>
      <p className="text-xs text-muted-foreground mb-4">Password, two-factor authentication and signed-in devices.</p>
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
