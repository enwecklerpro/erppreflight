# Playbook: Background Jobs & Durable Workflow Orchestration

> **Binding Authority**: Part 14.4, Part 16.6, Part 21.22–21.23, Part 22.19 & AGENTS.md  
> **Scope**: BullMQ Redis queues, AnalysisProcessor, job retries, scheduled preflights, and durable workflows.

---

## 1. Queue Architecture
- **Job Enqueueing**: API controllers receiving long-running requests (analysis execution, export generation) enqueue a BullMQ job and return HTTP 202 Accepted immediately.
- **Worker Isolation**: `AnalysisProcessor` executes in the background, pulls clean artifacts from S3, invokes Python analysis engines via internal HTTP, and persists findings within tenant RLS.
- **Retry & Backoff**: Exponential backoff configured (3 attempts, initial delay 2000ms). Dead-letter handling retains failed jobs for 500 executions for debugging.

---

## 2. Invariants
- Never block HTTP request threads waiting for multi-second or multi-minute analysis jobs.
- Never pass giant file buffers through Redis queue payloads; pass S3 object keys instead.
- Jobs must be idempotent and cancelable via job ID.

---

## 3. Implementation Checklist
- [ ] Job options include `attempts: 3`, `backoff: { type: 'exponential', delay: 2000 }`.
- [ ] Processor verifies tenant context before executing database operations.
- [ ] Status transitions tracked: `QUEUED -> RUNNING -> COMPLETED / FAILED`.
- [ ] Automated tests verify background worker processing with mocked Redis.
