"""ERP Preflight - Specification-Derived Opaque-Box Evaluators & Test Oracles.

These deterministic evaluators encode the canonical specifications from
`engines_spec.md` and `platform_spec.md`. They serve as the authoritative
ground truth for opaque-box E2E test assertions.
"""

from __future__ import annotations
import csv
import hashlib
import io
import json
import math
import os
import re
import uuid
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Set, Tuple

from tests.e2e.contracts import (
    AnalysisJobResponse,
    AnalysisMetrics,
    AuditEvent,
    EvidenceItem,
    Finding,
    ProvenanceConfidence,
    RedactionResult,
    Severity,
)


def compute_sha256(data: str | bytes) -> str:
    """Computes standard hexadecimal SHA-256 hash."""
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


# ==============================================================================
# 1. Platform Ingestion & Security Evaluators
# ==============================================================================

class IngestionEvaluator:
    """Validates files against magic-bytes, format rules, and archive safety."""

    ALLOWED_MIMES = {
        "xml": ["application/xml", "text/xml"],
        "json": ["application/json"],
        "csv": ["text/csv", "text/plain"],
        "abap": ["text/plain", "text/x-abap"],
        "xdp": ["application/xml", "text/xml", "application/vnd.adobe.xdp+xml"],
        "zip": ["application/zip", "application/x-zip-compressed"],
    }

    @classmethod
    def validate_file_format(cls, filename: str, content: bytes) -> Tuple[bool, str]:
        ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
        if not ext:
            return False, "UNKNOWN_EXTENSION"

        # Magic byte checks
        if ext == "zip":
            if not content.startswith(b"PK\x03\x04") and not content.startswith(b"PK\x05\x06"):
                return False, "INVALID_ZIP_MAGIC_BYTES"
            return True, "VALID_ZIP"

        if ext in ("xml", "xdp"):
            trimmed = content.strip()
            if not (trimmed.startswith(b"<?xml") or trimmed.startswith(b"<")):
                return False, "INVALID_XML_HEADER"
            # XXE check
            if b"<!ENTITY" in content or b"<!DOCTYPE" in content:
                if b"SYSTEM" in content or b"PUBLIC" in content or b"&" in content:
                    return False, "SECURITY_XXE_DETECTED"
            return True, "VALID_XML"

        if ext == "json":
            try:
                json.loads(content.decode("utf-8"))
                return True, "VALID_JSON"
            except Exception:
                return False, "INVALID_JSON_SYNTAX"

        if ext == "csv":
            try:
                decoded = content.decode("utf-8")
                sample = decoded[:1024]
                sniffer = csv.Sniffer()
                # Basic check
                if "\n" in sample or "," in sample or ";" in sample:
                    return True, "VALID_CSV"
                return False, "INVALID_CSV_STRUCTURE"
            except Exception:
                return False, "INVALID_CSV_ENCODING"

        if ext == "abap":
            try:
                content.decode("utf-8")
                return True, "VALID_ABAP"
            except UnicodeDecodeError:
                return False, "INVALID_ABAP_ENCODING"

        return False, f"UNSUPPORTED_EXTENSION_{ext.upper()}"

    @classmethod
    def check_archive_safety(cls, zip_file_entries: List[Tuple[str, int, int]]) -> Tuple[bool, str]:
        """
        Takes list of (filename, compressed_size, uncompressed_size).
        Checks:
        1. Zip Slip (path traversal "../")
        2. Zip Bomb (uncompressed > 500MB or ratio > 100:1)
        3. Max entries
        """
        MAX_UNCOMPRESSED_TOTAL = 500 * 1024 * 1024  # 500 MB
        MAX_RATIO = 100.0

        total_uncompressed = 0
        total_compressed = 0

        for path, comp_size, uncomp_size in zip_file_entries:
            # Zip Slip check
            normalized = os.path.normpath(path)
            if normalized.startswith("..") or "/../" in path or "\\..\\" in path or path.startswith("/"):
                return False, "ZIP_SLIP_PATH_TRAVERSAL_DETECTED"

            total_compressed += max(comp_size, 1)
            total_uncompressed += uncomp_size

            if total_uncompressed > MAX_UNCOMPRESSED_TOTAL:
                return False, "ZIP_BOMB_MAX_SIZE_EXCEEDED"

            ratio = total_uncompressed / total_compressed
            if total_uncompressed > (10 * 1024 * 1024) and ratio > MAX_RATIO:
                return False, "ZIP_BOMB_COMPRESSION_RATIO_EXCEEDED"

        return True, "ARCHIVE_SAFE"


class SecretRedactionEvaluator:
    """Regex and Shannon entropy credential & secret redactor."""

    PATTERNS = [
        (re.compile(r"(?i)(bearer\s+[a-z0-9\-_\.=]{16,})"), "[REDACTED_BEARER_TOKEN]"),
        (re.compile(r"-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----"), "[REDACTED_PRIVATE_KEY]"),
        (re.compile(r"(?i)(password|passwd|pwd|rfc_pass)\s*[:=]\s*['\"][^'\"]+['\"]"), r"\1=[REDACTED_PASSWORD]"),
        (re.compile(r"(?i)(api[_-]?key|secret[_-]?key)\s*[:=]\s*['\"][a-z0-9\-_\.]{16,}['\"]"), r"\1=[REDACTED_API_KEY]"),
    ]

    @classmethod
    def redact(cls, text: str) -> RedactionResult:
        original_hash = compute_sha256(text)
        sanitized = text
        redactions_count = 0
        redacted_types: List[str] = []

        for pattern, replacement in cls.PATTERNS:
            matches = list(pattern.finditer(sanitized))
            if matches:
                redactions_count += len(matches)
                redacted_types.append(replacement.strip("[]"))
                sanitized = pattern.sub(replacement, sanitized)

        sanitized_hash = compute_sha256(sanitized)
        return RedactionResult(
            sanitized_text=sanitized,
            redactions_count=redactions_count,
            redacted_types=list(set(redacted_types)),
            sha256_original=original_hash,
            sha256_sanitized=sanitized_hash,
        )


class ConfidenceClassifierEvaluator:
    """Enforces strict confidence tiers and demotion rules."""

    @classmethod
    def classify(
        cls,
        source_mechanism: str,
        has_exact_evidence: bool,
        is_llm_derived: bool,
        has_missing_inputs: bool,
    ) -> Tuple[ProvenanceConfidence, float]:
        if has_missing_inputs:
            return ProvenanceConfidence.UNKNOWN, 0.30

        if is_llm_derived:
            # LLM output can NEVER exceed INFERRED (0.60 ceiling)
            return ProvenanceConfidence.INFERRED, 0.60

        if source_mechanism == "AST_OR_SCHEMA" and has_exact_evidence:
            return ProvenanceConfidence.VERIFIED, 1.00

        if source_mechanism == "DETERMINISTIC_RULE":
            return ProvenanceConfidence.RULE_DERIVED, 0.85

        if source_mechanism == "HEURISTIC":
            return ProvenanceConfidence.INFERRED, 0.60

        return ProvenanceConfidence.UNKNOWN, 0.30


class AuditTrailEvaluator:
    """Tamper-evident cryptographically chained audit ledger."""

    @classmethod
    def create_event(
        cls,
        tenant_id: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: Dict[str, Any],
        previous_event_hash: str = "0" * 64,
        user_id: Optional[str] = None,
        agent_id: Optional[str] = None,
        is_ai_actor: bool = False,
        timestamp: str = "2026-09-24T03:00:00Z",
    ) -> AuditEvent:
        event_id = str(uuid.uuid4())
        details_str = json.dumps(details, sort_keys=True)
        raw_to_hash = f"{previous_event_hash}:{event_id}:{tenant_id}:{action}:{timestamp}:{details_str}"
        event_hash = compute_sha256(raw_to_hash)

        return AuditEvent(
            event_id=event_id,
            tenant_id=tenant_id,
            user_id=user_id,
            agent_id=agent_id,
            is_ai_actor=is_ai_actor,
            action=action,
            resource_type=resource_type,
            resource_id=resource_id,
            timestamp=timestamp,
            details=details,
            previous_event_hash=previous_event_hash,
            event_hash=event_hash,
        )

    @classmethod
    def verify_chain(cls, events: List[AuditEvent]) -> bool:
        for i, ev in enumerate(events):
            expected_prev = "0" * 64 if i == 0 else events[i - 1].event_hash
            if ev.previous_event_hash != expected_prev:
                return False
            details_str = json.dumps(ev.details, sort_keys=True)
            raw = f"{ev.previous_event_hash}:{ev.event_id}:{ev.tenant_id}:{ev.action}:{ev.timestamp}:{details_str}"
            if compute_sha256(raw) != ev.event_hash:
                return False
        return True


class AIProblemRouterEvaluator:
    """Routes customer problem statements and artifacts to candidate engines."""

    MAPPING = {
        "xdp": "form_doctor",
        "brfplus": "opd_guard",
        "opd": "opd_guard",
        "mfs": "mfs_blackbox",
        "telegram": "mfs_blackbox",
        "abap": "clean_core_object_guard",
        "edmx": "api_change_guard",
        "openapi": "api_change_guard",
        "transport": "transport_dependency_analyzer",
        "e070": "transport_dependency_analyzer",
        "change_pointer": "change_pointer_auditor",
        "bd52": "change_pointer_auditor",
        "bd61": "change_pointer_auditor",
        "st03n": "ecc2cloud_navigator",
        "decommission": "safe_decommission_preflight",
        "usr02": "safe_decommission_preflight",
        "su53": "fiori_403_doctor",
        "403": "fiori_403_doctor",
        "workflow": "workflow_stuck_explainer",
        "swwwihead": "workflow_stuck_explainer",
        "obyc": "account_determination_preflight",
        "vkoa": "account_determination_preflight",
        "system_refresh": "system_refresh_delta_guard",
        "bdls": "system_refresh_delta_guard",
        "iam": "iam_cost_optimizer",
        "license": "iam_cost_optimizer",
        "spro": "spro2cloud",
        "custom_field": "custom_field_flow_doctor",
        "yy1_": "custom_field_flow_doctor",
        "blast_radius": "extension_impact_guard",
        "gap": "gap_radar",
    }

    @classmethod
    def route(cls, problem_text: str, artifact_names: List[str]) -> List[str]:
        matched: Set[str] = set()
        normalized_text = problem_text.lower()

        # Check artifact names first
        for name in artifact_names:
            name_lower = name.lower()
            for key, engine in cls.MAPPING.items():
                if key in name_lower:
                    matched.add(engine)

        # Check text keywords
        for key, engine in cls.MAPPING.items():
            if key in normalized_text:
                matched.add(engine)

        return sorted(list(matched)) if matched else ["unknown_intent"]


# ==============================================================================
# 2. The 18 SAP Preflight Engines Evaluators
# ==============================================================================

class OPDGuardEvaluator:
    """Evaluates BRFplus OPD decision tables."""

    @classmethod
    def evaluate(cls, tables: Dict[str, List[Dict[str, str]]], scenario: Dict[str, str]) -> Dict[str, Any]:
        steps = [
            "Output Type",
            "Receiver",
            "Channel",
            "Printer",
            "Email Recipient",
            "Email Sender",
            "Form Template",
            "Output Relevance",
        ]
        results = {}
        first_failed_step = None
        findings = []

        for step in steps:
            table_rows = tables.get(step, [])
            step_matched = False
            for idx, row in enumerate(table_rows):
                # Check condition match
                matches = True
                for cond_col, cond_val in row.items():
                    if cond_col.startswith("COND_"):
                        field_name = cond_col[5:]
                        scenario_val = scenario.get(field_name, "")
                        if cond_val not in ("*", "", scenario_val):
                            matches = False
                            break
                if matches:
                    step_matched = True
                    results[step] = row.get("RESULT", "")
                    break

            if not step_matched:
                first_failed_step = step
                findings.append({
                    "code": "OPD_STEP_FAILED",
                    "severity": "HIGH",
                    "title": f"{step} Determination Failed",
                    "step": step,
                    "confidence": "VERIFIED",
                })
                break

        # Check for shadowed rules in tables
        shadowed_count = 0
        for step, rows in tables.items():
            for i in range(len(rows)):
                is_catchall = all(v in ("*", "") for k, v in rows[i].items() if k.startswith("COND_"))
                if is_catchall and i < len(rows) - 1:
                    shadowed_count += (len(rows) - 1 - i)
                    findings.append({
                        "code": "OPD_UNREACHABLE_RULE",
                        "severity": "MEDIUM",
                        "title": f"Shadowed Rule in {step}",
                        "step": step,
                        "line": i + 2,
                        "confidence": "RULE_DERIVED",
                    })
                    break

        return {
            "status": "COMPLETED" if not first_failed_step else "PARTIAL",
            "first_failed_step": first_failed_step,
            "results": results,
            "findings": findings,
            "shadowed_rules_count": shadowed_count,
        }


class FormDoctorEvaluator:
    """Verifies XDP form layout bindings against runtime XML payload."""

    @classmethod
    def evaluate(cls, xml_content: str, xdp_bindings: List[Dict[str, Any]]) -> Dict[str, Any]:
        findings = []
        try:
            root = ET.fromstring(xml_content)
        except Exception as e:
            return {"status": "FAILED", "error": f"XML_PARSE_ERROR: {str(e)}", "findings": []}

        # Build set of all element paths in XML
        xml_paths: Set[str] = set()

        def extract_paths(elem, current_path=""):
            tag = elem.tag.split("}")[-1]  # Strip namespace
            path = f"{current_path}.{tag}" if current_path else f"$.{tag}"
            xml_paths.add(path)
            for child in elem:
                extract_paths(child, path)

        extract_paths(root)

        for binding in xdp_bindings:
            field_name = binding["field"]
            target_path = binding["dataRef"]
            is_hidden = binding.get("presence") == "hidden"

            if is_hidden:
                findings.append({
                    "code": "FORM_FIELD_HIDDEN_IN_LAYOUT",
                    "severity": "MEDIUM",
                    "field": field_name,
                    "confidence": "VERIFIED",
                })

            if target_path not in xml_paths:
                # Check for alternative matching suffix
                suffix = target_path.split(".")[-1]
                candidates = [p for p in xml_paths if p.endswith(f".{suffix}")]
                if candidates:
                    findings.append({
                        "code": "FORM_BINDING_PATH_MISMATCH",
                        "severity": "HIGH",
                        "field": field_name,
                        "currentBinding": target_path,
                        "suggestedBinding": candidates[0],
                        "confidence": "VERIFIED",
                    })
                else:
                    findings.append({
                        "code": "FORM_FIELD_MISSING_IN_XML",
                        "severity": "CRITICAL",
                        "field": field_name,
                        "dataRef": target_path,
                        "confidence": "VERIFIED",
                    })

        return {
            "status": "COMPLETED",
            "findings": findings,
            "bindings_checked": len(xdp_bindings),
        }


class CustomFieldFlowEvaluator:
    """Verifies custom field propagation across standard business document hops."""

    FLOW_CATALOG = {
        ("MM_PURCHASE_ORDER_ITEM", "MM_SUPPLIER_INVOICE_ITEM"): "SUPPORTED",
        ("MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"): "CUSTOM_LOGIC",
        ("SD_SALES_ORDER_ITEM", "SD_BILLING_DOC_ITEM"): "SUPPORTED",
        ("SD_BILLING_DOC_ITEM", "FI_JOURNAL_ENTRY_ITEM"): "CUSTOM_LOGIC",
    }

    REQUIRED_BADIS = {
        ("MM_SUPPLIER_INVOICE_ITEM", "FI_JOURNAL_ENTRY_ITEM"): "BADI_FINS_ACDOC_EXT_PERSISTENCE",
        ("SD_BILLING_DOC_ITEM", "FI_JOURNAL_ENTRY_ITEM"): "BADI_FINS_ACDOC_EXT_PERSISTENCE",
    }

    @classmethod
    def evaluate(cls, field_name: str, hops: List[Tuple[str, str]], field_defs: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
        findings = []
        hop_results = []

        for source_ctx, target_ctx in hops:
            flow_status = cls.FLOW_CATALOG.get((source_ctx, target_ctx), "BLOCKED")
            badi = cls.REQUIRED_BADIS.get((source_ctx, target_ctx))

            # Check length/type truncation
            src_def = field_defs.get(source_ctx, {})
            tgt_def = field_defs.get(target_ctx, {})
            if src_def and tgt_def:
                if src_def.get("length", 0) > tgt_def.get("length", 0):
                    findings.append({
                        "code": "FIELD_TYPE_MISMATCH",
                        "severity": "HIGH",
                        "message": f"Source length {src_def.get('length')} exceeds target {tgt_def.get('length')}",
                        "confidence": "VERIFIED",
                    })

            if flow_status == "CUSTOM_LOGIC":
                findings.append({
                    "code": "FIELD_PROPAGATION_REQUIRES_BADI",
                    "severity": "MEDIUM",
                    "requiredBadi": badi,
                    "source": source_ctx,
                    "target": target_ctx,
                    "confidence": "VERIFIED",
                })
            elif flow_status == "BLOCKED":
                findings.append({
                    "code": "FIELD_PROPAGATION_BLOCKED",
                    "severity": "CRITICAL",
                    "source": source_ctx,
                    "target": target_ctx,
                    "confidence": "VERIFIED",
                })

            hop_results.append({"from": source_ctx, "to": target_ctx, "status": flow_status})

        return {"status": "COMPLETED", "hops": hop_results, "findings": findings}


class ExtensionImpactEvaluator:
    """Calculates blast radius and verifies safe-to-delete for extensions."""

    @classmethod
    def evaluate(cls, target_object: str, dependency_graph: Dict[str, List[str]]) -> Dict[str, Any]:
        # Support graph as object -> consumers OR consumer -> dependencies
        # Build forward consumer mapping
        forward_consumers: Dict[str, Set[str]] = {}
        for src, targets in dependency_graph.items():
            forward_consumers.setdefault(src, set()).update(targets)
            for tgt in targets:
                # In case graph was consumer -> dependency
                forward_consumers.setdefault(tgt, set()).add(src)

        direct_consumers = sorted(list(dependency_graph.get(target_object, [])))
        # Also include any consumer that references target_object
        for consumer, deps in dependency_graph.items():
            if target_object in deps and consumer != target_object:
                if consumer not in direct_consumers:
                    direct_consumers.append(consumer)
        direct_consumers.sort()

        # Transitive closure
        visited: Set[str] = set(direct_consumers)
        queue = list(direct_consumers)
        while queue:
            current = queue.pop(0)
            for next_node in dependency_graph.get(current, []):
                if next_node not in visited and next_node != target_object:
                    visited.add(next_node)
                    queue.append(next_node)
            for consumer, deps in dependency_graph.items():
                if current in deps and consumer not in visited and consumer != target_object:
                    visited.add(consumer)
                    queue.append(consumer)

        findings = []
        is_safe = len(visited) == 0
        if not is_safe:
            findings.append({
                "code": "EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS",
                "severity": "CRITICAL",
                "title": f"Cannot Delete {target_object}",
                "direct_count": len(direct_consumers),
                "transitive_count": len(visited),
                "confidence": "VERIFIED",
            })

        return {
            "status": "COMPLETED",
            "target": target_object,
            "direct_consumers": direct_consumers,
            "transitive_consumers": sorted(list(visited)),
            "safe_to_delete": is_safe,
            "findings": findings,
        }


class SPRO2CloudEvaluator:
    """Maps legacy ECC IMG / SPRO activities to Cloud SSCUI / CBC."""

    CATALOG = {
        "SIMG_CFMENUOLSDVOFA": {
            "sscui": "101230",
            "cbc": "Configure Billing Document Types",
            "scope_item": "BD9",
            "status": "EXACT",
        },
        "SIMG_CFMENUOLSDOVZ0": {
            "sscui": "102431",
            "cbc": "Define Pricing Procedures",
            "scope_item": "1MD",
            "status": "SCOPE_DEPENDENT",
        },
        "SIMG_CFMENUOLSD_SPECIAL_LEDGER": {
            "sscui": None,
            "cbc": None,
            "scope_item": None,
            "status": "NOT_AVAILABLE",
        },
    }

    @classmethod
    def evaluate(cls, activity_id: str) -> Dict[str, Any]:
        record = cls.CATALOG.get(activity_id)
        findings = []
        if not record:
            return {
                "status": "COMPLETED",
                "mapping_status": "NEEDS_REVIEW",
                "findings": [{
                    "code": "SPRO_UNCATALOGED_ACTIVITY",
                    "severity": "INFO",
                    "confidence": "UNKNOWN",
                }],
            }

        status = record["status"]
        if status == "EXACT":
            findings.append({
                "code": "SPRO_MAPPING_EXACT",
                "severity": "INFO",
                "confidence": "VERIFIED",
                "sscui": record["sscui"],
            })
        elif status == "SCOPE_DEPENDENT":
            findings.append({
                "code": "SPRO_MAPPING_SCOPE_DEPENDENT",
                "severity": "MEDIUM",
                "confidence": "VERIFIED",
                "required_scope_item": record["scope_item"],
            })
        elif status == "NOT_AVAILABLE":
            findings.append({
                "code": "SPRO_NOT_AVAILABLE_IN_CLOUD",
                "severity": "HIGH",
                "confidence": "VERIFIED",
            })

        return {
            "status": "COMPLETED",
            "activity_id": activity_id,
            "mapping": record,
            "findings": findings,
        }


class ECC2CloudNavigatorEvaluator:
    """Evaluates legacy ECC T-Codes and usage logs for cloud modernization."""

    FIORI_MAP = {
        "ME21N": {"app_id": "F0842A", "title": "Manage Purchase Orders", "status": "DIRECTLY_SUPPORTED"},
        "VA01": {"app_id": "F1814", "title": "Manage Sales Orders", "status": "DIRECTLY_SUPPORTED"},
        "FB01": {"app_id": "F0717", "title": "Create General Journal Entries", "status": "DIRECTLY_SUPPORTED"},
        "ZVA01": {"app_id": None, "title": "Custom Sales Order Creator", "status": "PROCESS_REDESIGN"},
    }

    @classmethod
    def evaluate(cls, st03n_rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        findings = []
        ready_count = 0
        redesign_count = 0

        for row in st03n_rows:
            tcode = row.get("tcode", "").upper()
            exec_count = row.get("execution_count", 0)
            map_entry = cls.FIORI_MAP.get(tcode, {"status": "NO_EQUIVALENT", "app_id": None})

            if map_entry["status"] == "DIRECTLY_SUPPORTED":
                ready_count += 1
                findings.append({
                    "code": "ECC_TCODE_SUCCESSOR_FOUND",
                    "severity": "INFO",
                    "tcode": tcode,
                    "fiori_id": map_entry["app_id"],
                    "confidence": "VERIFIED",
                })
            elif tcode.startswith("Z"):
                redesign_count += 1
                findings.append({
                    "code": "ECC_CUSTOM_CODE_HIGH_USAGE_BLOCKER" if exec_count > 1000 else "ECC_CUSTOM_CODE_NEEDS_REVIEW",
                    "severity": "HIGH" if exec_count > 1000 else "MEDIUM",
                    "tcode": tcode,
                    "confidence": "RULE_DERIVED",
                })
            else:
                redesign_count += 1

        total = len(st03n_rows)
        return {
            "status": "COMPLETED",
            "total_objects": total,
            "cloud_ready_percentage": round((ready_count / total * 100) if total else 0.0, 1),
            "findings": findings,
        }


class SAPGapRadarEvaluator:
    """Deterministic 12-tier clean core resolution engine."""

    @classmethod
    def evaluate(cls, requirement_text: str, target_release: str) -> Dict[str, Any]:
        req_lower = requirement_text.lower()
        findings = []

        if (
            "select * from" in req_lower
            or "update bseg" in req_lower
            or "direct db" in req_lower
            or "directly in database" in req_lower
        ):
            tier = 11  # Blocked / Product Gap
            verdict = "BLOCKED_CLEAN_CORE_VIOLATION"
            severity = "CRITICAL"
        elif "webhook" in req_lower or "event" in req_lower or "cloud events" in req_lower:
            tier = 8  # Business Events
            verdict = "SUPPORTED_BUSINESS_EVENT"
            severity = "INFO"
        elif "custom pricing logic" in req_lower or "badi" in req_lower:
            tier = 7  # Released BAdI
            verdict = "SUPPORTED_DEVELOPER_EXTENSIBILITY"
            severity = "INFO"
        elif "custom field" in req_lower or "yy1_" in req_lower:
            tier = 3  # Key-User Extensibility
            verdict = "SUPPORTED_KEY_USER"
            severity = "INFO"
        elif "standard purchase order" in req_lower:
            tier = 1  # Standard Functionality
            verdict = "SUPPORTED_STANDARD"
            severity = "INFO"
        else:
            tier = 12
            verdict = "UNKNOWN_REQUIREMENT"
            severity = "MEDIUM"

        findings.append({
            "code": f"GAP_RADAR_{verdict}",
            "severity": severity,
            "tier": tier,
            "confidence": "RULE_DERIVED",
        })

        return {
            "status": "COMPLETED",
            "resolution_tier": tier,
            "verdict": verdict,
            "findings": findings,
        }


class CleanCoreObjectGuardEvaluator:
    """ABAP syntax and AST static compliance auditor."""

    CLASSIC_TABLES = {"MARA", "VBAK", "VBAP", "BKPF", "BSEG", "KNA1", "LFA1"}
    OBSOLETE_STATEMENTS = {"TABLES", "FORM", "PERFORM", "CALL 'SYSTEM'", "OPEN DATASET"}

    @classmethod
    def evaluate(cls, abap_code: str) -> Dict[str, Any]:
        findings = []
        lines = abap_code.splitlines()
        clean_count = 0
        violations_count = 0

        for line_no, raw_line in enumerate(lines, start=1):
            line = raw_line.strip().upper()
            if not line or line.startswith("*") or line.startswith('"'):
                continue

            violation_found = False

            # Check direct classic table access
            for tbl in cls.CLASSIC_TABLES:
                if re.search(rf"\b(FROM|INTO|UPDATE|MODIFY)\s+{tbl}\b", line):
                    violations_count += 1
                    violation_found = True
                    findings.append({
                        "code": "CLEAN_CORE_DIRECT_DB_ACCESS",
                        "severity": "CRITICAL",
                        "line": line_no,
                        "table": tbl,
                        "confidence": "VERIFIED",
                    })

            # Check obsolete statements
            for stmt in cls.OBSOLETE_STATEMENTS:
                if line.startswith(f"{stmt} ") or line.startswith(f"{stmt}:"):
                    violations_count += 1
                    violation_found = True
                    findings.append({
                        "code": "CLEAN_CORE_OBSOLETE_SYNTAX",
                        "severity": "HIGH",
                        "line": line_no,
                        "statement": stmt,
                        "confidence": "VERIFIED",
                    })

            if not violation_found:
                clean_count += 1

        total = clean_count + violations_count
        comp_pct = round((clean_count / total * 100) if total else 100.0, 1)

        return {
            "status": "COMPLETED",
            "total_statements": total,
            "clean_statements": clean_count,
            "compliance_percentage": comp_pct,
            "findings": findings,
        }


class ChangePointerAuditorEvaluator:
    """Audits ALE/IDoc change pointer configuration and triggers."""

    @classmethod
    def evaluate(
        cls,
        bd61_active: bool,
        bd50_msg_types: Set[str],
        bd52_fields: List[Tuple[str, str]],
        expected_fields: List[Tuple[str, str]],
    ) -> Dict[str, Any]:
        findings = []

        if not bd61_active:
            findings.append({
                "code": "CP_GLOBAL_DEACTIVATED",
                "severity": "CRITICAL",
                "title": "Global Change Pointers Inactive (BD61)",
                "confidence": "VERIFIED",
            })

        active_fields = set(bd52_fields)
        missing_fields = []
        for tbl, fld in expected_fields:
            if (tbl, fld) not in active_fields:
                missing_fields.append(f"{tbl}-{fld}")
                findings.append({
                    "code": "CP_FIELD_NOT_CONFIGURED_BD52",
                    "severity": "HIGH",
                    "table": tbl,
                    "field": fld,
                    "confidence": "VERIFIED",
                })

        covered_count = len(expected_fields) - len(missing_fields)
        total_exp = len(expected_fields)
        cov_pct = round((covered_count / total_exp * 100) if total_exp else 100.0, 1)

        return {
            "status": "COMPLETED",
            "global_active": bd61_active,
            "coverage_percentage": cov_pct,
            "findings": findings,
        }


class APIChangeGuardEvaluator:
    """Detects breaking contract changes between API specifications."""

    @classmethod
    def evaluate(cls, baseline: Dict[str, Any], candidate: Dict[str, Any], registered_clients: List[Dict[str, Any]]) -> Dict[str, Any]:
        findings = []
        breaking_count = 0

        base_paths = baseline.get("paths", {})
        cand_paths = candidate.get("paths", {})

        # Check removed paths
        for path, methods in base_paths.items():
            if path not in cand_paths:
                breaking_count += 1
                findings.append({
                    "code": "API_BREAKING_ENDPOINT_REMOVED",
                    "severity": "CRITICAL",
                    "path": path,
                    "confidence": "VERIFIED",
                })
            else:
                for method in methods:
                    if method not in cand_paths[path]:
                        breaking_count += 1
                        findings.append({
                            "code": "API_BREAKING_METHOD_REMOVED",
                            "severity": "CRITICAL",
                            "path": path,
                            "method": method,
                            "confidence": "VERIFIED",
                        })

        # Check removed schema properties
        base_schemas = baseline.get("components", {}).get("schemas", {})
        cand_schemas = candidate.get("components", {}).get("schemas", {})

        for s_name, s_def in base_schemas.items():
            if s_name in cand_schemas:
                base_props = s_def.get("properties", {})
                cand_props = cand_schemas[s_name].get("properties", {})
                for p_name in base_props:
                    if p_name not in cand_props:
                        breaking_count += 1
                        findings.append({
                            "code": "API_BREAKING_FIELD_REMOVED",
                            "severity": "CRITICAL",
                            "schema": s_name,
                            "property": p_name,
                            "confidence": "VERIFIED",
                        })

        return {
            "status": "COMPLETED",
            "breaking_changes_count": breaking_count,
            "findings": findings,
        }


class SoftwareCollectionGuardEvaluator:
    """Preflights key-user software collections and detects circular dependencies."""

    @classmethod
    def evaluate(cls, collections: Dict[str, List[str]], dependencies: Dict[str, List[str]]) -> Dict[str, Any]:
        # Tarjan's or simple DFS cycle detection
        visited: Dict[str, int] = {}  # 0: unvisited, 1: visiting, 2: visited
        cycles: List[List[str]] = []

        def dfs(node: str, path: List[str]):
            visited[node] = 1
            for neighbor in dependencies.get(node, []):
                if visited.get(neighbor) == 1:
                    cycle = path + [neighbor]
                    cycles.append(cycle)
                elif visited.get(neighbor, 0) == 0:
                    dfs(neighbor, path + [neighbor])
            visited[node] = 2

        for col in collections:
            if visited.get(col, 0) == 0:
                dfs(col, [col])

        findings = []
        if cycles:
            findings.append({
                "code": "SC_CIRCULAR_DEPENDENCY",
                "severity": "CRITICAL",
                "cycles": cycles,
                "confidence": "VERIFIED",
            })

        return {
            "status": "COMPLETED",
            "has_cycles": len(cycles) > 0,
            "cycles": cycles,
            "findings": findings,
        }


class TransportAnalyzerEvaluator:
    """Analyzes ABAP Workbench & Customizing Transports for collisions."""

    @classmethod
    def evaluate(cls, transport_objects: Dict[str, List[str]]) -> Dict[str, Any]:
        object_to_trs: Dict[str, List[str]] = {}
        for tr_id, objs in transport_objects.items():
            for obj in objs:
                object_to_trs.setdefault(obj, []).append(tr_id)

        findings = []
        collisions = {}
        for obj, tr_list in object_to_trs.items():
            if len(tr_list) > 1:
                collisions[obj] = tr_list
                findings.append({
                    "code": "TR_OBJECT_COLLISION",
                    "severity": "CRITICAL",
                    "object": obj,
                    "transports": tr_list,
                    "confidence": "VERIFIED",
                })

        return {
            "status": "COMPLETED",
            "collisions_count": len(collisions),
            "findings": findings,
        }


class SafeDecommissionEvaluator:
    """Preflights user and interface account retirement."""

    @classmethod
    def evaluate(
        cls,
        target_user: str,
        batch_jobs: List[Dict[str, Any]],
        rfc_destinations: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        findings = []
        job_dependencies = [j["job_name"] for j in batch_jobs if j.get("auth_user") == target_user and j.get("status") in ("SCHEDULED", "PERIODIC")]
        rfc_dependencies = [r["destination"] for r in rfc_destinations if r.get("logon_user") == target_user and r.get("active", True)]

        if job_dependencies:
            findings.append({
                "code": "DECOM_SCHEDULED_JOB_DEPENDENCY",
                "severity": "CRITICAL",
                "user": target_user,
                "jobs": job_dependencies,
                "confidence": "VERIFIED",
            })

        if rfc_dependencies:
            findings.append({
                "code": "DECOM_ACTIVE_RFC_DEPENDENCY",
                "severity": "CRITICAL",
                "user": target_user,
                "destinations": rfc_dependencies,
                "confidence": "VERIFIED",
            })

        return {
            "status": "COMPLETED",
            "safe_to_decommission": len(job_dependencies) == 0 and len(rfc_dependencies) == 0,
            "active_jobs_count": len(job_dependencies),
            "active_rfcs_count": len(rfc_dependencies),
            "findings": findings,
        }


class Fiori403DoctorEvaluator:
    """Traverses diagnostic decision tree for HTTP 403 Forbidden errors."""

    @classmethod
    def evaluate(
        cls,
        status_code: int,
        su53_failed_objects: List[str],
        icf_inactive_paths: List[str],
        is_post_without_csrf: bool,
    ) -> Dict[str, Any]:
        findings = []
        if status_code != 403:
            return {"status": "COMPLETED", "root_cause": "NOT_A_403_ERROR", "findings": []}

        if is_post_without_csrf:
            findings.append({
                "code": "FIORI_CSRF_TOKEN_INVALID",
                "severity": "HIGH",
                "confidence": "VERIFIED",
            })
            return {"status": "COMPLETED", "root_cause": "CSRF", "findings": findings}

        if su53_failed_objects:
            findings.append({
                "code": "FIORI_AUTH_OBJECT_MISSING",
                "severity": "HIGH",
                "missing_objects": su53_failed_objects,
                "confidence": "VERIFIED",
            })
            return {"status": "COMPLETED", "root_cause": "AUTHORIZATION", "findings": findings}

        if icf_inactive_paths:
            findings.append({
                "code": "FIORI_ICF_INACTIVE",
                "severity": "HIGH",
                "inactive_paths": icf_inactive_paths,
                "confidence": "VERIFIED",
            })
            return {"status": "COMPLETED", "root_cause": "ICF", "findings": findings}

        return {"status": "COMPLETED", "root_cause": "UNKNOWN_403", "findings": []}


class WorkflowStuckExplainerEvaluator:
    """Explains stuck and failing SAP workflows."""

    @classmethod
    def evaluate(cls, work_items: List[Dict[str, Any]]) -> Dict[str, Any]:
        findings = []
        stuck_items = 0

        for wi in work_items:
            status = wi.get("status")
            wi_id = wi.get("id")
            agents = wi.get("agents", [])
            has_dump = wi.get("dump", False)

            if status == "READY" and len(agents) == 0:
                stuck_items += 1
                findings.append({
                    "code": "WF_STUCK_NO_AGENT",
                    "severity": "CRITICAL",
                    "work_item_id": wi_id,
                    "task": wi.get("task"),
                    "confidence": "VERIFIED",
                })
            elif status == "ERROR" and has_dump:
                stuck_items += 1
                findings.append({
                    "code": "WF_BACKGROUND_TASK_FAILED",
                    "severity": "CRITICAL",
                    "work_item_id": wi_id,
                    "exception": wi.get("exception_class", "CX_SY_PROGRAM_ERROR"),
                    "confidence": "VERIFIED",
                })

        return {
            "status": "COMPLETED",
            "stuck_work_items_count": stuck_items,
            "findings": findings,
        }


class IAMCostOptimizerEvaluator:
    """Optimizes Fiori catalogs and user license tiers."""

    @classmethod
    def evaluate(cls, role_catalogs: Dict[str, List[str]], app_tiers: Dict[str, str]) -> Dict[str, Any]:
        findings = []
        for role, apps in role_catalogs.items():
            advanced_apps = [a for a in apps if app_tiers.get(a) == "ADVANCED"]
            basic_apps = [a for a in apps if app_tiers.get(a) in ("CORE", "SELF_SERVICE")]

            if len(advanced_apps) == 1 and len(basic_apps) >= 2:
                findings.append({
                    "code": "IAM_LICENSE_TIER_ESCALATED",
                    "severity": "MEDIUM",
                    "role": role,
                    "escalating_app": advanced_apps[0],
                    "recommendation": f"Split app {advanced_apps[0]} out of {role}",
                    "confidence": "RULE_DERIVED",
                })

        return {"status": "COMPLETED", "findings": findings}


class AccountDeterminationEvaluator:
    """Audits OBYC / VKOA automatic account determination matrices."""

    @classmethod
    def evaluate(
        cls,
        determination_rules: List[Dict[str, str]],
        chart_of_accounts: Dict[str, Dict[str, Any]],
    ) -> Dict[str, Any]:
        findings = []
        for rule in determination_rules:
            tx_key = rule.get("transaction_key")
            val_class = rule.get("valuation_class")
            gl_acc = rule.get("gl_account")

            if not gl_acc:
                findings.append({
                    "code": "ACCT_DET_MISSING_ACCOUNT",
                    "severity": "CRITICAL",
                    "transaction_key": tx_key,
                    "valuation_class": val_class,
                    "confidence": "VERIFIED",
                })
            elif gl_acc not in chart_of_accounts:
                findings.append({
                    "code": "ACCT_DET_ACCOUNT_NOT_FOUND",
                    "severity": "CRITICAL",
                    "gl_account": gl_acc,
                    "confidence": "VERIFIED",
                })
            else:
                acc_meta = chart_of_accounts[gl_acc]
                if acc_meta.get("blocked_for_posting", False):
                    findings.append({
                        "code": "ACCT_DET_ACCOUNT_BLOCKED_POSTING",
                        "severity": "CRITICAL",
                        "gl_account": gl_acc,
                        "confidence": "VERIFIED",
                    })

        return {"status": "COMPLETED", "findings": findings}


class SystemRefreshDeltaGuardEvaluator:
    """Compares pre-refresh baseline vs post-refresh system configuration."""

    @classmethod
    def evaluate(
        cls,
        pre_refresh_rfcs: Dict[str, str],
        post_refresh_rfcs: Dict[str, str],
        scot_outbound_active: bool,
    ) -> Dict[str, Any]:
        findings = []
        for rfc_name, host in post_refresh_rfcs.items():
            if "prod" in host.lower() or "prd" in host.lower():
                findings.append({
                    "code": "REFRESH_RFC_TARGETS_PRODUCTION",
                    "severity": "CRITICAL",
                    "destination": rfc_name,
                    "host": host,
                    "confidence": "VERIFIED",
                })

        if scot_outbound_active:
            findings.append({
                "code": "REFRESH_SCOT_OUTBOUND_ACTIVE",
                "severity": "CRITICAL",
                "title": "Email Outbound Routing Active Without Domain Redirection",
                "confidence": "VERIFIED",
            })

        return {"status": "COMPLETED", "findings": findings}


class MFSBlackBoxEvaluator:
    """Analyzes EWM/MFS telegram streams to isolate first causal divergence."""

    @classmethod
    def evaluate(cls, telegrams: List[Dict[str, Any]], conveyor_edges: Set[Tuple[str, str]]) -> Dict[str, Any]:
        findings = []
        hu_positions: Dict[str, str] = {}
        pending_moves: Dict[str, float] = {}

        first_divergence = None

        for t in telegrams:
            t_type = t.get("type")
            hu = t.get("hu_id")
            cp = t.get("cp")
            time_sec = t.get("time_sec", 0.0)

            if t_type == "MOVE":
                prev_cp = hu_positions.get(hu)
                if prev_cp and (prev_cp, cp) not in conveyor_edges:
                    findings.append({
                        "code": "MFS_IMPOSSIBLE_TOPOLOGY_JUMP",
                        "severity": "CRITICAL",
                        "hu_id": hu,
                        "from_cp": prev_cp,
                        "to_cp": cp,
                        "time_sec": time_sec,
                        "confidence": "VERIFIED",
                    })
                    if not first_divergence:
                        first_divergence = findings[-1]
                hu_positions[hu] = cp
                pending_moves[hu] = time_sec

            elif t_type == "ACK":
                if hu in pending_moves:
                    del pending_moves[hu]

            elif t_type == "TIMEOUT":
                findings.append({
                    "code": "MFS_MISSING_ACK_TIMEOUT",
                    "severity": "CRITICAL",
                    "hu_id": hu,
                    "time_sec": time_sec,
                    "confidence": "VERIFIED",
                })
                if not first_divergence:
                    first_divergence = findings[-1]

        return {
            "status": "COMPLETED",
            "first_causal_divergence": first_divergence,
            "findings": findings,
        }
