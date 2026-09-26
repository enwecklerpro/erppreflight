'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2 } from 'lucide-react';
import { accountKeys, fetchMyOrganizations } from '@/lib/account-api';
import { getStoredTenantId } from '@/lib/api/custom-instance';
import { useTenantSwitch } from '@/lib/query/query-provider';

/**
 * Active-organization selector. Switching cancels in-flight queries and clears the
 * whole query cache before the new X-Tenant-Id is stored (useTenantSwitch), so data
 * of the previous tenant can never flash; the API re-verifies membership on every
 * request (403 for organizations the user does not belong to).
 */
export function OrganizationSwitcher({ homeOrganizationId }: { homeOrganizationId: string }) {
  const switchTenant = useTenantSwitch();
  const [activeId, setActiveId] = React.useState<string>(homeOrganizationId);
  const [switching, setSwitching] = React.useState(false);
  const orgs = useQuery({ queryKey: accountKeys.organizations, queryFn: fetchMyOrganizations, retry: false, staleTime: 60_000 });

  React.useEffect(() => {
    setActiveId(getStoredTenantId() || homeOrganizationId);
  }, [homeOrganizationId]);

  if (!orgs.data || orgs.data.length === 0) return null;
  const active = orgs.data.find((o) => o.id === activeId) || orgs.data.find((o) => o.id === homeOrganizationId);

  if (orgs.data.length === 1) {
    return (
      <span className="hidden md:inline-flex items-center gap-1.5 text-xs text-muted-foreground max-w-[12rem] truncate" title={active?.name}>
        <Building2 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{orgs.data[0].name}</span>
      </span>
    );
  }

  return (
    <label className="inline-flex items-center gap-1.5 text-xs">
      <Building2 className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">Active organization</span>
      <select
        className="h-8 max-w-[11rem] truncate rounded-md border border-border bg-background px-2 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        value={active?.id || ''}
        disabled={switching}
        aria-busy={switching}
        onChange={async (e) => {
          const next = e.target.value;
          if (!next || next === activeId) return;
          setSwitching(true);
          setActiveId(next);
          try {
            await switchTenant(next, '/projects');
          } finally {
            setSwitching(false);
          }
        }}
      >
        {orgs.data.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
