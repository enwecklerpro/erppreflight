'use client';

import { SuperAdminGate } from '@/components/admin/governance/shared';
import { KnowledgeAdmin } from '@/components/admin/governance/knowledge-admin';

/** Knowledge Admin (spec 10.9), SUPER_ADMIN only. */
export default function KnowledgeAdminPage() {
  return (
    <SuperAdminGate>
      <KnowledgeAdmin />
    </SuperAdminGate>
  );
}
