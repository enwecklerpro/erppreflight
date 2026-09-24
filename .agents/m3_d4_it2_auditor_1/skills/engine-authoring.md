# SAP Preflight Engine Authoring & Execution Standard Playbook

> Local copy for m3_d4_it2_auditor_1
> Source: /.agents/skills/engine-authoring.md

Refer to /.agents/skills/engine-authoring.md for full authoring specifications.
Key Invariants:
1. Pure deterministic evaluation.
2. 14-point engine anatomy.
3. Cryptographic evidence pointers (artifact path, line/col, snippet, SHA-256).
4. Confidence classification (VERIFIED=1.0, RULE_DERIVED=0.85, INFERRED=0.60, UNKNOWN=0.30).
5. Curated test fixtures (positive, negative, edge-case).
