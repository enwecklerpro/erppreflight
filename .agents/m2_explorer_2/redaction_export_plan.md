# Milestone 2 Technical Blueprint: Secret Redaction & Report Export Engine

**Author**: `m2_explorer_2` (Technical Explorer)  
**Target Milestone**: M2 — Secure Ingestion & Shared Platform Services  
**Associated Issues / Spec Features**: Feature 11 (Secret & Credential Redaction), Feature 13 (Preflight Report Export Engine), Feature 21/22 (Multi-Format Preflight Export & White-Labeling)  
**Creation Date**: 2026-09-24T02:18:00Z  
**Status**: APPROVED_FOR_IMPLEMENTATION  

---

## 1. Executive Summary & Architectural Scope

In enterprise SAP preflight auditing and clean core migration assessments, customer inputs contain sensitive corporate IP, system topology data, and high-risk secrets (RFC credentials, database connection strings, JWT authorization tokens, cloud API keys, and asymmetric private keys). Simultaneously, the final preflight deliverables must serve two distinct enterprise audiences:
1. **Steering Committees, C-Level Executives, and Lead Architects**: Require an authoritative, visually compelling **Executive PDF Assessment Report** featuring high-level readiness scorecards, a **6-axis Clean Core Radar Chart**, and prioritised **Blocker Diagnostic Tables**.
2. **Project Managers, Migration Workstream Leads, and DevOps Auditors**: Require an actionable **Excel (XLSX) / CSV Traceability Matrix** (with Clean Core tiers, SAP released API equivalents, remediation sprint assignees, and cutover sign-off gates) and a **Machine-Readable JSON Reproducibility Bundle** (with finding graph topology and cryptographic evidence hashes).

This document establishes the authoritative technical blueprint for:
- **The Secret & Credential Redaction Engine**: A dual-mechanism pipeline combining compiled high-throughput regular expressions with sliding-window **Shannon Entropy scoring**, enforcing **deterministic SHA-256 HMAC masking** (`[REDACTED:SECRET:sha256_hash]`) keyed per tenant.
- **The Preflight Report Export Engine**: An asynchronous BullMQ-driven export pipeline generating PDF reports, JSON reproducibility bundles, and XLSX/CSV migration traceability matrices, served via short-lived pre-signed S3 storage URLs.

---

## 2. Component 1: Secret & Credential Redaction Engine

### 2.1 Threat Model & Secret Signatures

Customer artifacts entering ERP Preflight (ABAP source code, transport request dumps, SM59 RFC configuration exports, `.ini` files, XML payloads, JSON configs, and deployment scripts) must be scrubbed before persisting to clean object storage, passing to parsers, or emitting into findings evidence.

The redaction engine targets 5 distinct secret families:

```
+---------------------------------------------------------------------------------------------------+
|                                  SECRET REDACTION DETECTION TAXONOMY                              |
+---------------------------------------------------------------------------------------------------+
| 1. Tokens & JWTs           | RFC 6750 Bearer Tokens, 3-part Base64URL JWTs (eyJ...)               |
| 2. Cloud & API Keys        | AWS (AKIA/ASIA), OpenAI (sk-proj-/sk-), GitHub (ghp_/github_pat_),   |
|                            | Generic API keys, Client Secrets                                     |
| 3. Private Keys            | RSA, EC, OpenSSH, DSA, PKCS#8, PGP Private Key Blocks                |
| 4. SAP RFC & System Creds  | RFC connection strings (ASHOST, SYSNR, CLIENT, USER, PASSWD),        |
|                            | SAProuter password paths (/H/.../W/pass/H/...), RFC_USER, RFC_PASS   |
| 5. Passwords & DB Secrets  | Key-value password assignments, URI embedded credentials             |
+---------------------------------------------------------------------------------------------------+
```

#### Detailed Pattern Catalog

| Secret Family | Subtype | Regex Pattern (Pre-compiled, Case-Insensitive) | Detection Strategy |
|---|---|---|---|
| **Bearer / JWT** | RFC 6750 Bearer | `(?i)\b(bearer\s+)([a-zA-Z0-9_\-\.=]{20,})\b` | Regex + Base64 check |
| **Bearer / JWT** | Raw JWT Token | `\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_\-]{10,})\b` | Structural Regex + Header JSON validation |
| **API Keys** | AWS Access Key ID | `\b((?:AKIA\|ASIA\|AROA\|AIPA\|AGPA\|AIDA)[A-Z0-9]{16})\b` | Regex + Checksum prefix |
| **API Keys** | AWS Secret Key | `(?i)(?:aws_secret_access_key\|aws_secret_key)\s*[:=]\s*['"]?([a-zA-Z0-9/+=]{40})['"]?` | Contextual Regex + Entropy ($H \ge 4.5$) |
| **API Keys** | OpenAI API Key | `\b(sk-(?:proj-)?[a-zA-Z0-9_-]{32,})\b` | Regex (Prefix + Length) |
| **API Keys** | GitHub PAT (Classic) | `\b(ghp_[a-zA-Z0-9]{36})\b` | Regex (Exact prefix) |
| **API Keys** | GitHub Fine-Grained | `\b(github_pat_[a-zA-Z0-9_]{82})\b` | Regex (Exact prefix) |
| **API Keys** | GitHub OAuth/App | `\b(gh[ousr]_[a-zA-Z0-9]{36})\b` | Regex (Prefixes) |
| **API Keys** | Generic Key/Secret | `(?i)\b(api[_-]?key\|secret[_-]?key\|client[_-]?secret\|access[_-]?token)\s*[:=]\s*['"]?([a-zA-Z0-9_\-\.]{16,})['"]?\b` | Contextual Regex + Shannon Entropy |
| **Private Keys** | RSA Private Key | `-----BEGIN RSA PRIVATE KEY-----[\s\S]+?-----END RSA PRIVATE KEY-----` | Multi-line Block Regex |
| **Private Keys** | EC Private Key | `-----BEGIN EC PRIVATE KEY-----[\s\S]+?-----END EC PRIVATE KEY-----` | Multi-line Block Regex |
| **Private Keys** | PKCS#8 / Generic | `-----BEGIN (?:ENCRYPTED )?PRIVATE KEY-----[\s\S]+?-----END (?:ENCRYPTED )?PRIVATE KEY-----` | Multi-line Block Regex |
| **Private Keys** | OpenSSH Private | `-----BEGIN OPENSSH PRIVATE KEY-----[\s\S]+?-----END OPENSSH PRIVATE KEY-----` | Multi-line Block Regex |
| **Private Keys** | PGP Private Key | `-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]+?-----END PGP PRIVATE KEY BLOCK-----` | Multi-line Block Regex |
| **SAP RFC** | RFC Password Param | `(?i)\b(rfc_pass(?:word)?\|passwd\|password\|pwd)\s*[:=]\s*['"]?([^'"\s;,]{4,})['"]?` | Contextual Regex |
| **SAP RFC** | RFC Parameter Block | `(?i)\b(ASHOST\|MSHOST\|GWHOST\|GWSERV\|SYSNR\|CLIENT\|USER\|PASSWD\|RFC_USER\|RFC_PASS)\s*=\s*['"]?([^,\s'";\n]+)['"]?` | Multi-param Scanner |
| **SAP RFC** | SAProuter Password | `(?i)/H/[^/]+/W/([^/]+)/H/` | Delimited Path Regex |
| **SAP RFC** | Connection URI | `(?i)sap(?:s)?://(?:[^:]+):([^@]+)@[^/]+` | URI Credential Scanner |
| **Unstructured** | High Entropy Token | Token candidate with length $\ge 16$ and $H \ge 4.5$ (Base64) or $H \ge 3.2$ (Hex) | Sliding-Window Entropy Engine |

---

### 2.2 Shannon Entropy Mathematical Model & Calibration

For unstructured secrets without explicit keywords (e.g. raw credentials in custom tables, obfuscated API tokens, generated private secrets), regular expressions fail. The engine applies **Shannon Entropy Analysis**:

$$H(S) = -\sum_{i=1}^{k} P(c_i) \log_2 P(c_i)$$

Where:
- $S$ is a candidate token of length $N = |S|$
- $k$ is the count of distinct character symbols occurring in $S$
- $P(c_i) = \frac{\text{count}(c_i)}{N}$ is the empirical probability of character $c_i$ in string $S$

#### Character Set Baselines & Threshold Calibration

```
ENTROPY SPECTRUM (Bits per character)
0.0                                3.0           4.0           5.0                6.0
 │                                  │             │             │                  │
 ├──────────────────────────────────┼─────────────┼─────────────┼──────────────────┤
 │ Low Entropy                      │ Natural Lang│ Hex Secrets │ Base64 Secrets   │
 │ "AAAAAAAAAAAAAA" (H=0.0)         │ English/ABAP│ MD5/SHA256  │ Random 256-bit   │
 │ "1234567812345678" (H=1.0)       │ (H=2.5-3.8) │ (H=3.5-3.9) │ (H=5.5-5.9)      │
```

1. **Base64 / Alphanumeric Tokens** ($\Sigma \approx 64$ characters, $\max H = 6.0$):
   - Length Gate: $|S| \ge 20$
   - Entropy Threshold: $H(S) \ge 4.50$
   - Exclusions: Standard camelCase identifiers, lowercase prose sentences.
2. **Hexadecimal Tokens** ($\Sigma = 16$ characters, $\max H = 4.0$):
   - Length Gate: $|S| \ge 32$
   - Entropy Threshold: $H(S) \ge 3.20$
   - Exclusions: Standard UUIDs (`[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`), Git commit SHAs when preceded by `commit` or `git`.
3. **Password Context Tokens** (preceded by assignment keywords like `key`, `pass`, `token`):
   - Length Gate: $|S| \ge 8$
   - Entropy Threshold: $H(S) \ge 3.00$

#### False Positive Suppression Allowlist

To avoid redacting legitimate SAP technical identifiers, the engine checks candidate tokens against an immutable allowlist:
- Standard SAP Tables: `MARA`, `VBAK`, `VBAP`, `BKPF`, `BSEG`, `KNA1`, `LFA1`, `EKKO`, `EKPO`, `SWWWIHEAD`, etc.
- ABAP Language Keywords: `SELECT`, `WHERE`, `INTO`, `TABLE`, `APPEND`, `ASSIGN`, `FIELD-SYMBOLS`, `CLASS-METHODS`.
- UUID v4 Format Strings: Formatted with standard hyphens.
- MIME Headers / Media Types: `application/json`, `text/xml; charset=UTF-8`.
- Known Public Checksums: jQuery SRI hashes, static font hashes.

---

### 2.3 Deterministic SHA-256 HMAC Masking Architecture

#### Mask Format
All detected secrets are replaced with the standardized deterministic mask:
```
[REDACTED:SECRET:sha256_hash]
```
Where `sha256_hash` is the lowercase hex string representing the HMAC-SHA256 of the secret value.

#### Mathematical Definition
$$\text{Mask}(S, T) = \text{"[REDACTED:SECRET:"} \mathbin{\Vert} \text{HMAC-SHA256}\big(K_T, S\big) \mathbin{\Vert} \text{"]"}$$

Where:
- $S$ is the verbatim secret value.
- $T$ is the Tenant ID (`organization_id`).
- $K_T$ is the Tenant Redaction Key derived via HKDF or HMAC from the master system encryption key:
  $$K_T = \text{HMAC-SHA256}\big(\text{MASTER\_ENCRYPTION\_KEY}, T\big)$$

#### Why Deterministic HMAC is Mandatory:
1. **Referential Integrity for Security Auditing**:
   - If an insecure RFC service account password `SecretPass2026!` is hardcoded in 15 different ABAP programs and 3 RFC destination profiles across a client's transport request, all 18 occurrences resolve to the *exact same deterministic mask*.
   - The analysis engines (e.g., `SystemRefreshDeltaGuard`, `CleanCoreObjectGuard`) can flag: *"Identical RFC credentials reused across 18 distinct artifacts"* without ERP Preflight ever storing or exposing the plain-text password!
2. **Rainbow-Table / Precomputation Resistance**:
   - A naive SHA-256 hash `sha256("Password123!")` is trivially reversible using public rainbow tables.
   - The tenant-scoped salt $K_T$ guarantees that dictionary attacks against the mask are mathematically infeasible without knowing $K_T$.
3. **Cross-Tenant Privacy Isolation**:
   - If Tenant A and Tenant B happen to use the same default SAP password (`InitPass1!`), their masks differ completely because $K_{T_A} \neq K_{T_B}$. Neither tenant can correlate data across organizational boundaries.
4. **Syntax Non-Breaking**:
   - The mask characters `[REDACTED:SECRET:...]` are valid in ABAP string literals, XML CDATA/text nodes, and JSON string values without triggering parse errors.

---

### 2.4 Multi-Stage Execution Pipeline

```
Raw Content Stream (ABAP / XML / JSON / Config / Log)
                       │
                       ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 1: Line-by-Line Tokenization & Block Extraction       │
 │ - Multi-line Block Scanner (Extracts RSA/EC/PGP private keys)│
 │ - Splits text into lines and column offsets                 │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 2: High-Priority Regex Matching                       │
 │ - Bearer tokens, JWT headers                                │
 │ - Cloud API keys (AWS, OpenAI, GitHub)                      │
 │ - SAP RFC parameters & SAProuter connection strings         │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 3: Contextual Key-Value & Assignment Matching        │
 │ - Matches password=..., passwd: ..., rfc_pass = ...         │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 4: Sliding-Window Shannon Entropy Scanner             │
 │ - Evaluates unclassified tokens (length >= 16)              │
 │ - Filters against Allowlist (Tables, Keywords, UUIDs)       │
 │ - Flags tokens with H >= 4.50 (Base64) or H >= 3.20 (Hex)   │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 5: Deterministic HMAC Replacement & Metadata Ledger   │
 │ - Computes HMAC-SHA256(K_T, secret)                         │
 │ - Performs non-overlapping string substitution              │
 │ - Generates structured RedactionMetadata record             │
 └─────────────────────────────┬───────────────────────────────┘
                               │
                               ▼
 Sanitized Content + Redaction Audit Manifest
```

---

### 2.5 Dual-Engine Implementation Specification

Redaction must occur in two locations within ERP Preflight:
1. **`apps/api` (TypeScript)**: During upload ingestion before saving clean files to S3 and dispatching jobs to BullMQ.
2. **`services/analysis-python` (Python)**: Inside the analysis engine when extracting code snippets for evidence and constructing finding objects, ensuring no downstream LLM gateway or finding log leaks credentials.

#### 1. TypeScript Implementation Architecture (`packages/redaction` or `apps/api/src/modules/redaction`)

```typescript
// packages/redaction/src/redactor.ts
import * as crypto from 'crypto';

export interface RedactionFinding {
  category: 'BEARER_TOKEN' | 'JWT' | 'AWS_KEY' | 'OPENAI_KEY' | 'GITHUB_TOKEN' | 'PRIVATE_KEY' | 'SAP_RFC_CREDENTIAL' | 'PASSWORD' | 'HIGH_ENTROPY_TOKEN';
  originalLength: number;
  mask: string;
  lineNumber: number;
  columnStart: number;
  columnEnd: number;
  detectionMethod: 'REGEX' | 'ENTROPY' | 'CONTEXTUAL';
}

export interface RedactionResult {
  sanitizedText: string;
  redactionsCount: number;
  redactions: RedactionFinding[];
  sha256Original: string;
  sha256Sanitized: string;
}

export class SecretRedactor {
  private readonly tenantKey: Buffer;

  constructor(masterEncryptionKey: string, tenantId: string) {
    this.tenantKey = crypto
      .createHmac('sha256', Buffer.from(masterEncryptionKey, 'utf-8'))
      .update(tenantId)
      .digest();
  }

  public computeMask(secret: string): string {
    const hash = crypto
      .createHmac('sha256', this.tenantKey)
      .update(secret)
      .digest('hex');
    return `[REDACTED:SECRET:${hash}]`;
  }

  public calculateEntropy(str: string): number {
    const len = str.length;
    if (len === 0) return 0;
    const freqs = new Map<string, number>();
    for (let i = 0; i < len; i++) {
      const char = str[i];
      freqs.set(char, (freqs.get(char) || 0) + 1);
    }
    let entropy = 0;
    for (const count of freqs.values()) {
      const p = count / len;
      entropy -= p * Math.log2(p);
    }
    return entropy;
  }

  public redact(text: string): RedactionResult {
    // 1. Block regex for Private Keys
    // 2. Line-by-line regex & contextual matching
    // 3. Sliding window token entropy evaluation
    // 4. Deterministic mask replacement & metadata collection
    // ...
  }
}
```

#### 2. Python Implementation Architecture (`services/analysis-python/src/platform/redaction.py`)

```python
# services/analysis-python/src/platform/redaction.py
import hmac
import hashlib
import math
import re
from typing import List, Tuple, Dict, Any
from dataclasses import dataclass, field

@dataclass(frozen=True)
class RedactionItem:
    category: str
    mask: str
    line_number: int
    column_start: int
    column_end: int
    detection_method: str

@dataclass
class RedactionResult:
    sanitized_text: str
    redactions_count: int
    redacted_categories: List[str]
    sha256_original: str
    sha256_sanitized: str
    redactions: List[RedactionItem] = field(default_factory=list)

class SecretRedactionEngine:
    """Production-grade hybrid Regex and Shannon Entropy Secret Redactor."""

    PRIVATE_KEY_PATTERN = re.compile(
        r"-----BEGIN (?:[A-Z ]+)?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY(?: BLOCK)?-----",
        re.MULTILINE
    )

    REGEX_PATTERNS = [
        ("BEARER_TOKEN", re.compile(r"(?i)\b(bearer\s+)([a-zA-Z0-9_\-\.=]{20,})\b")),
        ("JWT", re.compile(r"\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_\-]{10,})\b")),
        ("AWS_KEY", re.compile(r"\b((?:AKIA|ASIA|AROA|AIPA|AGPA|AIDA)[A-Z0-9]{16})\b")),
        ("OPENAI_KEY", re.compile(r"\b(sk-(?:proj-)?[a-zA-Z0-9_-]{32,})\b")),
        ("GITHUB_TOKEN", re.compile(r"\b(gh[pousr]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b")),
        ("SAP_RFC_CREDENTIAL", re.compile(r"(?i)\b(rfc_pass(?:word)?|passwd|password|pwd)\s*[:=]\s*['\"]?([^'\"\s;,]{4,})['\"]?")),
        ("SAP_RFC_PARAMS", re.compile(r"(?i)\b(ASHOST|GWHOST|SYSNR|CLIENT|USER|PASSWD|RFC_USER|RFC_PASS)\s*=\s*['\"]?([^,\s'\";\n]+)['\"]?")),
        ("SAPROUTER_PASS", re.compile(r"(?i)/H/[^/]+/W/([^/]+)/H/")),
        ("API_KEY_GENERIC", re.compile(r"(?i)\b(api[_-]?key|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{16,})['\"]?")),
    ]

    def __init__(self, tenant_id: str, master_key: str = "DEFAULT_SALT_FOR_DEV"):
        self.tenant_key = hmac.new(
            master_key.encode("utf-8"),
            tenant_id.encode("utf-8"),
            hashlib.sha256
        ).digest()

    def get_mask(self, secret: str) -> str:
        h = hmac.new(self.tenant_key, secret.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"[REDACTED:SECRET:{h}]"

    @staticmethod
    def shannon_entropy(data: str) -> float:
        if not data:
            return 0.0
        entropy = 0.0
        length = len(data)
        freqs = {}
        for c in data:
            freqs[c] = freqs.get(c, 0) + 1
        for count in freqs.values():
            p = count / length
            entropy -= p * math.log2(p)
        return entropy
```

---

## 3. Component 2: Preflight Report Export Engine

### 3.1 Overview of Deliverables

The Preflight Report Export Engine translates raw PostgreSQL analysis state into 3 enterprise-grade formats:

```
                              ┌────────────────────────────────────────┐
                              │  AnalysisRun State in PostgreSQL 16   │
                              │  (Findings, Evidence, Rules, Metrics)  │
                              └──────────────────┬─────────────────────┘
                                                 │
                                                 ▼
                              ┌────────────────────────────────────────┐
                              │       BullMQ `export-queue` Worker     │
                              │  (Asynchronous, Concurrency: 4)        │
                              └───────┬──────────┬──────────┬──────────┘
                                      │          │          │
                 ┌────────────────────┘          │          └────────────────────┐
                 ▼                               ▼                               ▼
  ┌─────────────────────────────┐ ┌─────────────────────────────┐ ┌─────────────────────────────┐
  │ 1. PDF Assessment Report    │ │ 2. JSON Reproducibility     │ │ 3. PM Traceability Matrix   │
  │ - Executive Scorecard       │ │    Bundle                   │ │ - XLSX Multi-tab Workbook   │
  │ - 6-Axis Clean Core Radar   │ │ - Full Finding Graph (DAG)  │ │ - Clean Core Tiers 1/2/3    │
  │ - Priority Blocker Tables   │ │ - Cryptographic SHA-256     │ │ - SAP Standard Replacements │
  │ - Remediation Architecture  │ │   Evidence Hashes           │ │ - Cutover Sign-Off Gate     │
  │ - White-Label Branding      │ │ - Canonical Merkle Root     │ │ - Flattened RFC-4180 CSV    │
  └──────────────┬──────────────┘ └──────────────┬──────────────┘ └──────────────┬──────────────┘
                 │                               │                               │
                 └───────────────────────┬───────┴───────────────────────────────┘
                                         ▼
                 ┌─────────────────────────────────────────────┐
                 │ S3 / MinIO Clean Storage Upload             │
                 │ (`tenants/{id}/projects/{id}/reports/...`)  │
                 └───────────────────────┬─────────────────────┘
                                         ▼
                 ┌─────────────────────────────────────────────┐
                 │ Pre-Signed Download URL (15 - 60 min TTL)   │
                 └─────────────────────────────────────────────┘
```

---

### 3.2 Deliverable 1: Preflight PDF Assessment Report

#### Design Principles & Layout Architecture
- Standard: ISO 32000-1 (PDF), Letter/A4 format, portrait orientation.
- Color Palette: Enterprise Executive (Midnight Blue `#0F2027`, Sapphire `#203A43`, Accent Emerald `#059669`, Crimson `#DC2626`, Amber `#D97706`).
- Typography: Helvetica / Inter sans-serif with strict hierarchy and clean table line breaks.
- Accessibility & Polish: Running headers with customer project name, dynamic page numbers (`Page X of Y`), confidentiality banners (`CONFIDENTIAL - SAP PREFLIGHT REPORT`).

#### Section Breakdown

1. **Cover Page**:
   - Organization & Project Name, Target SAP S/4HANA Release (e.g. `SAP S/4HANA 2023 FPS02` or `SAP S/4HANA Cloud 2408`).
   - Assessment Timestamp & Unique Audit ID (`Support ID / Audit Token`).
   - Executive Verdict Badge: `GO / READY`, `CONDITIONAL GO`, or `NO-GO / BLOCKED`.
   - Overall Clean Core Readiness Index (e.g., `82.4%`).
2. **Executive Summary & KPI Scorecard**:
   - Executive Summary Narrative: Contextual high-level summary of system readiness, scope of custom objects evaluated, and key architectural bottlenecks.
   - KPI Metrics Grid:
     - Total Findings Count
     - Severity Breakdown: `BLOCKER`, `CRITICAL`, `MAJOR`, `MINOR`, `INFO`
     - Objects Audited (Programs, Tables, Function Groups, Forms, Classes)
     - Estimated Remediation Workdays / Sprint Units
3. **Clean Core 6-Axis Radar Chart**:
   - Visual comparison between **Customer Custom Baseline** and **SAP Clean Core Target (100%)**.
   - Dimensions defined below in Section 3.2.1.
4. **Blocker & Critical Findings Diagnostic Tables**:
   - Dedicated table for every `BLOCKER` and `CRITICAL` finding.
   - Fields: Rule ID, Title, Affected SAP Object, Clean Core Extensibility Tier, Provenance Confidence Badge (`VERIFIED [1.0]`, `RULE_DERIVED [0.85]`, `INFERRED [0.60]`), Exact Remediation Action, Code Evidence Snippet with line number.
5. **Preflight Engine Results Summary**:
   - Overview table summarizing results across all evaluated preflight engines (OPD Guard, FormDoctor, Custom Field Flow, Clean Core Object Guard, API Change Guard, etc.).
6. **Cryptographic Provenance & Audit Appendix**:
   - Table of evidence hashes, input artifact SHA-256 checksums, active engine rule versions, and Merkle root hash for tamper verification.

---

#### 3.2.1 The 6-Axis Clean Core Radar Chart

The radar chart maps the system along 6 core axes, providing an instant visual diagnosis of architectural drift:

```
                             1. Extensibility Compliance
                                      (100%)
                                       / \
                                      /   \
                                     /     \
                                    /   ●   \  (Customer: 85%)
                                   /         \
          6. Security & Creds     /           \    2. API & Integration
                 (100%)          /      ●      \          (100%)
                     \          /               \          /
                      \        /                 \        /
                       \      /         +         \      /
                        \    /                     \    /
                         \  /                       \  /
                          \/                         \/
                          /\                         /\
                         /  \                       /  \
                        /    \                     /    \
                       /      \                   /      \
                      /        \        ●        /        \
                     /          \               /          \
          5. Release & CTS       \             /    3. Custom Code Modern
                 (100%)           \           /           (100%)
                                   \         /
                                    \   ●   /
                                     \     /
                                      \   /
                                       \ /
                            4. Data Model Integrity
                                      (100%)
```

#### Detailed Radar Dimensions & Scoring Algorithms

1. **Extensibility Compliance ($A_1$)**:
   - Measures migration from classic modifications/user-exits to ABAP Cloud / Cloud BAdIs.
   - Formula:
     $$A_1 = 100 \times \left(1.0 - \frac{5 \cdot N_{\text{classic\_mod}} + 2 \cdot N_{\text{tier3\_exit}}}{N_{\text{total\_extensions}}}\right)$$
2. **API & Integration Purity ($A_2$)**:
   - Measures usage of released OData v2/v4, SOAP, and released CDS APIs vs unreleased RFCs/BAPIs.
   - Formula:
     $$A_2 = 100 \times \left(\frac{N_{\text{released\_apis}}}{N_{\text{total\_external\_interfaces}}}\right)$$
3. **Custom Code Modernization ($A_3$)**:
   - Measures absence of obsolete ABAP syntax (`TABLES`, `MOVE`, non-Unicode structures, obsolete dynpros).
   - Formula:
     $$A_3 = 100 \times \left(1.0 - \frac{N_{\text{obsolete\_syntax\_findings}}}{N_{\text{total\_abap\_units}}}\right)$$
4. **Data Model Integrity ($A_4$)**:
   - Measures adherence to CDS views and encapsulated APIs vs direct SQL queries on standard ERP tables (e.g. `MARA`, `VBAK`, `BKPF`).
   - Formula:
     $$A_4 = 100 \times \left(1.0 - \frac{N_{\text{direct\_db\_access\_blockers}}}{N_{\text{sql\_queries}}}\right)$$
5. **Release & Transport Decoupling ($A_5$)**:
   - Measures independence of Software Collections and absence of cyclic transport dependencies.
   - Formula:
     $$A_5 = 100 \times \left(1.0 - \frac{N_{\text{cyclic\_dependencies}} + N_{\text{cross\_collection\_locks}}}{N_{\text{transports}}}\right)$$
6. **Security & Credential Governance ($A_6$)**:
   - Measures absence of hardcoded RFC credentials, plain-text secrets, and unmapped Fiori authorizations.
   - Formula:
     $$A_6 = 100 \times \left(1.0 - \frac{10 \cdot N_{\text{hardcoded\_secrets}} + 2 \cdot N_{\text{fiori\_403}}}{N_{\text{inspected\_objects}}}\right)$$

#### Radar Chart Rendering Technology
- The radar chart is generated programmatically:
  - In Python: Rendered via `matplotlib` into an in-memory high-DPI PNG or vector SVG and embedded into ReportLab flowables.
  - In Node.js: Rendered via pure vector primitives (`PDFDocument.polygon(...)` in `pdfkit` or SVG paths in `@react-pdf/renderer`), ensuring zero blurry rasterization and zero headless browser overhead.

---

### 3.3 Deliverable 2: JSON Reproducibility Bundle

The JSON Reproducibility Bundle is an immutable, machine-readable artifact for CI/CD gates, enterprise compliance repositories, and third-party auditors.

#### Schema & Graph Topology

```json
{
  "$schema": "https://erppreflight.com/schemas/v1/reproducibility-bundle.json",
  "bundle_id": "c71a3994-52d3-46ea-9a84-0e318991a0b1",
  "metadata": {
    "tenant_id": "893c52e8-d142-4f05-b1a7-f04bf37d1001",
    "project_id": "f5e612a4-b092-4876-8f92-9382f1b0a883",
    "analysis_id": "a190f845-e102-4581-8051-219208a0d912",
    "target_release": "S4H_2023_FPS02",
    "created_at": "2026-09-24T02:18:00Z",
    "generator": "ERP Preflight Engine v1.0.0",
    "engine_versions": {
      "CLEAN_CORE": "1.4.0",
      "OPD_GUARD": "1.2.0",
      "FORM_DOCTOR": "1.1.0",
      "API_CHANGE": "1.3.1"
    }
  },
  "overall_score": 82.4,
  "summary_metrics": {
    "total_findings": 14,
    "blocker_count": 2,
    "critical_count": 3,
    "major_count": 5,
    "minor_count": 4,
    "info_count": 0
  },
  "graph": {
    "nodes": [
      { "id": "artifact:01", "type": "ARTIFACT", "name": "zorder_transfer.abap", "sha256": "4a7d...31e" },
      { "id": "obj:MARA", "type": "SAP_TABLE", "name": "MARA", "tier": "TIER_3_CLASSIC" },
      { "id": "rule:CC_DIRECT_DB", "type": "RULE", "engine": "CLEAN_CORE", "severity": "BLOCKER" },
      { "id": "find:98a1", "type": "FINDING", "rule_id": "CLEAN_CORE_DIRECT_DB_ACCESS", "severity": "BLOCKER" }
    ],
    "edges": [
      { "source": "artifact:01", "target": "find:98a1", "relation": "CONTAINS_FINDING" },
      { "source": "find:98a1", "target": "rule:CC_DIRECT_DB", "relation": "VIOLATES_RULE" },
      { "source": "find:98a1", "target": "obj:MARA", "relation": "AFFECTS_OBJECT" }
    ]
  },
  "findings": [
    {
      "id": "98a129ef-1182-411a-b329-873b8892ca01",
      "rule_id": "CLEAN_CORE_DIRECT_DB_ACCESS",
      "engine": "CLEAN_CORE",
      "severity": "BLOCKER",
      "category": "CLEAN_CORE_DATA_ACCESS",
      "title": "Direct Database Access to Standard SAP Table MARA",
      "description": "Custom program performs direct SELECT on standard table MARA without CDS wrapper.",
      "confidence": "VERIFIED",
      "confidence_score": 1.0,
      "remediation": "Replace SELECT * FROM mara with released CDS view I_Product or I_ProductBasic.",
      "affected_objects": [
        { "name": "MARA", "type": "SAP_TABLE", "tier": "TIER_3_CLASSIC" }
      ],
      "evidence": [
        {
          "artifact_path": "src/zorder_transfer.abap",
          "line_number": 51,
          "snippet": "SELECT * FROM mara INTO TABLE @DATA(lt_mara).",
          "sha256": "8f30...21a",
          "provenance": "VERIFIED"
        }
      ],
      "technical_details": {
        "table": "MARA",
        "access_type": "SELECT",
        "released_cds_replacement": "I_Product"
      }
    }
  ],
  "evidence_hashes": [
    {
      "artifact_path": "src/zorder_transfer.abap",
      "file_sha256": "4a7d...31e",
      "evidence_snippet_sha256": "8f30...21a",
      "line_number": 51
    }
  ],
  "redaction_summary": {
    "total_redactions": 1,
    "categories": ["SAP_RFC_PASSWORD"],
    "masks": ["[REDACTED:SECRET:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08]"]
  },
  "integrity_signature": {
    "algorithm": "HMAC-SHA256",
    "canonical_payload_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "signature": "3b29f0...98a"
  }
}
```

---

### 3.4 Deliverable 3: SAP Migration PM Traceability Matrix (CSV & XLSX)

#### Workbook Architecture (`preflight_matrix.xlsx`)
Designed specifically for **SAP Migration Project Managers, Sprint Leads, and System Integrator (SI) Workstream Leads**:

```
+----------------------------------------------------------------------------------------------------+
|                                    WORKBOOK: preflight_matrix.xlsx                                 |
+----------------------------------------------------------------------------------------------------+
| Sheet 1: Executive Dashboard     | High-level KPIs, Engine Breakdown, Clean Core Tier distribution  |
| Sheet 2: Traceability Matrix     | Comprehensive findings table with remediation sprint tracking   |
| Sheet 3: RFC & Credential Audit  | RFC destinations, hardcoded secret masks, communication users   |
| Sheet 4: Cutover Sign-Off Gate   | Formal Cutover Milestones, sign-off checklist, audit ledger hash|
+----------------------------------------------------------------------------------------------------+
```

#### Detailed Column Structure of Sheet 2: `Traceability Matrix`

| Column Header | Data Type | Formula / Source | Example Value | Purpose for Project Manager |
|---|---|---|---|---|
| **Finding ID** | Text | UUID / Short Code | `FIND-1042` | Unique defect/finding reference |
| **Engine** | Text | Engine Enum | `CLEAN_CORE` | Owning analyzer module |
| **Rule ID** | Text | Rule Identifier | `CC_DIRECT_DB` | Exact preflight rule violated |
| **Severity** | Text (Colored) | Severity Enum | `BLOCKER` | Priority sorting (`BLOCKER` in Red) |
| **Clean Core Tier** | Text | Clean Core Tier Enum | `Tier 3 (Classic)` | Clean core classification |
| **Affected Object Type** | Text | Object Type | `SAP_TABLE` | Technical object category |
| **Affected Object Name** | Text | Object Name | `MARA` | Object name for ABAP team |
| **Finding Title** | Text | Title | `Direct DB Access to MARA` | Brief defect explanation |
| **Description** | Text | Description | Full context | Technical explanation |
| **Remediation Action** | Text | Remediation | `Refactor to CDS I_Product` | Actionable work description |
| **SAP Standard Equivalent** | Text | Technical Details | `I_Product` / `BAPI_...` | Target released API |
| **Confidence Tier** | Text | Confidence Enum | `VERIFIED` | Epistemic certainty |
| **Confidence Score** | Numeric | Score | `1.00` | Machine trust factor |
| **Jira / Ticket ID** | Text (Blank) | User Input | `ERP-4091` | Work tracking key (editable) |
| **Workstream** | Text (Blank) | User Input | `Order-to-Cash (O2C)` | Functional domain (editable) |
| **Sprint / Cutover Phase** | Text (Blank) | User Input | `Sprint 4 / Realization` | Delivery milestone (editable) |
| **Assignee** | Text (Blank) | User Input | `John ABAP Dev` | Responsible developer (editable) |
| **Migration Status** | Dropdown | Open/In Progress/Fixed | `Open` | Progress tracking (editable) |
| **Risk Acceptance** | Dropdown | Yes/No | `No` | Formal deviation sign-off |
| **Evidence Path** | Text | Artifact Path | `src/zorder.abap:51` | Source location |
| **Evidence SHA-256** | Text | SHA-256 Hash | `8f30...21a` | Cryptographic evidence proof |

#### Professional Styling & Formatting Rules:
- Headers: Midnight Blue `#0F2027` background with White bold text, auto-filter enabled across all columns.
- Freeze Panes: Row 1 (Header) frozen; Columns A–D (Finding ID, Engine, Rule ID, Severity) frozen horizontally.
- Conditional Formatting:
  - `BLOCKER`: Soft Red background (`#FEE2E2`) with Dark Red text (`#991B1B`).
  - `CRITICAL`: Soft Amber background (`#FEF3C7`) with Dark Amber text (`#92400E`).
  - `MAJOR`: Soft Yellow background (`#FEF9C3`) with Olive text (`#854D0E`).
  - `VERIFIED`: Soft Green background (`#DCFCE7`) with Dark Green text (`#166534`).
- Data Validation: In-cell dropdowns configured for `Migration Status` (`Open`, `In Progress`, `Resolved`, `Accepted Risk`) and `Risk Acceptance` (`Yes`, `No`).

#### Flattened RFC-4180 CSV Export
- Accompanies the XLSX workbook for direct headless bulk-import into Jira, ServiceNow, Azure DevOps, and SAP Cloud ALM.
- Delimiter: `,` (comma), strictly escaped with quotes for embedded line breaks and commas.
- Encoding: UTF-8 with BOM (`\uFEFF`) to ensure seamless native opening in Microsoft Excel on Windows without character corruption.

---

## 4. Architectural Placement & BullMQ Queue Integration

### 4.1 Redis BullMQ `export-queue` Processing Flow

```
User / API Trigger (POST /api/v1/projects/:id/analyses/:analysisId/export)
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ NestJS API Controller: Validates RBAC & Tenant Context     │
 │ Enqueues job to BullMQ `export-queue`                       │
 │ Returns HTTP 202 Accepted { exportJobId, status: "QUEUED" } │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ BullMQ Worker (`ExportProcessor`)                           │
 │ 1. Fetches AnalysisRun, Findings, Evidence from PostgreSQL  │
 │ 2. Enforces Tenant RLS (`app.current_tenant_id`)            │
 │ 3. Generates Deliverables (PDF, JSON, XLSX, CSV)            │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Storage Transition & Record Creation                        │
 │ 1. Uploads generated artifacts to MinIO / S3 Clean Bucket   │
 │ 2. Records metadata in PostgreSQL `reports` table           │
 │ 3. Publishes completion event to Redis Pub/Sub              │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 Client Polls / SSE: `GET /api/v1/reports/:id/download`
 Returns Signed Pre-Signed S3 Download URL (TTL: 30 minutes)
```

### 4.2 Database Schema Addition: `reports` Table

```sql
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    analysis_id UUID NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
    format TEXT NOT NULL CHECK (format IN ('PDF', 'JSON_BUNDLE', 'XLSX', 'CSV', 'ZIP_ALL')),
    file_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    s3_key TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_reports ON reports
    FOR ALL
    USING (organization_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);

CREATE INDEX idx_reports_analysis_id ON reports(analysis_id);
CREATE INDEX idx_reports_org_project ON reports(organization_id, project_id);
```

---

## 5. API Contracts & Data Transfer Objects (DTOs)

### 5.1 Export Trigger Request (`POST /api/v1/projects/:projectId/analyses/:analysisId/export`)

```typescript
// packages/schemas/src/export.ts
import { z } from 'zod';

export const ExportFormatEnum = z.enum(['PDF', 'JSON_BUNDLE', 'XLSX', 'CSV', 'ZIP_ALL']);
export type ExportFormat = z.infer<typeof ExportFormatEnum>;

export const TriggerExportSchema = z.object({
  format: ExportFormatEnum.default('PDF'),
  whiteLabel: z.object({
    companyName: z.string().optional(),
    logoUrl: z.string().url().optional(),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
    customDisclaimer: z.string().optional(),
  }).optional(),
  includeEvidenceSnippets: z.boolean().default(true),
  filterMinSeverity: z.enum(['BLOCKER', 'CRITICAL', 'MAJOR', 'MINOR', 'INFO']).default('INFO'),
});
export type TriggerExportDto = z.infer<typeof TriggerExportSchema>;

export const ExportJobResponseSchema = z.object({
  exportJobId: z.string().uuid(),
  analysisId: z.string().uuid(),
  status: z.enum(['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED']),
  estimatedSeconds: z.number().default(5),
});
export type ExportJobResponse = z.infer<typeof ExportJobResponseSchema>;

export const ReportDownloadResponseSchema = z.object({
  reportId: z.string().uuid(),
  format: ExportFormatEnum,
  fileName: z.string(),
  downloadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
  checksumSha256: z.string().length(64),
});
export type ReportDownloadResponse = z.infer<typeof ReportDownloadResponseSchema>;
```

---

## 6. Implementation Work Packages & Roadmap

To execute this architecture seamlessly during Milestone 2 build sprints, the implementation is decomposed into 6 discrete, non-conflicting Work Packages:

```
+---------------------------------------------------------------------------------------------------+
|                                  M2 WORK PACKAGE ROADMAP                                          |
+---------------------------------------------------------------------------------------------------+
| WP1: Core Redaction Library       | `packages/redaction` (TS) & `platform/redaction.py` (Python)  |
| WP2: Ingestion & Engine Redaction | Integration into NestJS file ingestion and Python analyzers   |
| WP3: XLSX & CSV Matrix Generator  | Multi-tab ExcelJS workbook + RFC-4180 CSV builder            |
| WP4: Preflight PDF Generator      | Executive layout, vector 6-axis Clean Core radar, blocker tbl |
| WP5: JSON Reproducibility Bundle  | DAG graph builder, cryptographic signature & evidence hashes  |
| WP6: BullMQ Worker & API Endpoints| `export-queue`, PostgreSQL `reports` migration, signed S3 URLs |
+---------------------------------------------------------------------------------------------------+
```

### Detailed Work Package Breakdown

#### WP1: Core Secret & Credential Redaction Package
- **Deliverable**:
  - `packages/redaction/src/index.ts`, `packages/redaction/src/patterns.ts`, `packages/redaction/src/entropy.ts`, `packages/redaction/src/hmac.ts`
  - `services/analysis-python/src/platform/redaction.py`
- **Responsibilities**:
  - Pre-compile regular expressions for Bearer, JWT, AWS, OpenAI, GitHub, Private Keys, SAP RFC parameters.
  - Implement sliding-window Shannon entropy calculator with calibrated length/entropy gates.
  - Implement deterministic HMAC-SHA256 masking (`[REDACTED:SECRET:sha256_hash]`) with tenant key derivation.
  - Unit tests covering all secret classes, edge cases, and clean text invariance.

#### WP2: Ingestion & Analysis Redaction Integration
- **Deliverable**:
  - NestJS Ingestion Interceptor / Service scrubbing uploaded files before clean S3 storage.
  - Python Analysis runner interceptor scrubbing extracted code snippets before finding emission.
- **Responsibilities**:
  - Guarantee that zero raw secrets ever reach PostgreSQL `evidence` or `findings` tables.
  - Emit redaction audit events to `audit_events` tamper-evident ledger.

#### WP3: XLSX & CSV Traceability Matrix Generator
- **Deliverable**:
  - `apps/api/src/modules/export/generators/xlsx.generator.ts` (using `exceljs`)
  - `apps/api/src/modules/export/generators/csv.generator.ts`
- **Responsibilities**:
  - Construct 4-sheet formatted Excel workbook (Executive Dashboard, Traceability Matrix, RFC Security, Sign-Off Gate).
  - Apply enterprise corporate styling, freeze panes, auto-filters, and conditional formatting.
  - Construct RFC-4180 UTF-8 with BOM CSV export.

#### WP4: Preflight PDF Report Generator
- **Deliverable**:
  - `apps/api/src/modules/export/generators/pdf.generator.ts` (or Python ReportLab generator)
  - `apps/api/src/modules/export/generators/radar-chart.ts`
- **Responsibilities**:
  - Vector rendering of 6-Axis Clean Core Radar Chart with polar coordinate projection.
  - Executive layout: Cover page, executive summary cards, blocker tables, engine diagnostics.
  - Running headers/footers with dynamic page numbers and confidentiality banner.

#### WP5: JSON Reproducibility Bundle & Integrity Signature
- **Deliverable**:
  - `apps/api/src/modules/export/generators/json-bundle.generator.ts`
- **Responsibilities**:
  - Build directed finding graph (nodes for artifacts, objects, rules, findings; edges for violations).
  - Collect cryptographic SHA-256 evidence hashes.
  - Generate canonical JSON string and compute HMAC-SHA256 integrity signature.

#### WP6: BullMQ Export Worker & Download Endpoints
- **Deliverable**:
  - Database migration `002_create_reports_table.sql`
  - BullMQ `ExportConsumer` listening on `export-queue`
  - Endpoints: `POST /api/v1/projects/:id/analyses/:id/export`, `GET /api/v1/reports/:id`, `GET /api/v1/reports/:id/download`
  - MinIO / S3 pre-signed URL generation integration.

---

## 7. Verification & Acceptance Criteria

| Check | Target | Verification Method |
|---|---|---|
| **Bearer / JWT Redaction** | 100% detection | Unit tests with diverse tokens and standard auth headers |
| **Private Key Redaction** | 100% detection | Unit tests with RSA, EC, PKCS#8, PGP private key blocks |
| **SAP RFC Credential Redaction** | 100% detection | Tests with `ASHOST`, `PASSWD`, `RFC_PASS`, SAProuter strings |
| **Shannon Entropy Redaction** | High-entropy detection | Tests with 40-char random secrets ($H \ge 4.5$), zero false positives on standard ABAP words |
| **Deterministic HMAC Invariance** | Same mask across runs | Test identical secret produces identical `[REDACTED:SECRET:hash]` across files within tenant |
| **Tenant Mask Isolation** | Cross-tenant divergence | Test same secret produces distinct masks for Tenant A vs Tenant B |
| **PDF Generation** | Valid PDF document | Binary header verification (`%PDF-`), page count $\ge 2$, radar chart present |
| **XLSX Matrix Generation** | Valid Excel workbook | Open with `exceljs`/`openpyxl`, verify 4 sheets, freeze panes, conditional formats |
| **JSON Reproducibility** | Schema valid & signed | `ajv` / Zod validation against bundle schema, verify cryptographic signature |
| **S3 Pre-signed URL** | Downloadable with TTL | HTTP GET on signed URL returns HTTP 200 OK within TTL, 403 when expired |

---

*End of Milestone 2 Technical Blueprint: Secret Redaction & Report Export Engine.*
