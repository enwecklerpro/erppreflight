"""Clean Core Object Guard Engine.

Authoritative preflight evaluation of custom ABAP code against SAP Clean Core principles,
ABAP Cloud language version constraints, and Cloudification Repository (C1 release contracts).
Implements the 14-point engine anatomy mandated by Cardinal Axiom 2.
"""

from __future__ import annotations

import re
import time
from typing import Any, Dict, List, Tuple


from src.core.base_engine import BaseEngine
from src.core.registry import register_engine
from src.models.enums import (
    AnalysisStatus,
    ArtifactType,
    ConfidenceClass,
    EngineType,
    Severity,
    TrustLevel,
)
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine


# Authoritative Classic SAP Transparent Tables and their official Clean Core C1 Successors
CLASSIC_TABLE_SUCCESSOR_MAP: Dict[str, Dict[str, str]] = {
    "MARA": {
        "description": "General Material Data",
        "successor": "I_Product",
        "type": "CDS_VIEW_C1",
    },
    "MAKT": {
        "description": "Material Descriptions",
        "successor": "I_ProductDescription",
        "type": "CDS_VIEW_C1",
    },
    "MARC": {
        "description": "Plant Data for Material",
        "successor": "I_ProductPlant",
        "type": "CDS_VIEW_C1",
    },
    "MARD": {
        "description": "Storage Location Data for Material",
        "successor": "I_ProductStorageLocation",
        "type": "CDS_VIEW_C1",
    },
    "VBAK": {
        "description": "Sales Document: Header Data",
        "successor": "I_SalesOrder",
        "type": "CDS_VIEW_C1",
    },
    "VBAP": {
        "description": "Sales Document: Item Data",
        "successor": "I_SalesOrderItem",
        "type": "CDS_VIEW_C1",
    },
    "VBEP": {
        "description": "Sales Document: Schedule Line",
        "successor": "I_SalesOrderScheduleLine",
        "type": "CDS_VIEW_C1",
    },
    "BKPF": {
        "description": "Accounting Document Header",
        "successor": "I_JournalEntry",
        "type": "CDS_VIEW_C1",
    },
    "BSEG": {
        "description": "Accounting Document Segment",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "ACDOCA": {
        "description": "Universal Journal Entry Line Items",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "KNA1": {
        "description": "General Customer Master",
        "successor": "I_Customer",
        "type": "CDS_VIEW_C1",
    },
    "KNVV": {
        "description": "Customer Master Sales Area Data",
        "successor": "I_CustomerSalesArea",
        "type": "CDS_VIEW_C1",
    },
    "LFA1": {
        "description": "General Supplier Master",
        "successor": "I_Supplier",
        "type": "CDS_VIEW_C1",
    },
    "LFB1": {
        "description": "Supplier Company Code Data",
        "successor": "I_SupplierCompanyCode",
        "type": "CDS_VIEW_C1",
    },
    "EKKO": {
        "description": "Purchasing Document Header",
        "successor": "I_PurchaseOrderAPI01",
        "type": "CDS_VIEW_C1",
    },
    "EKPO": {
        "description": "Purchasing Document Item",
        "successor": "I_PurchaseOrderItemAPI01",
        "type": "CDS_VIEW_C1",
    },
    "LIKP": {
        "description": "SD Delivery Header Data",
        "successor": "I_OutboundDelivery",
        "type": "CDS_VIEW_C1",
    },
    "LIPS": {
        "description": "SD Delivery Item Data",
        "successor": "I_OutboundDeliveryItem",
        "type": "CDS_VIEW_C1",
    },
    "VBRK": {
        "description": "Billing Document Header",
        "successor": "I_BillingDocument",
        "type": "CDS_VIEW_C1",
    },
    "VBRP": {
        "description": "Billing Document Item",
        "successor": "I_BillingDocumentItem",
        "type": "CDS_VIEW_C1",
    },
    "BSIS": {
        "description": "G/L Account Index (Open Items)",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "BSAS": {
        "description": "G/L Account Index (Cleared Items)",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "BSID": {
        "description": "Customer Index (Open Items)",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "BSAD": {
        "description": "Customer Index (Cleared Items)",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "BSIK": {
        "description": "Supplier Index (Open Items)",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
    "BSAK": {
        "description": "Supplier Index (Cleared Items)",
        "successor": "I_JournalEntryItem",
        "type": "CDS_VIEW_C1",
    },
}

# Authoritative Obsolete Statements and their remediation
OBSOLETE_STATEMENTS_MAP: Dict[str, Dict[str, Any]] = {
    "TABLES": {
        "severity": Severity.CRITICAL,
        "description": "Obsolete dictionary workarea declaration sharing global memory.",
        "remediation": "Declare explicit local data structures (DATA: lt_... TYPE TABLE OF ...) or use CDS view projections.",
    },
    "FORM": {
        "severity": Severity.CRITICAL,
        "description": "Obsolete procedural subroutine declaration without signature type validation.",
        "remediation": "Refactor subroutines into class methods (CLASS ... DEFINITION / IMPLEMENTATION) under ABAP Cloud.",
    },
    "PERFORM": {
        "severity": Severity.CRITICAL,
        "description": "Obsolete procedural subroutine call.",
        "remediation": "Replace subroutine call with method invocation in local or global ABAP Cloud classes.",
    },
    "CALL 'SYSTEM'": {
        "severity": Severity.BLOCKER,
        "description": "Kernel C call executing arbitrary operating system commands.",
        "remediation": "Remove OS call immediately. Operating system access is strictly blocked in ABAP Cloud. Use BTP or cloud APIs.",
    },
    "OPEN DATASET": {
        "severity": Severity.CRITICAL,
        "description": "Direct application server filesystem access statement.",
        "remediation": "Disallowed in ABAP Cloud. Replace with SAP BTP Object Store, SAP DMS, or cloud storage APIs.",
    },
    "READ DATASET": {
        "severity": Severity.CRITICAL,
        "description": "Direct application server filesystem read statement.",
        "remediation": "Disallowed in ABAP Cloud. Replace with SAP BTP Object Store or cloud storage APIs.",
    },
    "TRANSFER": {
        "severity": Severity.CRITICAL,
        "description": "Direct application server filesystem write statement.",
        "remediation": "Disallowed in ABAP Cloud. Replace with SAP BTP Object Store or cloud storage APIs.",
    },
    "CLOSE DATASET": {
        "severity": Severity.CRITICAL,
        "description": "Direct application server filesystem close statement.",
        "remediation": "Disallowed in ABAP Cloud. Remove filesystem handle operations.",
    },
    "EXEC SQL": {
        "severity": Severity.BLOCKER,
        "description": "Native database SQL statement bypassing SAP database abstraction layer.",
        "remediation": "Rewrite native SQL using Open SQL / ABAP SQL with released CDS views.",
    },
    "CALL TRANSACTION": {
        "severity": Severity.CRITICAL,
        "description": "Dynpro transaction execution with batch input (BDC).",
        "remediation": "Disallowed in ABAP Cloud. Replace with released OData APIs or RAP Business Objects.",
    },
    "SUBMIT": {
        "severity": Severity.MAJOR,
        "description": "Classic ABAP report program execution.",
        "remediation": "Refactor report logic into an ABAP Cloud class and execute via Application Jobs (cl_apj_rt_api).",
    },
}

# Unreleased classic Function Modules in Cloudification Repository
UNRELEASED_API_CATALOG: Dict[str, Dict[str, str]] = {
    "WS_DELIVERY_UPDATE": {
        "status": "UNRELEASED",
        "successor": "I_OutboundDeliveryTP (RAP BO) / API_OUTBOUND_DELIVERY_SRV_0002",
    },
    "BAPI_MATERIAL_SAVEDATA": {
        "status": "UNRELEASED",
        "successor": "I_ProductTP (RAP Business Object)",
    },
    "BAPI_SALESORDER_CREATEFROMDAT2": {
        "status": "UNRELEASED",
        "successor": "I_SalesOrderTP (RAP Business Object)",
    },
    "BAPI_ACC_DOCUMENT_POST": {
        "status": "UNRELEASED",
        "successor": "I_JournalEntryTP (RAP Business Object)",
    },
    "RFC_READ_TABLE": {
        "status": "UNRELEASED",
        "successor": "Released OData API or CDS Analytical Query",
    },
    "BAPI_PO_CREATE1": {
        "status": "UNRELEASED",
        "successor": "I_PurchaseOrderTP (RAP Business Object)",
    },
}


@register_engine
class CleanCoreEngine(BaseEngine):
    """Engine analyzing custom ABAP code against SAP Clean Core principles."""

    engine_type = EngineType.CLEAN_CORE_OBJECT_GUARD
    rule_prefix = "CLEAN_CORE"
    name = "Clean Core Object Guard"
    description = "Tier 1/2/3 extensibility classification, classic modification detector"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.ABAP, ArtifactType.ZIP, ArtifactType.TXT]

    # Pre-compiled regex patterns
    FUNCTION_CALL_REGEX = re.compile(r"CALL\s+FUNCTION\s+['\"]([A-Z0-9_]+)['\"]", re.IGNORECASE)

    @staticmethod
    def _strip_abap_comment(line: str) -> str:
        """Strips ABAP comments (* at start of line or inline " comments),
        while strictly preserving double quotes in CALL "SYSTEM" and string literals."""
        stripped = line.strip()
        if not stripped or stripped.startswith("*"):
            return ""

        in_single_quote = False
        in_pipe = False
        i = 0
        while i < len(line):
            ch = line[i]
            if ch == "'" and not in_pipe:
                in_single_quote = not in_single_quote
            elif ch == "|" and not in_single_quote:
                in_pipe = not in_pipe
            elif ch == '"' and not in_single_quote and not in_pipe:
                # Check if this double quote belongs to CALL "SYSTEM" or CALL "..."
                prefix = line[:i].rstrip().upper()
                if prefix.endswith("CALL"):
                    closing = line.find('"', i + 1)
                    if closing != -1:
                        i = closing + 1
                        continue
                return line[:i].strip()
            i += 1
        return line.strip()

    @classmethod
    def evaluate(cls, abap_code: str) -> Dict[str, Any]:
        """Direct deterministic evaluation helper matching E2E test harness expectations."""
        findings: List[Dict[str, Any]] = []
        lines = abap_code.splitlines()
        clean_count = 0
        violations_count = 0

        # Step 1: Preprocess lines and strip comments while preserving line numbers
        non_empty_line_parts: List[Tuple[int, str]] = []
        for line_no, raw_line in enumerate(lines, start=1):
            code_part = cls._strip_abap_comment(raw_line)
            if code_part:
                non_empty_line_parts.append((line_no, code_part))

        # Step 2: Split into ABAP statements delimited by unquoted periods '.'
        # Statements can span multiple lines (e.g. SELECT *\nFROM\nmara).
        statements: List[Dict[str, Any]] = []
        current_parts: List[Tuple[int, str]] = []

        for line_no, code_part in non_empty_line_parts:
            in_sq = False
            in_pipe = False
            start_idx = 0
            for idx, ch in enumerate(code_part):
                if ch == "'" and not in_pipe:
                    in_sq = not in_sq
                elif ch == "|" and not in_sq:
                    in_pipe = not in_pipe
                elif ch == "." and not in_sq and not in_pipe:
                    # Ignore decimal dots inside numbers, e.g. 1.5
                    if idx > 0 and code_part[idx - 1].isdigit() and idx + 1 < len(code_part) and code_part[idx + 1].isdigit():
                        continue
                    piece = code_part[start_idx:idx + 1].strip()
                    if piece:
                        current_parts.append((line_no, piece))
                    if current_parts:
                        full_stmt = " ".join(p[1] for p in current_parts)
                        statements.append({
                            "full_statement": full_stmt,
                            "parts": list(current_parts),
                            "start_line": current_parts[0][0],
                        })
                        current_parts = []
                    start_idx = idx + 1

            remaining = code_part[start_idx:].strip()
            if remaining:
                current_parts.append((line_no, remaining))

        # Trailing statement without period (e.g. 'FROM MARA' or snippet)
        if current_parts:
            full_stmt = " ".join(p[1] for p in current_parts)
            statements.append({
                "full_statement": full_stmt,
                "parts": list(current_parts),
                "start_line": current_parts[0][0],
            })

        for stmt_info in statements:
            full_stmt = stmt_info["full_statement"]
            stmt_upper = full_stmt.upper()
            parts = stmt_info["parts"]
            start_line = stmt_info["start_line"]
            violation_found = False

            # 1. Check direct classic table access
            for tbl, meta in CLASSIC_TABLE_SUCCESSOR_MAP.items():
                pattern = rf"\b(FROM|INTO|UPDATE|MODIFY)\s+{tbl}\b"
                if re.search(pattern, stmt_upper):
                    violations_count += 1
                    violation_found = True
                    tbl_line = next((l_no for l_no, text in parts if re.search(rf"\b{tbl}\b", text, re.IGNORECASE)), start_line)
                    findings.append({
                        "code": "CLEAN_CORE_DIRECT_DB_ACCESS",
                        "severity": "CRITICAL",
                        "line": tbl_line,
                        "table": tbl,
                        "statement": full_stmt,
                        "successor": meta["successor"],
                        "confidence": "VERIFIED",
                    })

            # 2. Check obsolete statements
            for stmt, meta in OBSOLETE_STATEMENTS_MAP.items():
                is_match = False
                if stmt == "CALL 'SYSTEM'":
                    if "CALL 'SYSTEM'" in stmt_upper or 'CALL "SYSTEM"' in stmt_upper or re.search(r'\bCALL\s+[\'"]SYSTEM[\'"]', stmt_upper):
                        is_match = True
                elif stmt == "CALL TRANSACTION":
                    if stmt_upper.startswith("CALL TRANSACTION ") or stmt_upper.startswith("CALL TRANSACTION:") or "CALL TRANSACTION" in stmt_upper:
                        is_match = True
                elif stmt == "EXEC SQL":
                    if stmt_upper.startswith("EXEC SQL") or "EXEC SQL" in stmt_upper or re.search(r'\bEXEC\s+SQL\b', stmt_upper):
                        is_match = True
                else:
                    if stmt_upper.startswith(f"{stmt} ") or stmt_upper.startswith(f"{stmt}:") or stmt_upper == stmt:
                        is_match = True

                if is_match:
                    violations_count += 1
                    violation_found = True
                    first_word = stmt.split()[0].upper()
                    stmt_line = next((l_no for l_no, text in parts if first_word in text.upper()), start_line)
                    sev_str = "CRITICAL" if meta["severity"] == Severity.CRITICAL else ("BLOCKER" if meta["severity"] == Severity.BLOCKER else "HIGH")
                    findings.append({
                        "code": "CLEAN_CORE_OBSOLETE_SYNTAX",
                        "severity": sev_str,
                        "line": stmt_line,
                        "statement": stmt,
                        "full_statement": full_stmt,
                        "remediation": meta["remediation"],
                        "confidence": "VERIFIED",
                    })

            # 3. Check unreleased function module calls
            m_fn = cls.FUNCTION_CALL_REGEX.search(stmt_upper)
            if m_fn:
                fn_name = m_fn.group(1).upper()
                if fn_name in UNRELEASED_API_CATALOG:
                    violations_count += 1
                    violation_found = True
                    api_meta = UNRELEASED_API_CATALOG[fn_name]
                    fn_line = next((l_no for l_no, text in parts if fn_name in text.upper()), start_line)
                    findings.append({
                        "code": "CLEAN_CORE_UNRELEASED_API",
                        "severity": "CRITICAL",
                        "line": fn_line,
                        "function_module": fn_name,
                        "statement": full_stmt,
                        "successor": api_meta["successor"],
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
            "violations_count": violations_count,
            "compliance_percentage": comp_pct,
            "findings": findings,
        }

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        raw_code = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "abap/custom_source.abap"

        eval_result = self.evaluate(raw_code)
        rules_evaluated = len(CLASSIC_TABLE_SUCCESSOR_MAP) + len(OBSOLETE_STATEMENTS_MAP) + len(UNRELEASED_API_CATALOG)

        for raw_f in eval_result["findings"]:
            line_no = raw_f.get("line", 1)
            code = raw_f["code"]
            snippet = raw_f.get("statement") or raw_f.get("full_statement") or ""

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=snippet or raw_code,
                line_number=line_no,
                column_number=1,
                snippet=snippet,
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )

            # Map severity
            if raw_f.get("severity") == "BLOCKER":
                severity = Severity.BLOCKER
            elif raw_f.get("severity") in ("CRITICAL", "HIGH"):
                severity = Severity.CRITICAL
            else:
                severity = Severity.MAJOR

            if code == "CLEAN_CORE_DIRECT_DB_ACCESS":
                tbl = raw_f.get("table", "UNKNOWN")
                succ = raw_f.get("successor", "Released CDS View")
                title = f"Direct Database Access to Classic Table {tbl}"
                desc = (
                    f"Direct database statement on classic SAP table {tbl} violates Clean Core. "
                    f"Classic tables must not be read or updated directly in ABAP Cloud."
                )
                remediation = f"Replace direct access to table {tbl} with released CDS view {succ} (Contract C1) or RAP Business Object."
                tech_details = {
                    "code": code,
                    "table": tbl,
                    "successor": succ,
                    "statement": snippet,
                    "line": line_no,
                }
                affected = [tbl]
            elif code == "CLEAN_CORE_OBSOLETE_SYNTAX":
                stmt = raw_f.get("statement", "UNKNOWN")
                title = f"Obsolete ABAP Syntax Statement: {stmt}"
                desc = (
                    f"Obsolete statement '{stmt}' detected. Procedural forms, workarea declarations, "
                    f"and low-level filesystem/OS access are strictly disallowed in ABAP Cloud."
                )
                remediation = raw_f.get("remediation", f"Refactor statement '{stmt}' to ABAP Cloud compliant syntax.")
                tech_details = {
                    "code": code,
                    "statement": stmt,
                    "full_statement": snippet,
                    "line": line_no,
                }
                affected = [stmt]
            elif code == "CLEAN_CORE_UNRELEASED_API":
                fn = raw_f.get("function_module", "UNKNOWN")
                succ = raw_f.get("successor", "Released RAP BO")
                title = f"Call to Unreleased Function Module: {fn}"
                desc = f"Function module '{fn}' is not released for ABAP Cloud (Contract C1) in Cloudification Repository."
                remediation = f"Migrate function module call '{fn}' to official cloud successor: {succ}."
                tech_details = {
                    "code": code,
                    "function_module": fn,
                    "successor": succ,
                    "statement": snippet,
                    "line": line_no,
                }
                affected = [fn]
            else:
                title = "Clean Core Violation Detected"
                desc = f"Violation of clean core principles in statement: {snippet}"
                remediation = "Refactor code to adhere to SAP Clean Core and ABAP Cloud guidelines."
                tech_details = raw_f
                affected = []

            finding = Finding(
                rule_id=code,
                severity=severity,
                category="MIGRATION_CLEAN_CORE",
                title=title,
                description=desc,
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=remediation,
                evidence=[ev],
                technical_details=tech_details,
                affected_objects=affected,
            )

            # Invariant: Classify confidence and demote missing evidence
            classified_finding = ConfidenceClassifier.classify(finding)
            findings.append(classified_finding)

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=elapsed_ms,
                rules_evaluated=rules_evaluated,
                artifacts_scanned=1,
                additional_metrics={
                    "total_statements": eval_result["total_statements"],
                    "clean_statements": eval_result["clean_statements"],
                    "violations_count": eval_result["violations_count"],
                    "compliance_percentage": eval_result["compliance_percentage"],
                    "engine": "clean_core_object_guard",
                },
            ),
        )
