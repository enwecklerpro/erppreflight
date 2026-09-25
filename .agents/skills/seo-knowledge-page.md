# Playbook: Programmatic SEO Knowledge Pages

> **Binding Authority**: Part 14.60, Part 22.15 & AGENTS.md  
> **Scope**: High-value public knowledge landing pages (`/knowledge/[slug]`), sitemaps, and search engines.

---

## 1. Principles
- **Genuine User Value**: Answer real SAP engineering and migration questions (e.g. "SAP purchase order email not sent", "Is MARA released in ABAP Cloud?").
- **Reviewed Knowledge Only**: Content must derive from immutable, reviewed knowledge snapshots. Zero auto-generated hallucinated spam pages.
- **Explicit Release Context**: Every page must clearly declare target SAP release scope (e.g. S/4HANA Cloud 2608, 2025, ECC 6.0).
- **Clear Tool CTA**: Directly connect the question to a free preflight lookup or interactive sandbox demo.

---

## 2. Implementation Checklist
- [ ] Next.js App Router dynamic route awaits `params` (`const { slug } = await params;`).
- [ ] Structured metadata (`generateMetadata`) includes canonical URL, OpenGraph tags, and JSON-LD schema.
- [ ] Reviewed evidence code snippets and official SAP notes cited with verification dates.
- [ ] Internal links connect to related preflight engines, documentation, and the Release Compatibility Matrix.
