## 2026-09-25T03:31:34Z
You are worker_m4_inspector, an implementation subagent.
Your working directory is: H:/erppreflight/.agents/teamwork/worker_m4_inspector
Original request file: H:/erppreflight/.agents/teamwork/ORIGINAL_REQUEST.md
Project plan: H:/erppreflight/.agents/teamwork/orchestrator_2/PROJECT.md
Survey report: H:/erppreflight/.agents/teamwork/survey_explorer_3/survey_r3_r4_report.md
Survey handoff: H:/erppreflight/.agents/teamwork/survey_explorer_3/handoff.md
Engineering skills to follow:
- H:/erppreflight/.agents/skills/data-table-and-large-list.md
- H:/erppreflight/.agents/skills/frontend-design-system.md
- H:/erppreflight/.agents/skills/sap-evidence.md

Your task is to implement Milestone M4: Universal SAP Object Inspector (/objects & Modal) (R4):
1. Exclusively Owned Files:
   - apps/api/src/modules/objects/ (objects.module.ts, objects.controller.ts, objects.service.ts, DTOs)
   - apps/api/src/app.module.ts (registering ObjectsModule)
   - apps/web/src/app/projects/[id]/objects/page.tsx
   - apps/web/src/components/objects/types.ts
   - apps/web/src/components/objects/object-detail-drawer.tsx
   - apps/web/src/components/findings/finding-detail-row.tsx

2. Key Deliverables:
   - Backend ObjectsModule (apps/api/src/modules/objects/):
     - GET /api/v1/projects/:id/objects: queries distinct SAP objects from findings.affected_objects and system objects. Returns object name, object type (CDS, Table, BAdI, Class, Form, OPD Table, Telegram), Clean Core Tier (Tier 1 Cloud, Tier 2 Released, Tier 3 Legacy), target release compatibility, findings count, with server-side pagination and filters. Also returns summary cleanCoreStats.
     - GET /api/v1/projects/:id/objects/:objectName: returns detailed object metadata, upstream and downstream dependencies, and associated active findings.
     - Register ObjectsModule in apps/api/src/app.module.ts.
   - Frontend Object Inventory & Universal Modal:
     - In apps/web/src/components/objects/types.ts: REMOVE generateMockSapObjects(10000) completely! That mock violates Cardinal Axiom 1. Implement real fetchProjectObjects calling GET /api/v1/projects/:id/objects.
     - In apps/web/src/app/projects/[id]/objects/page.tsx: connect to real TanStack Query data; replace hardcoded summary statistics with real API counts; support sorting, filtering, and clicking an object to open ObjectDetailDrawer.
     - Make SAP object references clickable across apps/web/src/components/findings/finding-detail-row.tsx (and finding-columns if needed) to open the interactive ObjectDetailDrawer with live data.
   - Verify: Add unit tests in apps/api/src/modules/objects/. Run tests and typecheck.
