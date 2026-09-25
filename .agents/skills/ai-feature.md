# Playbook: AI Feature Governance & Guardrails

> **Binding Authority**: Part 17, Part 20.14–20.22, Part 22.10 & AGENTS.md  
> **Scope**: Any LLM assistance, problem routing, natural language query explanation, or AI suggestion.

---

## 1. The Cardinal Rule: Determinism First
- **Zero LLM-Only Engines**: An analysis engine that consists solely of an LLM prompt is strictly prohibited.
- **Evidence Hierarchy**:
  1. Deterministic Parser & AST Evidence
  2. Pure Rule Evaluation Loop
  3. Knowledge Snapshot Graph Traversal
  4. LLM Assistance (Strictly capped at `INFERRED` / 0.60 confidence)
- **Engine Verdict Trumps AI**: If an AI explanation contradicts the deterministic engine verdict, the engine verdict wins.

---

## 2. Security & Prompt Injection Defense
- Untrusted data (uploaded XML, comments, log lines, customer code) must NEVER be treated as system instructions.
- System/User/Data prompt separation enforced.
- Output schema validation with Zod / Pydantic required.
- Zero direct database writes from AI generated text.
- Egress restricted to approved internal endpoints.

---

## 3. Implementation Checklist
- [ ] Feature provides a deterministic alternative when external AI is disabled.
- [ ] Epistemic confidence score <= 0.60 (`INFERRED`).
- [ ] Prompt registered in versioned registry with owner, model compatibility, and schema.
- [ ] Actor attribution ledger records provider, model, tokens, and correlation ID.
- [ ] Human review required before AI suggestions mutate project configuration.
