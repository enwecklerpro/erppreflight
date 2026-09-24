# SAP Evidence, Fact Verification, and Provenance Playbook

> Local copy for m3_d4_it2_auditor_1
> Source: /.agents/skills/sap-evidence.md

Refer to /.agents/skills/sap-evidence.md for full evidence specifications.
Key Invariants:
1. Every assertion backed by concrete evidence and verified against authoritative release metadata.
2. Cryptographic SHA-256 evidence veracity, exact line/col coordinates, non-empty snippets.
3. Provenance hierarchy: VERIFIED (1.0), RULE_DERIVED (0.85), INFERRED (0.60), UNKNOWN (0.30).
4. Missing evidence demoted to UNKNOWN (0.30). LLM assistance capped at INFERRED (0.60).
