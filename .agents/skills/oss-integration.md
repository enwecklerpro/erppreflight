# Playbook: Open Source Integration & Dependency Governance

> **Binding Authority**: Part 20.7, Part 21, Part 22.12 & AGENTS.md  
> **Scope**: External npm and pip dependencies, licenses, security vulnerabilities, and SBOM generation.

---

## 1. Principles
- **Curated Stack**: Only use libraries approved in Part 21 (Next.js 15, Base UI, TanStack Query/Table/Form/Virtual, Drizzle ORM, @xyflow/react, ELK.js, Apache ECharts, BullMQ, Zod 4).
- **License Permissiveness**: Only MIT, Apache 2.0, BSD-2/3-Clause, or ISC licenses are permitted. AGPL, GPL, or copyleft dependencies are prohibited in production SaaS bundles.
- **Vulnerability SLA**: Trivy and GitHub security workflows enforce fail-closed checks on unaccepted CRITICAL vulnerabilities (`exit-code: 1`).

---

## 2. Implementation Checklist
- [ ] Dependency explicitly declared in the appropriate `package.json` or `pyproject.toml`.
- [ ] No duplicate competing libraries introduced (`pnpm run check:deps` passes).
- [ ] CycloneDX SBOM generated and available for enterprise procurement review.
- [ ] Lockfiles (`pnpm-lock.yaml`) committed and strictly synchronized.
