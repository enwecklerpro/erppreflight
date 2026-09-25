# Playbook: SAP & External Connector Development

> **Binding Authority**: Part 18, Part 22.13 & AGENTS.md  
> **Scope**: External SAP system connectors, RFC destinations, OData endpoints, Local Agent mTLS, and Credential Vault.

---

## 1. Principles
- **Least-Privilege Handshake**: When connecting to an SAP system, query only required catalog metadata. Default to read-only scopes.
- **Credential Isolation**: Plaintext credentials (passwords, RFC tokens, private keys) must NEVER reside in relational user/tenant tables. All secrets must flow through the AES-256 GCM encrypted credential vault.
- **Production Write Registry**: Any external mutation action must be registered in the Write Action Registry with dry-run support, explicit user confirmation, and audit events. Dual approval is mandatory for PROD environments.

---

## 2. Implementation Checklist
- [ ] Connector implements capability handshake (`product`, `release`, `scopes`, `read_only`).
- [ ] Credentials encrypted with Master Encryption Key before persistence.
- [ ] Automated health check probe with exponential retry and circuit-breaker backoff.
- [ ] Secret display disabled; UI displays masked fingerprints only (`********`).
- [ ] Mock connection adapter available for offline unit and integration tests.
