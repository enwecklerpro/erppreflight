# SAP Evidence, Fact Verification, and Provenance Playbook (Local Workspace Copy)

> Playbook Identifier: `sap-evidence`
> Local Replica for m2_it3_challenger_2
> Anchored on: Cardinal Axiom 2 (Points 5, 6, 7)

Key Rules:
1. Release Alignment States & Penalty Multipliers:
   - RELEASE_ALIGNED: Multiplier 1.0 (verified for target)
   - RELEASE_PREMATURE: Multiplier 0.0 or 0.40 (requires future release)
   - RELEASE_DEPRECATED: Multiplier 0.0 (deprecated/removed prior/in target)
   - FAMILY_MISMATCH / RELEASE_MISMATCH: Multiplier 0.50 (cross-family)
   - RELEASE_FUTURE: Multiplier 0.80 (target >= validFrom + 2 releases)
   - UNKNOWN: Multiplier 0.30 (cannot be verified)
2. Monotonicity & Single Source Integrity
3. Cryptographic snippet verification (SHA-256)
4. Epistemic Confidence Ceiling (LLM <= 0.60 INFERRED, absence demotes to UNKNOWN 0.30)
