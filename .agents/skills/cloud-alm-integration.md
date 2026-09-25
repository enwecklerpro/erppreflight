# Playbook: SAP Cloud ALM & Work Management Integration

> **Binding Authority**: Part 15, Part 22.14 & AGENTS.md  
> **Scope**: SAP Cloud ALM, Jira, Azure DevOps, GitHub Issues connectors, and 8-column delivery traceability.

---

## 1. Traceability Architecture
Every preflight finding must support bi-directional mapping into the delivery graph:
`Business Process -> Requirement -> Finding -> Remediation Task -> Test -> Defect -> Transport -> Release`

---

## 2. Sync Safety Invariants
- **External ID Preservation**: Every synchronized record retains external system, tenant, and external object IDs.
- **No Silent Overwrites**: Conflicting human changes in Cloud ALM or Jira trigger a conflict state; automated synchronization will not overwrite human edits without confirmation.
- **Resolution Requires Technical Evidence**: A task marked "Completed" in Jira/Cloud ALM does NOT automatically close an ERP Preflight finding. The finding closes ONLY when a subsequent preflight re-evaluation proves that the defective code or configuration is resolved.

---

## 3. Implementation Checklist
- [ ] Connectors implement the `WorkItemConnector` interface.
- [ ] Generated task payloads contain finding ID, severity, exact evidence file pointer, SHA-256 hash, and deep link.
- [ ] Sync direction (Pull / Push / Bi-directional) explicitly configured per project.
- [ ] Conflict resolution UI provided for mismatched status states.
