# Playbook: Performance Engineering & Resource Budgets

> **Binding Authority**: Part 14.23, Part 21.43, Part 22.22 & AGENTS.md  
> **Scope**: Bundle boundaries, virtualization, database query optimization, and memory limits.

---

## 1. Frontend Performance
- **Virtualization for Large Tables**: Datasets > 100 rows (findings ledger, object inventory, MFS logs) use TanStack Virtual to maintain a constant DOM node footprint (~30 rows).
- **Bundle Splitting**: Heavy dependencies (@xyflow/react, Apache ECharts, Monaco Editor) are lazy-loaded via dynamic imports (`React.lazy` or `next/dynamic`). Never import graph/chart libraries on public landing pages.
- **SSR QueryClient Factory**: Next.js App Router creates a fresh `QueryClient` per request on the server to prevent cross-tenant cache bleeding, and a shared singleton on the client.

---

## 2. Backend & Worker Performance
- **Streaming Parsers**: XML and CSV parsers operate under bounded memory buffers. Defend against zip bombs and memory exhaustion.
- **Database Indexing**: All tenant queries filter on indexed columns (`organization_id`, `project_id`, `created_at`). Avoid sequential scans on million-row findings ledgers.
- **Async Execution**: Any analysis job takes < 100ms to enqueue in BullMQ, returning HTTP 202 Accepted.
