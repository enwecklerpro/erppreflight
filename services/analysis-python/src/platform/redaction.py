import hmac
import hashlib
import math
import os
import re
from typing import List, Dict, Optional, Set
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

    ALLOWLIST: Set[str] = {
        # Core ERP Tables
        "MARA", "MARC", "MARD", "VBAK", "VBAP", "VBEP", "VBKD", "VBRK", "VBRP",
        "BKPF", "BSEG", "BSIS", "BSAS", "BSIK", "BSAK", "BSID", "BSAD",
        "KNA1", "KNB1", "KNVV", "LFA1", "LFB1", "LFM1", "EKKO", "EKPO", "EKET",
        "EKKN", "MKPF", "MSEG", "ACDOCA", "FAGLFLEXA",

        # Workflow, Change Pointers & Transports
        "SWWWIHEAD", "SWWLOGHIST", "SWW_WI2OBJ", "SWETYPV", "SWZAI", "E070", "E071",
        "E071K", "E070A", "E07T", "BD61", "BD50", "BD52", "BDCP", "BDCPS", "BDCP2",
        "CDHDR", "CDPOS", "TBD62", "TBDA2", "BDLS", "EDIDC", "EDID4",

        # DDIC & System Configuration
        "DD02L", "DD02T", "DD03L", "DD04L", "DD04T", "DD08L", "USR02", "USR04",
        "UST04", "TBTCO", "TBTCP", "RFCDES", "T000", "T001", "T001W", "T003",
        "T005", "TCURR", "TVKO", "TVAK", "TVAP", "TADIR", "PROGDIR", "TRDIR",
        "TFDIR", "ENLFDIR", "D010INC", "D010TAB", "ST03N", "USMM",

        # Authorizations & Security
        "AGR_1251", "AGR_AGRS", "AGR_USERS", "AGR_DEFINE", "AGR_FLAGS", "AGR_TCODES",
        "USOBT", "USOBX", "USOBHASH", "S_START", "S_SERVICE",

        # Financial & Account Determination
        "T030", "T030K", "VKOA", "OBYC", "FBKP",

        # ABAP Syntax & Structural Keywords
        "SELECT", "WHERE", "INTO", "TABLE", "APPEND", "ASSIGN", "FIELD-SYMBOLS",
        "CLASS-METHODS", "ENDCLASS", "ENDMETHOD", "DATA", "TYPES", "CONSTANTS",
        "PUBLIC", "SECTION", "PROTECTED", "PRIVATE",

        # MIME & Content Types
        "APPLICATION/JSON", "APPLICATION/XML", "TEXT/PLAIN", "TEXT/CSV",
    }

    UUID_REGEX = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
    SAP_NAMESPACE_REGEX = re.compile(r"^/[A-Z0-9_]{2,10}/[A-Z0-9_]+$", re.IGNORECASE)
    # Upper-case SAP repository / IMG identifiers (e.g. SIMG_CFMENUORFBOB08, ZCL_SALES_ORDER_HELPER)
    SAP_UPPER_IDENTIFIER_REGEX = re.compile(r"^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$")
    SAP_ARCH_PREFIX_REGEX = re.compile(r"^(I_|C_|R_|P_|E_|CL_|IF_|CX_|ZCL_|ZIF_|ZCX_|BAPI_)[A-Z0-9_]+$", re.IGNORECASE)

    PRIVATE_KEY_PATTERN = re.compile(
        r"-----BEGIN (?:[A-Z ]+)?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:[A-Z ]+)?PRIVATE KEY(?: BLOCK)?-----",
        re.MULTILINE
    )

    REGEX_PATTERNS = [
        ("BEARER_TOKEN", re.compile(r"(?i)\b(bearer\s+)([a-zA-Z0-9_\-\.=]{16,})\b")),
        ("JWT", re.compile(r"\b(eyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_\-]{10,})\b")),
        ("AWS_KEY", re.compile(r"\b((?:AKIA|ASIA|AROA|AIPA|AGPA|AIDA)[A-Z0-9]{16})\b")),
        ("OPENAI_KEY", re.compile(r"\b(sk-(?:proj-)?[a-zA-Z0-9_-]{32,})\b")),
        ("GITHUB_TOKEN", re.compile(r"\b(gh[pousr]_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82})\b")),
        ("SAP_RFC_PASSWORD", re.compile(r"(?i)\b(rfc_?pass(?:word)?|passwd|password|pwd)([\"']?\s*[:=]\s*)(?:\"([^\"]*)\"|'([^']*)'|([^\s;,]+))")),
        ("SAP_RFC_PARAMS", re.compile(r"(?i)\b(ASHOST|GWHOST|SYSNR|CLIENT|USER|PASSWD|RFC_USER|RFC_PASS)(\s*=\s*)(?:\"([^\"]*)\"|'([^']*)'|([^\s;,]+))")),
        ("SAPROUTER_PASS", re.compile(r"(?i)((?:/(?:H|S)/[^/\s\"';]+)+/[WP]/)([^/\s\"';]+)")),
        ("API_KEY_GENERIC", re.compile(r"(?i)\b(api[_-]?key|secret[_-]?key|client[_-]?secret)\s*[:=]\s*['\"]?([a-zA-Z0-9_\-\.]{16,})['\"]?")),
    ]

    # Environment variables consulted (in order) for the HMAC master key. No hardcoded fallback.
    MASTER_KEY_ENV_VARS = ("REDACTION_HMAC_KEY", "MASTER_ENCRYPTION_KEY", "TENANT_ENCRYPTION_KEY")
    # Mask used when no master key is configured: secrets are removed without keyed hashing
    # (an unkeyed hash of a low-entropy password would be brute-forceable).
    UNKEYED_MASK = "[REDACTED:SECRET]"
    MASK_TOKEN_PATTERN = r"\[REDACTED:SECRET(?::[0-9a-fA-F]{64})?\]"

    @classmethod
    def resolve_master_key(cls) -> Optional[str]:
        for name in cls.MASTER_KEY_ENV_VARS:
            value = os.environ.get(name)
            if value and value.strip():
                return value
        return None

    def __init__(self, tenant_id: str, master_key: Optional[str] = None):
        self.tenant_id = tenant_id
        if master_key is None:
            master_key = self.resolve_master_key()
        self.master_key = master_key
        self.tenant_key: Optional[bytes] = (
            hmac.new(master_key.encode("utf-8"), tenant_id.encode("utf-8"), hashlib.sha256).digest()
            if master_key
            else None
        )

    @property
    def keyed(self) -> bool:
        return self.tenant_key is not None

    def get_mask(self, secret: str) -> str:
        if self.tenant_key is None:
            return self.UNKEYED_MASK
        h = hmac.new(self.tenant_key, secret.encode("utf-8"), hashlib.sha256).hexdigest()
        return f"[REDACTED:SECRET:{h}]"

    @staticmethod
    def shannon_entropy(data: str) -> float:
        if not data:
            return 0.0
        entropy = 0.0
        length = len(data)
        freqs: Dict[str, int] = {}
        for c in data:
            freqs[c] = freqs.get(c, 0) + 1
        for count in freqs.values():
            p = count / length
            entropy -= p * math.log2(p)
        return entropy

    def is_candidate_token(self, token: str) -> bool:
        clean = token.strip("'\"`,;:()[]{}.<>")
        length = len(clean)
        if length < 16:
            return False

        # 1. Static allowlist & structural UUID exclusion
        if clean.upper() in self.ALLOWLIST:
            return False
        if self.UUID_REGEX.match(clean):
            return False

        # 2. SAP namespace preservation (/COMPANY/..., /SDF/...)
        if self.SAP_NAMESPACE_REGEX.match(clean):
            return False

        # 3. Calculate Shannon entropy
        h = self.shannon_entropy(clean)
        is_hex = bool(re.match(r"^[0-9a-fA-F]+$", clean))

        # 4. Hex-calibrated scanner (MD5/SHA/API hashes)
        if is_hex:
            if length >= 32 and h >= 3.20:
                return True
            if length >= 16 and h >= 3.00:
                return True
            return False

        # 5. Preserve ABAP architectural names if entropy is within natural language bounds (H < 4.10)
        if self.SAP_ARCH_PREFIX_REGEX.match(clean) and h < 4.10:
            return False
        if self.SAP_UPPER_IDENTIFIER_REGEX.match(clean) and h < 4.10:
            return False

        # 6. Length-calibrated entropy scanner for Alphanumeric & Base64 secrets
        # Smooth progression: 16-23: 3.80 | 24-31: 4.00 | >= 32: 4.30
        if 16 <= length <= 23 and h >= 3.80:
            return True
        if 24 <= length <= 31 and h >= 4.00:
            return True
        if length >= 32 and h >= 4.30:
            return True

        return False

    def redact(self, text: str) -> RedactionResult:
        original_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()
        redactions: List[RedactionItem] = []
        categories: Set[str] = set()

        # Step 1: Handle multi-line private key blocks
        sanitized = text
        for match in self.PRIVATE_KEY_PATTERN.finditer(text):
            secret = match.group(0)
            mask = self.get_mask(secret)
            categories.add("PRIVATE_KEY")
            line_no = text[:match.start()].count("\n") + 1
            col_start = match.start() - text.rfind("\n", 0, match.start())
            col_end = col_start + len(secret)
            redactions.append(RedactionItem(
                category="PRIVATE_KEY",
                mask=mask,
                line_number=line_no,
                column_start=col_start,
                column_end=col_end,
                detection_method="BLOCK_REGEX",
            ))

        sanitized = self.PRIVATE_KEY_PATTERN.sub(lambda m: self.get_mask(m.group(0)), sanitized)

        # Step 2: Line by line regex matching
        lines = sanitized.split("\n")
        new_lines: List[str] = []

        for line_idx, line in enumerate(lines, start=1):
            modified_line = line

            # Regex patterns
            for cat, pattern in self.REGEX_PATTERNS:
                def make_replacer(category):
                    def replacer(match):
                        if category == "BEARER_TOKEN":
                            prefix = match.group(1)
                            secret = match.group(2)
                            if secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            return f"{prefix}{mask}"
                        elif category in ("SAP_RFC_PASSWORD", "SAP_RFC_PARAMS"):
                            key = match.group(1)
                            eq = match.group(2)
                            q_double = match.group(3)
                            q_single = match.group(4)
                            unquoted = match.group(5)
                            secret = q_double if q_double is not None else (q_single if q_single is not None else unquoted)
                            if not secret or secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            q = '"' if q_double is not None else ("'" if q_single is not None else "")
                            return f"{key}{eq}{q}{mask}{q}"
                        elif category == "API_KEY_GENERIC":
                            secret = match.group(2)
                            if secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            return match.group(0).replace(secret, mask)
                        elif category == "SAPROUTER_PASS":
                            prefix = match.group(1)
                            secret = match.group(2)
                            if not secret or secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            return f"{prefix}{mask}"
                        else:
                            secret = match.group(1)
                            if secret.startswith("[REDACTED:"):
                                return match.group(0)
                            categories.add(category)
                            mask = self.get_mask(secret)
                            redactions.append(RedactionItem(
                                category=category,
                                mask=mask,
                                line_number=line_idx,
                                column_start=match.start(),
                                column_end=match.end(),
                                detection_method="REGEX",
                            ))
                            return mask
                    return replacer

                modified_line = pattern.sub(make_replacer(cat), modified_line)

            # Step 3: Shannon Entropy scan across tokens in modified_line
            already_redacted_hashes = set(re.findall(r"\[REDACTED:SECRET:([0-9a-fA-F]{64})\]", modified_line))
            tokens = re.split(r"(" + self.MASK_TOKEN_PATTERN + r"|\s+|=|,|;|:|\(|\)|\[|\]|<|>)", modified_line)
            rebuilt_tokens: List[str] = []
            for t in tokens:
                clean_t = t.strip("'\"`,;:()[]{}.<>")
                if (
                    self.is_candidate_token(clean_t)
                    and not clean_t.startswith("[REDACTED:")
                    and clean_t not in already_redacted_hashes
                    and "[REDACTED:" not in t
                ):
                    mask = self.get_mask(clean_t)
                    categories.add("HIGH_ENTROPY_TOKEN")
                    redactions.append(RedactionItem(
                        category="HIGH_ENTROPY_TOKEN",
                        mask=mask,
                        line_number=line_idx,
                        column_start=modified_line.find(clean_t),
                        column_end=modified_line.find(clean_t) + len(clean_t),
                        detection_method="SHANNON_ENTROPY",
                    ))
                    rebuilt_tokens.append(t.replace(clean_t, mask))
                else:
                    rebuilt_tokens.append(t)

            new_lines.append("".join(rebuilt_tokens))

        final_text = "\n".join(new_lines)
        sanitized_hash = hashlib.sha256(final_text.encode("utf-8")).hexdigest()

        return RedactionResult(
            sanitized_text=final_text,
            redactions_count=len(redactions),
            redacted_categories=sorted(list(categories)),
            sha256_original=original_hash,
            sha256_sanitized=sanitized_hash,
            redactions=redactions,
        )
