import type { DocPage, DocSlug } from './pages';

/**
 * English documentation. Every step was walked through against the running
 * product (web + API + analysis service) on the review date in pages.ts.
 * Keep it factual: describe what the product does today, say so where a
 * capability is not available.
 */
export const docsEn: Record<DocSlug, DocPage> = {
  'getting-started': {
    title: 'Getting started',
    description: 'From sign-up to an exported preflight report: account, e-mail verification, project, upload, analysis, findings and export.',
    sections: [
      {
        id: 'sign-up',
        title: '1. Create an account',
        body: `Open [Sign up](/signup) and enter your organization name, your name, a work e-mail address and a password (twice). Signing up creates your organization workspace and makes you its owner; you are signed in right away.

Passwords are checked against the password policy (length and complexity) when you submit the form.`,
      },
      {
        id: 'verify',
        title: '2. Verify your e-mail address',
        body: `After sign-up a banner asks you to **verify your e-mail address**. We send a verification link to the address you entered; opening it confirms the address and the page shows *E-mail verified*.

Until the address is verified you can sign in, browse, create projects and upload artifacts, but you **cannot run analyses, export reports or create API keys**. The link is single-use; you can request a new one from the banner.`,
      },
      {
        id: 'project',
        title: '3. Create a project',
        body: `Go to [Projects](/projects) and choose **New Project**. Give the project a name (for example *S/4HANA 2023 upgrade preflight*) and pick the target release. Open it with **Enter Workspace**.

A project is the unit of work: its artifacts, analysis runs, findings and reports belong to your organization only.`,
      },
      {
        id: 'upload',
        title: '4. Upload artifacts',
        body: `In the project open the **Artifact Dropzone** tab and drop or select a file. Accepted uploads are \`.xml\`, \`.json\`, \`.csv\`, \`.zip\` and \`.abap\` up to 100 MB (the operator can change the limit).

Every upload is checked before any engine sees it:

- the file type is detected from its content (magic bytes), not from the extension;
- archives are inspected for zip bombs, path traversal and nesting;
- the file is scanned for malware and stays in quarantine until it is clean;
- secrets such as passwords and API tokens are redacted before the file is stored.

The file list shows the scan status (for example *CLEAN*) and the SHA-256 checksum that later appears in the evidence of every finding. Which format each engine expects is listed in [File formats per engine](/en/docs/file-formats).`,
      },
      {
        id: 'analyze',
        title: '5. Run an analysis',
        body: `Open the **Analysis Launcher** tab, select the uploaded files and the engines to run, then start the run (**Execute Preflight Run**). The run is queued and processed in the background; the project shows its status until it is *COMPLETED* (or *FAILED* / *PARTIAL* with the reason).

Engines are deterministic: the same files and the same knowledge snapshot always produce the same findings. See the [engine catalog](/en/docs/engines) for what each engine checks.`,
      },
      {
        id: 'findings',
        title: '6. Review findings',
        body: `The **Findings** tab summarises the latest run; **Open Full Findings Ledger** opens the full table with filters for severity, engine and status. Selecting a finding opens its detail with:

- the finding code, severity (shown as text and icon, never by colour alone) and confidence class (*VERIFIED*, *RULE_DERIVED*, *INFERRED* or *UNKNOWN*);
- the evidence: artifact path, line and column, code snippet and the SHA-256 of the artifact;
- the remediation text of the rule.

Findings are records of a specific run and knowledge snapshot; re-running creates new findings instead of rewriting old ones.`,
      },
      {
        id: 'export',
        title: '7. Export a report',
        body: `In **Run History** each completed run offers **Reports**: generate a PDF report, Excel (XLSX), CSV matrix, JSON bundle, offline HTML or all formats as ZIP, and download the generated files. **Bundle (.zip)** downloads the reproducibility bundle of the run.

Exports require a verified e-mail address and are recorded in the audit log.`,
      },
      {
        id: 'next',
        title: 'Next steps',
        body: `- Invite colleagues from **Settings → Members**.
- Create an API key in **Settings** to use the [API and CLI](/en/docs/api-cli).
- Try the [free tools](/en/tools) for single questions without a workspace.`,
      },
    ],
  },
  engines: {
    title: 'Engine catalog',
    description: 'All analysis engines with their input contracts, finding codes and remediation texts — generated from the live engine catalog.',
    sections: [
      {
        id: 'how-engines-work',
        title: 'How the engines work',
        body: `Each engine is a deterministic rule set over parsed artifacts. It validates its input against a declared contract, evaluates its rules and emits findings with evidence (artifact path, line and column, snippet, SHA-256) and a confidence class. Engines never call a language model to decide a finding; AI-assisted explanations are capped at *INFERRED* confidence.

If an input does not match the contract, the engine reports one of its input-validation codes (for example \`…_INVALID_INPUT\` or \`…_PARSE_ERROR\`) instead of a verdict.`,
      },
    ],
  },
  'file-formats': {
    title: 'File formats per engine',
    description: 'Which exports and files each analysis engine accepts, from the engines’ declared input contracts.',
    sections: [
      {
        id: 'upload-rules',
        title: 'Upload rules that apply to every engine',
        body: `- Upload \`.xml\`, \`.json\`, \`.csv\`, \`.zip\` or \`.abap\` files up to 100 MB each (operator setting).
- Archives: at most 100:1 compression ratio, 500 MB uncompressed in total, 10 000 entries and 2 levels of nested archives; entries with absolute paths or \`../\` are rejected.
- XML is parsed with DTDs, entity declarations and external references disabled.
- Secrets are redacted before storage; the redaction count is shown with the upload.`,
      },
    ],
  },
  security: {
    title: 'Security & data handling',
    description: 'How customer artifacts are isolated, checked, stored and deleted, and what the free tools can see.',
    sections: [
      {
        id: 'isolation',
        title: 'Tenant isolation',
        body: `Every organization is a tenant. Projects, artifacts, analyses, findings and reports carry the organization id, and PostgreSQL row-level security enforces that a request only ever sees rows of the signed-in organization. Stored files live under a per-organization, per-project path in object storage; download links are pre-signed and expire after at most 15 minutes.`,
      },
      {
        id: 'sessions',
        title: 'Sign-in and sessions',
        body: `You sign in with your password, with a **single-use e-mail link** (*Send me a sign-in link* on the [sign-in page](/login); the link expires after 15 minutes) or, where your organization configured it, with single sign-on. Organizations that enforce single sign-on block password and e-mail-link sign-in for their members. With two-factor authentication enabled, every method still asks for your authenticator or recovery code.

In the browser the session exists only as an HTTP-only cookie that page scripts cannot read; no session token is kept in browser storage. Changing requests additionally carry an anti-forgery token and are only accepted from the ERP Preflight web origin. Signing out ends the session on the server. Active sessions are listed, and can be ended individually or all at once, under **Settings → Security**.`,
      },
      {
        id: 'ingestion',
        title: 'Upload pipeline',
        body: `Uploads are type-checked by content, archive-checked (ratio, size, nesting, path traversal), malware-scanned and secret-redacted before an engine can read them. Files that fail a check stay in quarantine and are never analysed.`,
      },
      {
        id: 'analysis',
        title: 'Analysis service',
        body: `The analysis service is stateless: it receives the artifacts of one run, parses them with hardened parsers, evaluates the rules and returns findings. It has no access to the user, billing or tenant tables.`,
      },
      {
        id: 'retention',
        title: 'Retention, export and deletion',
        body: `Organization owners set retention periods for artifacts and reports in **Settings → Data retention**; expired data is deleted by a background job. Account holders can export their personal data and delete their account in **Settings → Account**. Security-relevant actions (sign-ins, API key changes, exports, member changes) are written to the audit log under **Settings → Audit log**.`,
      },
      {
        id: 'free-tools',
        title: 'Free tools and public pages',
        body: `The [free tools](/en/tools) and the public SAP object pages read only global, reviewed knowledge (official SAP release data and reviewed articles). They never read workspace data. The XML field checker parses the pasted document in memory and stores nothing.`,
      },
      {
        id: 'more',
        title: 'More',
        body: `See the [security overview](/en/security), the [Trust Center](/trust) and the [list of subprocessors](/en/legal/subprocessors).`,
      },
    ],
  },
  'api-cli': {
    title: 'API & CLI',
    description: 'Use ERP Preflight from scripts and CI: REST API with API keys, the erp-preflight CLI and the MCP endpoint.',
    sections: [
      {
        id: 'api-keys',
        title: 'API keys',
        body: `Organization owners and security admins create API keys in **Settings** (a verified e-mail address is required). A key is shown once, starts with \`erppf_live_\` and carries scopes:

- \`projects:read\`, \`projects:write\`
- \`analysis:read\`, \`analysis:run\`
- \`findings:read\`, \`findings:write\`
- \`reports:read\`

Send the key in the \`x-api-key\` header. Keys are bound to their organization; read requests need at least one scope, changing requests need a write or run scope. Account, member, billing and API-key management operations always require an interactive sign-in.`,
      },
      {
        id: 'rest',
        title: 'REST API',
        body: `All endpoints live under \`/api/v1\`. Typical automation flow:

\`\`\`
POST /api/v1/projects                              create a project
POST /api/v1/projects/{projectId}/files            upload an artifact (multipart field "file")
POST /api/v1/analyses                              {"projectId", "engineTypes": [...], "fileIds": [...]}
GET  /api/v1/analyses/{analysisId}                 poll until COMPLETED / FAILED / PARTIAL
GET  /api/v1/findings?projectId={projectId}        findings with evidence
POST /api/v1/projects/{projectId}/analyses/{analysisId}/export   {"format": "PDF"}
\`\`\`

Export formats: \`PDF\`, \`XLSX\`, \`CSV\`, \`JSON_BUNDLE\`, \`HTML_OFFLINE\`, \`ZIP_ALL\`. The complete, generated OpenAPI reference is linked below.`,
      },
      {
        id: 'cli',
        title: 'erp-preflight CLI',
        body: `The CLI (package \`@erppreflight/cli\`, Node.js 18 or newer) uses the same API with an API key. Point it at your instance with \`--api-url\` or \`ERP_PREFLIGHT_API_URL\` (for example \`https://api.example.com\`); \`login\` verifies the key and stores it in a config file readable only by you:

\`\`\`
erp-preflight login --key erppf_live_… --api-url https://api.example.com
erp-preflight status
erp-preflight project create --name "S/4HANA 2023 upgrade" --release S4H_2023
erp-preflight upload <projectId> ./exports/billing_opd.xml
erp-preflight analyze <projectId> --engines OPD_GUARD --wait --fail-on BLOCKER,CRITICAL
erp-preflight findings <projectId> --severity CRITICAL
erp-preflight report export <projectId> <analysisId> --format PDF --out report.pdf
erp-preflight report download <analysisId> --out bundle.zip
\`\`\`

Uploads go through the same server-side checks as the web app (magic bytes, malware scan, secret redaction) and analyses run the same deterministic engines. \`analyze clean-core|api-diff|mfs <path…> --project <id>\` uploads local files and runs the matching engine. With \`--fail-on\` the CLI exits with code 3 when findings of those severities exist — use it as a CI quality gate. Add \`--json\` for machine-readable output. Exit codes: 0 ok, 1 error, 2 usage/authentication, 3 quality gate failed.`,
      },
      {
        id: 'mcp',
        title: 'MCP for coding agents',
        body: `\`POST /api/v1/mcp\` is a JSON-RPC 2.0 endpoint implementing the Model Context Protocol methods \`tools/list\` and \`tools/call\` (for example \`search_knowledge\`). \`erp-preflight mcp\` starts the same tools as a local stdio MCP server for agents that expect a command.`,
      },
    ],
  },
  'local-agent': {
    title: 'Local agent',
    description: 'Run the outbound-only local agent inside your network: enrollment, signed jobs, local scanning and redaction.',
    sections: [
      {
        id: 'today',
        title: 'How the agent works',
        body: `The local agent (\`erp-preflight-agent\`, container image \`infra/docker/Dockerfile.local-agent\`) runs inside your network next to private SAP landscapes and only makes **outbound** HTTPS calls to ERP Preflight.

1. In **Integrations → Local agents**, an organization owner issues a single-use **enrollment token**.
2. On the agent host run \`erp-preflight-agent enroll <apiUrl> <enrollmentToken> --name <deviceName>\`. The agent generates its device key pair locally; only the public key is registered.
3. Start the loop with \`erp-preflight-agent daemon\`. It sends signed heartbeats, fetches jobs, verifies each job's signature and executes it locally.

Jobs are queued per device in **Integrations → Local agents**: *Scan directory* (only inside the directories listed in \`ERP_PREFLIGHT_AGENT_SCAN_ROOTS\` on the host — the SaaS cannot make the agent read anything else) and *Probe SAP URL* (TLS is always validated). Files are hashed (SHA-256) and secrets are redacted on the host; by default only a manifest leaves the network. Devices can be revoked at any time.

Other commands: \`status\`, \`scan <directory>\` (local only, uploads nothing), \`probe <sapUrl>\`, \`check-update\` and \`verify-update\` (signed update manifests).`,
      },
      {
        id: 'planned',
        title: 'Uploads remain available',
        body: `Uploads through the web app, the API or the CLI remain available for every engine; the agent is optional. Scheduled read-only extraction of further SAP artifact types by the agent will be documented here when it ships.`,
      },
    ],
  },
  faq: {
    title: 'FAQ',
    description: 'Short answers to the questions we are asked most.',
    sections: [],
    faq: [
      {
        question: 'Does ERP Preflight connect to my SAP system?',
        answer:
          'No direct system connection is needed. You upload exports (XML, JSON, CSV, ABAP sources, ZIP archives) that you create in SAP; the analysis works on those files. Optionally, the outbound-only local agent scans approved directories and probes SAP endpoints inside your network.',
      },
      {
        question: 'Are the findings produced by AI?',
        answer:
          'No. Findings come from deterministic rules with line-level evidence. Where AI helps with explanations, the confidence of that content is capped at INFERRED and marked as such.',
      },
      {
        question: 'Why can I not start an analysis?',
        answer:
          'Analyses, report exports and API keys require a verified e-mail address. Open the verification link we sent after sign-up, or request a new one from the banner.',
      },
      {
        question: 'Which file does an engine need?',
        answer:
          'Each engine documents its input contract — accepted formats and required content. See the file formats page in this documentation.',
      },
      {
        question: 'Can other customers see my data?',
        answer:
          'No. Every tenant table is protected by row-level security, files are stored under per-organization paths and download links expire after at most 15 minutes. The free tools only read global SAP knowledge.',
      },
      {
        question: 'Where does the Clean Core release information come from?',
        answer:
          'From the official SAP Cloudification Repository, synchronised into immutable knowledge snapshots. Every public page and tool shows the snapshot and the date the data was last retrieved.',
      },
    ],
  },
};
