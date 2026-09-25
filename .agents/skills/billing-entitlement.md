# Playbook: Billing, Entitlements & Plan Governance

> **Binding Authority**: Part 14.47, Part 16.30, Part 18.22, Part 22.21 & AGENTS.md  
> **Scope**: Organization plan tiers (`FREE`, `PRO`, `ENTERPRISE`, `PARTNER`), quotas, usage guardrails, and billing webhooks.

---

## 1. Principles
- **Entitlement Decoupling**: Product access and engine quotas are managed by an internal Entitlement Service, not hardcoded to external Stripe status.
- **Fail-Safe Quotas**: Prevent runaway computing costs by setting per-plan monthly analysis limits and file size caps.
- **Webhook Idempotency**: Stripe or partner billing webhooks verify cryptographic signatures, check event IDs against duplicate processing, and update organization tier status atomically.

---

## 2. Implementation Checklist
- [ ] Organization schema includes `plan_tier` (`FREE`, `PRO`, `ENTERPRISE`, `PARTNER`).
- [ ] Usage checks enforce limits before enqueuing compute-intensive preflight runs.
- [ ] Webhook handler verifies HMAC signatures with replay defense.
- [ ] Enterprise manual overrides supported for custom trial extensions and POC tenants.
