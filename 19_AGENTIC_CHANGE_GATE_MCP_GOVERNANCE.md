# Part 19 — Agentic Change Gate and MCP/A2A Governance

This part is binding and extends Parts 00–18.

As AI agents increasingly interact with SAP through MCP, APIs and automation, ERP Preflight should support an optional **Agentic Change Gate**. The goal is not to replace SAP's agent tooling or MCP Gateway. The goal is to preflight and govern proposed ERP changes before execution.

---

## 19.1 Core Principle

External or internal AI agents may:
- propose a change;
- request a preflight;
- receive a verdict;
- request approval;
- execute only if policy allows.

ERP Preflight must never become an uncontrolled autonomous write proxy.

---

## 19.2 Agent Identity

Create first-class `AgentIdentity`.

Fields:
- agent ID
- publisher
- runtime/orchestrator
- model/provider if known
- owning organization
- allowed projects
- allowed tools
- scopes
- environment restrictions
- max risk class
- approval requirements
- expiration
- status

Agent identities are distinct from users/service accounts.

---

## 19.3 Agent Registration

Allow organization admin to register:
- MCP client
- Joule/custom agent
- Copilot/Claude/Cursor workflow
- custom internal agent
- CI bot

Require clear ownership.

Unknown agents cannot perform privileged actions.

---

## 19.4 Change Proposal API

Agents can submit a `ChangeProposal`:

```json
{
  "projectId": "...",
  "targetEnvironment": "QA",
  "changeType": "API_MIGRATION",
  "objects": [],
  "proposedDiff": {},
  "reason": "...",
  "sourceAgent": "..."
}
```

ERP Preflight converts this into a ChangeSet and runs What-If simulation.

---

## 19.5 Preflight Verdict for Agents

Machine-readable result:

- `CLEAR`
- `CLEAR_WITH_WARNINGS`
- `BLOCKED`
- `HUMAN_REVIEW_REQUIRED`
- `INSUFFICIENT_EVIDENCE`

Include:
- finding IDs
- blocking policy IDs
- required tests
- required approvals
- evidence references

Do not return hidden chain-of-thought.

---

## 19.6 Policy Engine for Agent Actions

Example policies:

- Agent may analyze PROD but cannot write PROD
- Agent may create QA transport task only after CLEAR verdict
- Critical finding requires architect approval
- Unverified/inferred result blocks autonomous execution
- External agent cannot access Restricted artifacts
- Agent write only during change window
- Agent can only modify own namespace

Policies are versioned and audited.

---

## 19.7 Human Approval

Approval UI shows:

- agent identity
- proposed change
- business reason
- before/after simulation
- findings
- affected processes
- tests
- target system
- rollback/reversibility info

Human can:
- approve once
- approve exact proposal hash
- reject
- request modification

Approval cannot be reused for a materially different change.

---

## 19.8 Proposal Hash Binding

Approval is bound to cryptographic hash of:
- proposed change
- target environment
- target release
- relevant artifacts

If proposal changes, approval becomes invalid.

---

## 19.9 Execution Token

For controlled integrations, after approval ERP Preflight may issue a short-lived execution authorization token containing:

- proposal ID/hash
- agent ID
- target
- allowed action
- expiry
- nonce

Execution adapter verifies token.

Never issue broad reusable write tokens.

---

## 19.10 Agent Tool-Level Scopes

MCP/API tools have scopes such as:

- `preflight:read`
- `preflight:run`
- `changes:propose`
- `changes:approve` (human/service role only where appropriate)
- `tasks:create`
- `sap:write:qa`
- `sap:write:prod`

Default external agent gets analysis scopes only.

---

## 19.11 Agent Session Trace

Store session-level audit:

- agent
- human delegator
- tool discovered
- tool invoked
- proposal
- preflight
- approval
- execution result
- test result

Support audit export.

---

## 19.12 Agent Budget / Rate Guard

Organization can set:
- analyses/hour
- AI spend/day
- write proposals/day
- max concurrent sessions
- max file/data access

Stop runaway agents.

---

## 19.13 Tool Poisoning / MCP Security

Treat tool metadata from external MCP servers as untrusted.

Defenses:
- allowlisted servers
- signed/verified endpoints where possible
- tool schema validation
- tool description change detection
- no hidden automatic new-tool enablement
- destination pinning
- TLS validation
- SSRF protection
- output sanitization

If external MCP tool description changes materially:
- alert
- require review for privileged use

---

## 19.14 MCP Tool Inventory

Admin view:
- MCP servers
- tools
- publisher
- endpoint
- auth
- last schema sync
- changed tool definitions
- risk class
- agents consuming them

This complements but does not claim to replace SAP agent inventory products.

---

## 19.15 MCP Tool Diff

Version tool definitions and detect:
- added tool
- removed tool
- parameter changed
- write capability added
- description changed
- destination changed

High-risk changes require review.

---

## 19.16 A2A / Agent Interoperability Readiness

Keep protocol adapter abstraction for future/available agent-to-agent standards.

Agent governance must not be tied exclusively to one vendor.

---

## 19.17 Agent-Generated Code Preflight

If agent proposes ABAP/code change:
- parse diff
- Clean Core Guard
- dependency analysis
- ATC import/run integration where configured
- tests
- transport impact

Do not approve based solely on “code compiles”.

---

## 19.18 Agent-Generated Configuration Preflight

If agent proposes:
- OPD rule
- form binding
- custom field
- software collection
- API mapping

route to relevant engines before execution.

---

## 19.19 Post-Execution Verification

After an approved change:
- collect actual resulting metadata;
- compare with approved proposal;
- run verification tests;
- detect drift.

If actual differs:
`Execution Drift`

Do not mark change verified.

---

## 19.20 Autonomous Execution Modes

Organization-level modes:

1. `ANALYZE_ONLY`
2. `PROPOSE_ONLY`
3. `APPROVAL_REQUIRED`
4. `AUTO_EXECUTE_LOW_RISK_NONPROD`
5. `CUSTOM_POLICY`

Default:
`ANALYZE_ONLY`

Production auto-execution must be disabled by default.

---

## 19.21 Separation of Duties

Support policies such as:
- proposer cannot approve;
- agent cannot approve itself;
- production approver must be different human;
- security-sensitive actions require Security Admin;
- break-glass approval separately audited.

---

## 19.22 Break-Glass

Enterprise emergency action:
- privileged user
- reason
- time limited
- mandatory audit
- immediate notification
- post-event review

Do not allow AI agent to invoke break-glass.

---

## 19.23 Agentic Governance Dashboard

Admin:
- active agents
- proposals
- blocked proposals
- approvals
- writes
- drift
- top tools
- spend
- policy violations
- unusual activity

---

## 19.24 Positioning Boundary

ERP Preflight must not claim to replace:
- SAP MCP Gateway
- SAP AI Agent Hub
- Joule Studio
- SAP Cloud ALM

It adds:
**change-specific preflight, evidence, impact simulation and approval before ERP changes.**

---

## 19.25 Definition of Done

This part is complete only when:
- agent identity model exists;
- machine-readable change proposal and verdict API exists;
- proposal hash/approval model exists;
- policy engine can gate agent activity;
- audit/session tracing exists;
- MCP tool inventory/diff exists;
- default is analyze-only;
- post-execution drift verification exists.
