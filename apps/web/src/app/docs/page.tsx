'use client';

import React, { useState } from 'react';
import {
  BookOpen,
  Terminal,
  Code,
  Layers,
  ShieldCheck,
  Search,
  ExternalLink,
  ChevronRight,
} from 'lucide-react';

const SECTIONS = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: BookOpen,
    content: `
# Getting Started with ERP Preflight

ERP Preflight is an enterprise multi-tenant SaaS for preflight analysis, Clean Core compliance auditing, release intelligence, and migration verification.

### Core Philosophy: The Two Cardinal Axioms
1. **A page that renders is not a completed feature**: Every dashboard metric, findings list, and simulation graph is backed by real PostgreSQL 16 persistence, Redis job queues, and the Python 3.13 stateless analysis microservice.
2. **An engine without deterministic logic/evidence/fixtures is not complete**: Every finding must contain exact file pointers, line and column numbers, code snippets, SHA-256 hashes, and epistemic confidence classification.

### Quick Start in 3 Steps
1. **Create a Project Workspace**: Name your migration target and select your release scope (e.g. SAP S/4HANA 2023).
2. **Upload Artifacts**: Drag and drop recognized SAP extracts (OPD XML, Adobe Form XDP, ABAP source, SPRO CSV, or CTS transport logs).
3. **Run Preflight**: BullMQ workers stream clean artifacts, evaluate deterministic rules, and populate the Findings Ledger.
    `,
  },
  {
    id: 'cli-guide',
    title: 'Official CLI (`erp-preflight`)',
    icon: Terminal,
    content: `
# Official CLI Reference: \`erp-preflight\`

The ERP Preflight CLI enables automated preflight scanning in headless CI/CD pipelines (GitHub Actions, GitLab CI, Azure DevOps).

### Installation
\`\`\`bash
npm install -g @erppreflight/cli
# or run directly with npx
npx erp-preflight --help
\`\`\`

### Authentication
Authenticate with your organization-scoped API key:
\`\`\`bash
erp-preflight login --key erppf_live_xxxx
\`\`\`

### Common Commands
\`\`\`bash
# List all workspace projects
erp-preflight project list

# Run Clean Core preflight against an abapGit repository
erp-preflight analyze clean-core ./src --release S4H_2023

# Check CTS transport dependencies before release
erp-preflight analyze transport ./cts_buffer.txt

# Download preflight audit report
erp-preflight report download <analysis-id> --format XLSX
\`\`\`
    `,
  },
  {
    id: 'rest-api',
    title: 'Developer REST API',
    icon: Code,
    content: `
# Developer REST API

All SaaS capabilities are exposed via documented REST endpoints under \`/api/v1\`.

### Authentication
Authenticate with a Bearer JWT or an \`x-api-key\` header:
\`\`\`http
GET /api/v1/projects HTTP/1.1
Host: api.erppreflight.com
x-api-key: erppf_live_xxxxxxxxxxxxxxxxxxxxxxxx
\`\`\`

### Key Endpoints
- \`POST /api/v1/projects\`: Create a new project workspace.
- \`POST /api/v1/projects/:id/artifacts\`: Ingest and scan SAP artifacts.
- \`POST /api/v1/analyses\`: Trigger asynchronous BullMQ preflight analysis.
- \`GET /api/v1/findings\`: Retrieve findings ledger with cryptographic evidence.
- \`POST /api/v1/projects/:id/changesets/:id/simulate\`: Execute What-If blast radius simulation.
- \`POST /api/v1/mcp\`: JSON-RPC 2.0 endpoint for MCP coding agents.
    `,
  },
  {
    id: 'engines',
    title: '19 Preflight Engines Reference',
    icon: Layers,
    content: `
# 19 Preflight Analysis Engines

All 19 preflight engines operate deterministically without LLM hallucination:

1. **OPD_GUARD**: S/4HANA Output Parameter Determination & BRFplus decision table auditor.
2. **FORM_DOCTOR**: SAPscript / Smart Forms to Adobe Forms context binding validator.
3. **CUSTOM_FIELD_FLOW_DOCTOR**: Extension field lineage from CDS views through BAPIs to UI.
4. **EXTENSION_IMPACT_GUARD**: Cloud BAdI & key-user extensibility upgrade stability analyzer.
5. **SPRO2CLOUD**: On-premise IMG/SPRO customizing to Cloud CBC activity mapping.
6. **ECC2CLOUD_NAVIGATOR**: Custom code remediation & obsolete transaction migration roadmap.
7. **SAP_GAP_RADAR**: Fit-to-standard vs custom delta analyzer with Clean Core recommendations.
8. **CLEAN_CORE_OBJECT_GUARD**: Tier 1/2/3 extensibility classification & classic modification detector.
9. **CHANGE_POINTER_COVERAGE_AUDITOR**: BD21/BD52 change pointer config & event trigger validation.
10. **API_CHANGE_GUARD**: OData, SOAP, RFC compatibility & deprecation impact scanner.
11. **SOFTWARE_COLLECTION_DEPENDENCY_GUARD**: Export software collection cross-reference validator.
12. **TRANSPORT_DEPENDENCY_ANALYZER**: CTS transport sequence & dictionary dependency validator.
13. **SAFE_DECOMMISSION_PREFLIGHT**: Unused Z-program, table, and interface retirement preflight.
14. **FIORI_403_ROOT_CAUSE_DOCTOR**: PFCG role, auth objects (S_START, S_SERVICE) & ICF auditor.
15. **WORKFLOW_STUCK_EXPLAINER**: SWWWIHEAD / SWZAI analysis for blocked work items.
16. **IAM_COST_OPTIMIZER**: Fiori catalog over-licensing & authorization tier minimizer.
17. **ACCOUNT_DETERMINATION_PREFLIGHT**: OBYC, VKOA, automatic account determination rule validator.
18. **SYSTEM_REFRESH_DELTA_GUARD**: Post-refresh BDLS, RFC destination, & logical system validator.
19. **MFS_BLACKBOX**: Material Flow System telegram sequence & telegram buffer auditor.
    `,
  },
];

export default function DocsPage() {
  const [activeSection, setActiveSection] = useState(SECTIONS[0].id);

  const current = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row gap-8">
        {/* Sidebar Nav */}
        <div className="w-full md:w-64 shrink-0">
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 sticky top-6">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3 px-2">
              Documentation
            </div>
            <nav className="space-y-1">
              {SECTIONS.map((sec) => {
                const Icon = sec.icon;
                const isActive = activeSection === sec.id;
                return (
                  <button
                    key={sec.id}
                    onClick={() => setActiveSection(sec.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{sec.title}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl p-6 sm:p-10 shadow-xl">
          <div className="prose prose-invert max-w-none text-slate-300 text-sm leading-relaxed whitespace-pre-line">
            {current.content}
          </div>
        </div>
      </div>
    </div>
  );
}
