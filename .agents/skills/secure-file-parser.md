# Secure Ingestion Pipeline & Hardened File Parsing Playbook

> **Playbook Identifier**: `secure-file-parser`  
> **Authority**: Binding architectural specification for file ingestion, MIME validation, archive extraction, XML/JSON parsing, and secret scrubbing.  
> **Governing Standards**: Part 22.7, OWASP Top 10, CWE-22 (Path Traversal), CWE-611 (XXE), CWE-400 (Resource Exhaustion).  
> **Anchored Cardinal Axiom**: **Cardinal Axiom 2: *"An engine without deterministic logic/evidence/fixtures is not complete."*** (Points 2, 3, 6 — Input Validation, Memory-Bounded Parsers & Line Number Retention)  
> **Applicable Trigger**: Handling user uploads, reading uncompressed byte streams, extracting archives, or parsing structured customer data.

---

## 1. Overview & Threat Model

Enterprise SAP customers upload proprietary configuration extracts, custom code repositories, transport archives, and database dumps into ERP Preflight. These files originate from untrusted external networks and potentially malicious environments.

The ingestion pipeline faces five primary attack vectors:
1. **Decompression Bombs (Zip Bombs)**: Highly compressed recursive archives designed to exhaust server disk space and memory.
2. **Zip Slip / Path Traversal**: Archive entries with relative paths (`../../etc/passwd`) designed to overwrite system files.
3. **XML External Entity (XXE) Attacks**: Malicious XML schemas designed to exfiltrate host files or trigger Server-Side Request Forgery (SSRF).
4. **Secret Leakage**: Ingested SAP configuration files containing unredacted RFC passwords, API keys, or private certificates.
5. **Memory Exhaustion via Streaming Absence**: Reading multi-gigabyte files into memory buffers simultaneously.

### 1.1 Cardinal Axiom 2 Anchoring: Hardened Input Parsing & Coordinate Integrity
This playbook directly enforces Points 2, 3, and 6 of **Cardinal Axiom 2**:
- **Point 2 (Input Schema)**: Strict validation of incoming archives and files before routing to parsers.
- **Point 3 (Deterministic Parser)**: Hardened, memory-bounded artifact parsing (XML, JSON, CSV, ABAP, XDP) rejecting malformed inputs, zip bombs, and XXE attacks.
- **Point 6 (Evidence Coordinates)**: Parsers must retain exact line numbers, column numbers, and byte offsets so downstream engines can construct cryptographic evidence chains without falling back to line 1.


---

## 2. Magic Bytes & MIME Type Verification Standards

Client-supplied `Content-Type` headers and file extensions are untrusted metadata. Every incoming byte stream must be verified against its raw initial magic bytes:

| Format | Magic Bytes / Signature | Validation Rule |
|---|---|---|
| **ZIP / XLSX** | `50 4B 03 04` (`PK..`) | Reject immediately if header does not match PK zip signature. |
| **XML / XDP / WSDL** | `3C 3F 78 6D 6C` (`<?xml`) or `3C` (`<`) | Validate text encoding (UTF-8, UTF-16, ASCII). Reject binary payloads. |
| **JSON** | `7B` (`{`) or `5B` (`[`) with whitespace | Validate top-level object/array structure via streaming JSON reader. |
| **PDF** | `25 50 44 46` (`%PDF`) | Reject non-PDF byte streams immediately. |
| **CSV / ABAP** | Valid UTF-8 / ASCII text stream | Reject null bytes (`\0`) or executable ELF/PE signatures (`4D 5A`, `7F 45 4C 46`). |

---

## 3. Strict Resource Limits & Archive Decompression Protections

To neutralize decompression bombs, archive processors enforce strict physical ceilings:
- **Maximum Archive File Size**: 100 MB standard upload; 2 GB multipart for database dumps.
- **Maximum Expansion Ratio**: **100x** (e.g. a 1 MB zip cannot expand to more than 100 MB).
- **Maximum Total Uncompressed Volume**: **500 MB** total across all files in the archive.
- **Maximum File Count**: 10,000 files per archive.
- **Maximum Nested Archive Depth**: **2 levels** (reject zip-inside-zip-inside-zip).

```python
# services/analysis-python/src/parsers/safe_archive.py
import zipfile
from typing import BinaryIO

MAX_FILE_SIZE = 100 * 1024 * 1024        # 100 MB
MAX_TOTAL_SIZE = 500 * 1024 * 1024       # 500 MB
MAX_RATIO = 100                           # 100:1 expansion ratio
MAX_FILE_COUNT = 10000

def validate_zip_archive(stream: BinaryIO, archive_size: int) -> None:
    if archive_size > MAX_FILE_SIZE:
        raise ValueError(f"Archive exceeds maximum size limit of {MAX_FILE_SIZE} bytes")

    with zipfile.ZipFile(stream, "r") as zf:
        infolist = zf.infolist()
        if len(infolist) > MAX_FILE_COUNT:
            raise ValueError(f"Archive exceeds maximum file count of {MAX_FILE_COUNT}")

        total_uncompressed = 0
        for info in infolist:
            total_uncompressed += info.file_size
            if total_uncompressed > MAX_TOTAL_SIZE:
                raise ValueError("Archive exceeds maximum uncompressed size of 500MB (Zip Bomb protection)")

            # Check expansion ratio per file
            if info.compress_size > 0:
                ratio = info.file_size / info.compress_size
                if ratio > MAX_RATIO:
                    raise ValueError(f"File {info.filename} exceeds safe expansion ratio (100:1)")
```

---

## 4. Path Traversal & Zip Slip Neutralization

Archive member filenames must be validated before extraction:
- Reject any entry containing `../`, `..\`, leading slashes (`/` or `\`), null bytes (`%00`), or Windows drive prefixes (`C:`).
- Canonical path containment check:

```python
import os

def extract_member_safe(zf: zipfile.ZipFile, member: zipfile.ZipInfo, target_dir: str) -> str:
    target_abs = os.path.abspath(target_dir)
    resolved_path = os.path.abspath(os.path.join(target_abs, member.filename))

    # Path traversal check
    if os.path.commonpath([target_abs, resolved_path]) != target_abs:
        raise PermissionError(f"Zip slip path traversal detected: {member.filename}")

    zf.extract(member, target_dir)
    return resolved_path
```

---

## 5. XML External Entity (XXE) & DTD Neutralization

### 5.1 Hardened XML Parsing via `defusedxml`
Standard XML parsers in Python (`xml.etree.ElementTree`, `lxml`, `minidom`) are vulnerable to entity expansion and XXE attacks. All XML parsing in ERP Preflight must use `defusedxml`:

```python
# services/analysis-python/src/parsers/safe_xml.py
import defusedxml.ElementTree as DefusedET
from xml.etree.ElementTree import Element

class SafeXmlParser:
    @staticmethod
    def parse_string(xml_content: str) -> Element:
        try:
            return DefusedET.fromstring(
                xml_content,
                forbid_dtd=True,
                forbid_entities=True,
                forbid_external=True
            )
        except Exception as e:
            raise ValueError(f"XML Security parsing violation: {str(e)}")
```

In TypeScript / Node.js, `fast-xml-parser` must be configured with external DTDs and processing instructions disabled.

---

## 6. Hybrid Secret & Credential Scrubbing (Entropy + Regex)

Before any customer artifact, log line, or code snippet is written to PostgreSQL or evidence stores:
1. Pass raw text through `SecretRedactionEngine`.
2. Apply high-precision regular expressions detecting:
   - SAP RFC Passwords (`RFC_PASS=...`, `PASSWD=...`).
   - SAProuter Strings (`/H/.../W/<password>/H/...`).
   - JWT tokens, AWS access keys, OpenAI/Anthropic API keys.
   - Private key blocks (`-----BEGIN RSA PRIVATE KEY-----`).
3. Compute Shannon entropy on candidate tokens ($L \ge 20$, Entropy $\ge 4.5$; Hex $L \ge 32$, Entropy $\ge 3.2$).
4. Redact detected secrets deterministically using tenant-keyed HMAC:
   $$\text{Mask} = \text{"[REDACTED:SECRET:"} + \text{HMAC}_{\text{tenant\_key}}(\text{secret}) + \text{"]"}$$

---

## 7. Sanitized Error Masking & Memory-Bounded Streaming

### 7.1 Sanitized Errors
Internal filesystem paths (e.g. `/tmp/preflight_tenant_123/var/`), database connection strings, and stack traces must **never** be exposed in public API error responses. Errors must be mapped to sanitized user-facing messages:
- *Internal*: `FileNotFoundError: /var/app/uploads/tenant_42/marc.xml`
- *User Response*: `HTTP 400 Bad Request: Artifact marc.xml could not be located in upload bundle.`

### 7.2 Memory-Bounded Streaming
Files exceeding 10 MB must be processed using streaming chunk readers or line-by-line generators. Never invoke `.read()` on an entire 500 MB database dump.

---

## 8. TypeScript & Python Hardened Implementation Reference

```python
# services/analysis-python/src/platform/redaction.py
import math
import re
import hmac
import hashlib

class SecretRedactionEngine:
    RFC_PASS_PATTERN = re.compile(r'(?i)(rfc_pass|passwd|password)\s*=\s*["\']?([^"\'\s]+)["\']?')
    BEARER_PATTERN = re.compile(r'(?i)bearer\s+([a-zA-Z0-9_\-\.]{20,})')

    def __init__(self, tenant_secret: str):
        self.tenant_key = tenant_secret.encode('utf-8')

    def _mask_secret(self, secret: str) -> str:
        digest = hmac.new(self.tenant_key, secret.encode('utf-8'), hashlib.sha256).hexdigest()[:12]
        return f"[REDACTED:SECRET:{digest}]"

    def scrub(self, text: str) -> str:
        result = self.RFC_PASS_PATTERN.sub(lambda m: f"{m.group(1)}={self._mask_secret(m.group(2))}", text)
        result = self.BEARER_PATTERN.sub(lambda m: f"Bearer {self._mask_secret(m.group(1))}", result)
        return result
```

---

## 9. Non-Negotiable Ingestion Invariants

1. **Magic Bytes Over Extensions**: Validate file signatures against raw initial bytes; never trust file extensions or MIME headers.
2. **Defused XML**: All XML parsing must disable DTDs, external entities, and parameter entities (`defusedxml`).
3. **Archive Bounds**: Enforce expansion ratio (<100x), total volume (<500MB), and path traversal checks on all archives.
4. **Pre-Persistence Redaction**: Scrub secrets in memory before persisting any artifact, log, or evidence snippet.
5. **Sanitized Public Errors**: Never expose local server paths or stack traces in API responses.

### 9.1 Strictly Forbidden Competing Libraries & Patterns (Part 21.42 & AGENTS.md §4.2)
File parsing and ingestion security must enforce strict hardening:
- ❌ **Unvetted Archive Extractors**: Unhardened `unzipper`, `adm-zip`, or raw `tar` packages that lack path traversal (`os.path.commonpath`) and ratio validation (Standard: Hardened Python `zipfile` wrapper with size/expansion ratio guards).
- ❌ **Unsafe XML Parsing**: `xml2js`, standard `xml.etree.ElementTree`, or unconfigured `lxml` resolving external entities (Standard: `defusedxml.ElementTree` with `forbid_dtd=True` and `lxml` with `resolve_entities=False`).
- ❌ **External Scrubbing Services**: Shelling out to external regex scripts or third-party cloud services for secret redaction (Standard: In-memory `SecretRedactionEngine` HMAC masking).

---

## 10. Forbidden Anti-Patterns

- ❌ **Anti-Pattern**: Calling `zipfile.extractall()` without validating individual member target paths.  
  *Violation*: Enables Zip Slip vulnerability, permitting arbitrary file writes on the host system.  
  *Correction*: Validate each member path using `os.path.commonpath()` before extraction.

- ❌ **Anti-Pattern**: Using standard `xml.etree.ElementTree.fromstring()` on customer XML uploads.  
  *Violation*: Exposes the service to XXE file exfiltration and billion-laughs DoS attacks.  
  *Correction*: Use `defusedxml.ElementTree` with `forbid_dtd=True`.

- ❌ **Anti-Pattern**: Persisting raw SAP transport logs containing plaintext passwords into PostgreSQL.  
  *Violation*: Violates enterprise data security and compliance standards.  
  *Correction*: Run logs through `SecretRedactionEngine` prior to database insertion.
