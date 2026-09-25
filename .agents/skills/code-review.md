# Playbook: Code Review & Quality Gate Enforcement

> **Binding Authority**: Section 1 (The Two Cardinal Axioms), Section 5 & AGENTS.md  
> **Scope**: Pull request review, automated quality gates, linting, and acceptance criteria.

---

## 1. Review Checklist
Every code contribution or agent completion must pass the following checks:
1. **Axiom 1 (Frontend)**: Real TanStack Query data; runtime Zod validation; contextual error/loading skeletons; non-color severity indicators; accessible keyboard navigation.
2. **Axiom 2 (Engines)**: 14-point engine structure; deterministic logic; golden positive/negative fixtures; cryptographic SHA-256 evidence; epistemic confidence classification (`VERIFIED`, `RULE_DERIVED`, `INFERRED`, `UNKNOWN`).
3. **Multi-Tenancy**: All database queries enforce tenant isolation (`organization_id = get_current_tenant_id()`). Zero cross-tenant data leaks.
4. **No-Dependency-Soup**: Zero duplicate libraries introduced (no React Hook Form, Redux, Prisma).
5. **Security**: Inputs validated against magic bytes; external XML parsed via `defusedxml`; secrets redacted using Shannon entropy and HMAC tokens.

---

## 2. Gate Verification Commands
```bash
pnpm run check:deps
pnpm run check:no-production-facades
pnpm run typecheck
pnpm run test
pnpm run test:python
pnpm run build
```
All commands must complete with a 100% pass rate.
