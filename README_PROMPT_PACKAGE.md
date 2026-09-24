# ERP Preflight — GPT Astra Ultra Build Prompt Package

**Domain:** `https://erppreflight.com`  
**GitHub repository:** `https://github.com/enwecklerpro/erppreflight`  
**Repository state at prompt creation:** empty `main` branch; build from scratch.  
**Product name:** **ERP Preflight**  
**Primary target ecosystem:** SAP ERP / SAP S/4HANA / SAP S/4HANA Cloud, with architecture that can later support other ERP ecosystems without renaming the company.

## How to use this prompt package

Treat **all files in this directory as one binding specification**. Read them in numerical order before implementing. The individual files are intentionally split so a large coding agent can keep context clean, but nothing in a later part overrides an earlier non-negotiable requirement unless it explicitly says so.

Recommended order:

1. `00_EXECUTION_CONTRACT.md`
2. `01_PRODUCT_VISION_AND_SCOPE.md`
3. `02_BRAND_UX_DESIGN_SEO.md`
4. `03_TECH_ARCHITECTURE_MONOREPO.md`
5. `04_DATA_MODEL_KNOWLEDGE_GRAPH.md`
6. `05_PLATFORM_CORE_ENGINES.md`
7. `06_OUTPUT_EXTENSIBILITY_SUITE.md`
8. `07_MIGRATION_CLEAN_CORE_SUITE.md`
9. `08_INTEGRATION_RELEASE_IMPACT_SUITE.md`
10. `09_OPERATIONS_SPECIALIST_SUITE.md`
11. `10_SAAS_ADMIN_BILLING_SECURITY.md`
12. `11_OSS_INTEGRATIONS_CONNECTORS.md`
13. `12_TESTING_DEVOPS_OBSERVABILITY.md`
14. `13_DELIVERY_PLAN_DEFINITION_OF_DONE.md`

A combined copy is also provided as `ERP_PREFLIGHT_ASTRA_ULTRA_MASTER_PROMPT.md`.

## Core product principle

ERP Preflight is **not** a generic chatbot and **not** a collection of unrelated SAP utilities.

It is a project-centric SaaS platform that:

- understands what a user is trying to change, migrate, release, configure, integrate or troubleshoot;
- routes the request to specialized deterministic analysis engines;
- builds and reuses a shared SAP knowledge graph and customer dependency graph;
- provides evidence-backed findings rather than unsupported AI guesses;
- converts findings into remediation steps and regression/preflight tests;
- remembers project context and reevaluates findings when SAP releases change;
- can work file-first without SAP credentials, then optionally use secure read-only connectors/local agents for enterprise customers.

The central promise is:

> **Know what will break before production does.**

Do not reduce this product to “AI for SAP”. AI assists with routing, semantic interpretation, extraction and explanation. The core verdicts must be produced by deterministic rules, graph traversal, schema validation, static analysis, exact comparisons, or clearly identified evidence whenever possible.
