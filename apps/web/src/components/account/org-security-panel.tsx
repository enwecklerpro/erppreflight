'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import {
  accountKeys,
  fetchCurrentOrganizationDetails,
  fetchMe,
  setOrganizationRequire2fa,
} from '@/lib/account-api';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from './ui';
import { useErrorText, useRichT, useT } from '@/i18n/client';

const ADMIN_ROLES = new Set(['ORGANIZATION_OWNER', 'SECURITY_ADMIN']);

/** Organization-wide "require 2FA" policy (owners and security admins). */
export function OrgSecurityPanel() {
  const t = useT();
  const rt = useRichT();
  const errText = useErrorText();
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: accountKeys.me, queryFn: fetchMe, retry: false });
  const org = useQuery({ queryKey: accountKeys.currentOrganization, queryFn: fetchCurrentOrganizationDetails, retry: 1 });
  const mutation = useMutation({
    mutationFn: setOrganizationRequire2fa,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accountKeys.currentOrganization }),
  });

  if (me.data && !ADMIN_ROLES.has(me.data.role || '') && me.data.systemRole !== 'SUPER_ADMIN') {
    return null;
  }
  const required = !!org.data?.require_2fa;

  return (
    <SettingsSection
      id="org-security"
      title={t('app.security.org.title')}
      icon={Building2}
      description={t('app.security.org.hint')}
    >
      {org.isPending || me.isPending ? (
        <SectionSkeleton rows={1} label={t('app.security.org.loading')} />
      ) : org.isError ? (
        <Notice tone="error" title={t('app.security.org.loadFailed')}>{errText(org.error)}</Notice>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">
            {rt('app.security.org.statusRich', {
              name: org.data.name,
              status: required ? t('app.security.org.required') : t('app.security.org.optional'),
              b: (c) => <strong>{c}</strong>,
            })}
          </p>
          {mutation.isError && <Notice tone="error">{errText(mutation.error)}</Notice>}
          {mutation.isSuccess && <Notice tone="success">{t('app.security.org.saved', { count: mutation.data.membersWithout2fa })}</Notice>}
          <button
            type="button"
            role="switch"
            aria-checked={required}
            disabled={mutation.isPending}
            className={required ? buttonClass.secondary : buttonClass.primary}
            onClick={() => mutation.mutate(!required)}
          >
            <Pending busy={mutation.isPending} busyLabel={t('app.security.org.saving')} idle={required ? t('app.security.org.makeOptional') : t('app.security.org.require')} />
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
