'use client';

import { SuperAdminGate } from '@/components/admin/governance/shared';
import { SourceAdmin } from '@/components/admin/governance/source-admin';

/** Source Sync Admin (spec 10.12), SUPER_ADMIN only. */
export default function SourceAdminPage() {
  return (
    <SuperAdminGate>
      <SourceAdmin />
    </SuperAdminGate>
  );
}
