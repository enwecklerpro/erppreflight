# Playbook: Agentic Change Gate & MCP Governance

> **Binding Authority**: Part 19, Part 22.11 & AGENTS.md  
> **Scope**: AI agents proposing changes, Model Context Protocol (MCP) clients, autonomous assistants, and execution tokens.

---

## 1. Core Principle: Governed Change
External AI agents (Claude, Copilot, Cursor, Joule, custom bots) may:
1. Query knowledge and project findings via MCP.
2. Submit a structured `ChangeProposal`.
3. Receive a deterministic Preflight Verdict (`CLEAR`, `BLOCKED`, `HUMAN_REVIEW_REQUIRED`).
4. Execute changes ONLY when policy allows and after human approval.

ERP Preflight must never become an uncontrolled autonomous write proxy to production SAP systems.

---

## 2. Cryptographic Execution Tokens
- Approval is strictly bound to the SHA-256 hash of the proposed change diff and target environment.
- Any change to the proposal invalidates prior approvals.
- Execution tokens have a maximum TTL of 15 minutes and include nonces to prevent replay attacks.

---

## 3. Implementation Checklist
- [ ] Agent registered with explicit ownership and permitted tools list.
- [ ] Proposals converted to ChangeSets and simulated using What-If canvas.
- [ ] Proposal hash binding verified before issuing short-lived HMAC token.
- [ ] Session-level trace logged with correlation IDs for audit export.
- [ ] Post-execution verification re-evaluates actual state to detect drift.
