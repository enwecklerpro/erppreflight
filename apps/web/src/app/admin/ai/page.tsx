'use client';

import { SuperAdminGate } from '@/components/admin/governance/shared';
import { AiAdmin } from '@/components/admin/governance/ai-admin';

/** AI Admin (spec 10.11), SUPER_ADMIN only. */
export default function AiAdminPage() {
  return (
    <SuperAdminGate>
      <AiAdmin />
    </SuperAdminGate>
  );
}
