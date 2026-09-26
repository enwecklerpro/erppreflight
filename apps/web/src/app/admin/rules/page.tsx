'use client';

import { SuperAdminGate } from '@/components/admin/governance/shared';
import { RuleAdmin } from '@/components/admin/governance/rule-admin';

/** Rule Admin (spec 10.10), SUPER_ADMIN only. */
export default function RuleAdminPage() {
  return (
    <SuperAdminGate>
      <RuleAdmin />
    </SuperAdminGate>
  );
}
