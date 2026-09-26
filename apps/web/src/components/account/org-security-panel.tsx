'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import {
  accountKeys,
  errorMessage,
  fetchCurrentOrganizationDetails,
  fetchMe,
  setOrganizationRequire2fa,
} from '@/lib/account-api';
import { Notice, Pending, SectionSkeleton, SettingsSection, buttonClass } from './ui';

const ADMIN_ROLES = new Set(['ORGANIZATION_OWNER', 'SECURITY_ADMIN']);

/** Organization-wide "require 2FA" policy (owners and security admins). */
export function OrgSecurityPanel() {
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
      title="Organization security policy"
      icon={Building2}
      description="When required, members without 2FA can only reach their security settings until they enroll."
    >
      {org.isPending || me.isPending ? (
        <SectionSkeleton rows={1} label="Loading organization policy" />
      ) : org.isError ? (
        <Notice tone="error" title="Could not load the organization">{errorMessage(org.error)}</Notice>
      ) : (
        <div className="space-y-3">
          <p className="text-xs">
            Two-factor authentication for <strong>{org.data.name}</strong>:{' '}
            <strong>{required ? 'Required for all members' : 'Optional'}</strong>
          </p>
          {mutation.isError && <Notice tone="error">{errorMessage(mutation.error)}</Notice>}
          {mutation.isSuccess && (
            <Notice tone="success">
              Policy saved. {mutation.data.membersWithout2fa} member{mutation.data.membersWithout2fa === 1 ? '' : 's'} still
              {mutation.data.membersWithout2fa === 1 ? ' has' : ' have'} to enroll.
            </Notice>
          )}
          <button
            type="button"
            role="switch"
            aria-checked={required}
            disabled={mutation.isPending}
            className={required ? buttonClass.secondary : buttonClass.primary}
            onClick={() => mutation.mutate(!required)}
          >
            <Pending busy={mutation.isPending} busyLabel="Saving..." idle={required ? 'Make 2FA optional' : 'Require 2FA for all members'} />
          </button>
        </div>
      )}
    </SettingsSection>
  );
}
