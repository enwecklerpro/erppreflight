# Playbook: Architecture Decision Records (ADRs)

> **Binding Authority**: Part 14.66, Part 21.42, Part 22.27 & AGENTS.md  
> **Scope**: Framework selection, ORM, state management, queue systems, and major dependency changes.

---

## 1. Requirement
Whenever an autonomous agent or human developer proposes adding a new dependency, replacing an existing library, changing database ORMs, or altering fundamental service topology, an Architecture Decision Record (ADR) MUST be recorded in `ARCHITECTURE_DECISIONS.md`.

---

## 2. ADR Standard Structure
1. **Title**: ADR-XXX: [Decision Title]
2. **Status**: Proposed / Accepted / Rejected / Superseded
3. **Context**: What problem are we solving? What constraints exist?
4. **Decision**: What library or architectural pattern was chosen?
5. **Consequences**: Positive outcomes and trade-offs incurred.
6. **Alternatives Considered**: Why competing solutions were rejected.

---

## 3. Strict Prohibitions
- Bypassing the No-Dependency-Soup rule without an accepted ADR is strictly forbidden.
- Adding duplicate headless UI primitives, second ORMs, or competing form libraries will fail CI code review.
