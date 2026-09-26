# ERP Preflight — User Guide

> Spec 13.12 #4. Describes the flows that exist in the web application today and that are exercised
> by the automated browser test (`scripts/e2e-ui-smoke.cjs`). Limitations: `docs/KNOWN_LIMITATIONS.md`.

ERP Preflight checks SAP artifacts (configuration exports, forms, ABAP, interface definitions,
logs) **before** a change reaches production. Every finding points to the exact file, line and
SHA-256 of the artifact it came from, and carries a confidence class:

| Class | Meaning |
|---|---|
| `VERIFIED` | Proven directly from the artifact |
| `RULE_DERIVED` | Follows from a deterministic rule applied to the artifact |
| `INFERRED` | Probabilistic or AI-assisted (never higher than 0.60) |
| `UNKNOWN` | Evidence could not be verified — treat as a lead, not a verdict |

Severities (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `LOW`, `INFO`) are always shown as text
badges, not only colours.

## 1. Sign up and log in

1. Open `/signup`: organisation name, your name, e-mail, password (twice). Submitting creates your
   organisation (you are its owner) and signs you in.
2. Next time use `/login`. Wrong credentials are rejected; repeated failures are rate-limited.
   Instead of the password you can choose **Send me a sign-in link**: we e-mail a link that signs you
   in once and expires after 15 minutes (the answer is the same whether or not the address has an
   account). With two-factor authentication you are still asked for your code; organisations that
   enforce single sign-on send their members to the identity provider instead.
3. Log out from the user menu — this ends the session on the server, removes the session cookie and
   clears cached data in the browser. The session is kept only in an HTTP-only cookie; nothing that
   could sign you in is stored in the browser's local storage.

Password reset (sign-in page → *Forgot password?*), e-mail verification (banner after sign-up),
two-factor authentication and the list of active sessions (**Settings → Security**) are available.

## 2. Create a project

`/projects` → **New Project** → name (e.g. "S/4HANA 2023 Migration Preflight"), optional description and
the target SAP release → create. The project appears in the list; **Enter Workspace** opens it.

## 3. Upload artifacts

In the workspace open **Artifact Dropzone** and drop or select files (XML, JSON, CSV, XLSX, ABAP,
XDP, EDMX/WSDL, TXT/log, ZIP). Each upload goes through:

1. file-type check by content (the extension is not trusted);
2. archive safety checks for ZIPs (size/ratio/entry limits, no paths outside the archive, no nested archives);
3. antivirus scan (ClamAV) — if the scanner is unavailable the upload is **rejected**, never
   accepted unscanned; try again later;
4. secret redaction — passwords, tokens and keys inside the file are replaced by
   `[REDACTED:SECRET:…]` before the file is stored. The structure of XML files is preserved.

A file that passed all stages is **CLEAN** and can be analysed.

## 4. Run an analysis

**Analysis Launcher** → tick the CLEAN files → choose the engines (e.g. OPD Guard for output
determination exports) → **Execute Preflight Run**. The run is queued and processed in the
background; its status (QUEUED → RUNNING → COMPLETED / PARTIAL / FAILED) is shown in the launcher and
in **Run History**. `FAILED` with an `*_INSUFFICIENT_INPUT` or `*_PARSE_ERROR` finding means the
engine could not use the file — check that you uploaded the export format the engine expects
(`ENGINE_CATALOG.md` lists formats per engine). Identical files always produce identical findings.

## 5. Review findings and evidence

**Findings** tab → **Open Full Findings Ledger** (`/projects/<id>/findings`). Filter and sort by
severity, engine and status; click a finding to open it. The detail shows:

- title, description and **remediation** steps;
- **evidence**: file name, line/column, the (redacted) code snippet and the artifact SHA-256;
- the provenance chain (artifact → hash → parser → engine → knowledge → verdict).

Reviewers can set a review status (e.g. verified, accepted risk, false positive) with a justification.
The **Objects** tab lists the SAP objects seen in the project; **Overview** summarises the latest runs.
The cross-project **Inspector** (`/inspector`) searches findings across your projects.

## 6. Export reports

In the workspace:

- **Download offline HTML report** — single self-contained HTML file (no external resources),
  suitable for air-gapped review.
- **Download reproducibility bundle** — JSON bundle with the inputs' hashes, engine versions and
  findings so the run can be re-verified.

PDF, Excel traceability matrix and CSV exports exist in the API
(`POST /api/v1/projects/<projectId>/analyses/<analysisId>/export` with `{"format": "PDF" | "XLSX" | "CSV" | "HTML_OFFLINE" | "JSON_BUNDLE"}`,
then `GET /api/v1/reports/<reportId>/file`) but have no button in the UI yet.

## 7. Other areas

| Page | Purpose |
|---|---|
| `/projects/<id>/lab` | Scenario / regression test lab: generate test scenarios for OPD, forms, MFS and change pointers |
| `/projects/<id>/simulation` | What-if simulation of a planned change (blast radius, new vs resolved findings) |
| `/projects/<id>/traceability` | Traceability from requirement to finding, task, test and release |
| `/templates` | Pre-configured analysis templates |
| `/matrix` | Release compatibility matrix per engine |
| `/settings` | API keys, webhooks, AI governance (tenant administrators — see ADMIN_GUIDE.md) |
| `/status` | Platform component status |
| `/trust` | Security and trust information |

## 8. Privacy

Your files are private to your organisation: every request is checked against your organisation
membership and the database enforces row-level security. Download links expire after at most 15
minutes. Files are never sent to an AI provider unless your organisation enables AI assistance, and
only after scanning and redaction.
