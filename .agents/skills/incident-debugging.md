# Playbook: Production Incident Debugging & Runbooks

> **Binding Authority**: Part 14.69, Part 18.15–18.18, Part 22.23 & AGENTS.md  
> **Scope**: Correlation IDs, sanitized logs, error tracking, diagnostic bundles, and post-mortems.

---

## 1. Diagnostics & Tracing
- **Correlation ID Injection**: Every incoming HTTP request and queued BullMQ job receives a unique UUID correlation ID propagated through all service logs.
- **Support Diagnostic Bundle**: Users and admins can generate a sanitized diagnostic export containing analysis metadata, engine versions, and SHA-256 hashes without exposing customer secrets.
- **Sanitized Logging**: Pino structured logger strips bearer tokens, passwords, session cookies, and private key strings before emission.

---

## 2. Severity Classification (Part 18.15)
- **SEV1 (Critical)**: Cross-tenant data leak, production outage, or corrupted global knowledge producing systemic false findings. SLA: 15-minute response.
- **SEV2 (High)**: Individual engine failure or BullMQ worker stall blocking project assessment. SLA: 1-hour response.
- **SEV3 (Medium)**: Single-user interface rendering glitch or non-blocking export issue. SLA: 8-hour response.

---

## 3. Implementation Checklist
- [ ] Correlation ID present in request response headers (`X-Correlation-Id`).
- [ ] Error messages displayed to end-users contain support tracking IDs without stack traces.
- [ ] Post-mortem template created for any SEV1 or SEV2 event with preventive action items.
