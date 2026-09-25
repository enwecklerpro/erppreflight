# Copied from H:/erppreflight/.agents/skills/multi-tenant-security.md
# Local reference for worker_m2_baseline

Please refer to the source at H:/erppreflight/.agents/skills/multi-tenant-security.md.
Key takeaways:
- Dual-layer database segregation: all queries MUST explicitly filter by organizationId, plus RLS
- Pair resource IDs with organizationId to prevent IDOR
- Short-lived presigned URLs (<= 15 min)
- SSR isolation: per-request QueryClient
