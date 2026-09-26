"""
ERP Preflight — Feature 31: Fiori 403 & Authorization Diagnostic Guard Engine
Deterministic 7-step decision-tree diagnosis across HTTP 403 / unauthorized errors.

Governing Standards:
- AGENTS.md: Cardinal Axiom 2 (14 architectural points)
- engine-authoring.md, sap-evidence.md, secure-file-parser.md
"""

from __future__ import annotations

import csv
import io
import json
import re
from typing import Any, Dict, List, Optional, Tuple, Set

from pydantic import BaseModel, Field

from src.core.base_engine import BaseEngine
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, RuleSpec, insufficient, rule_catalog,
)
from src.core.registry import register_engine
from src.models.enums import (
    EngineType,
    ArtifactType,
    AnalysisStatus,
    Severity,
    ConfidenceClass,
)
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.platform.evidence import EvidenceEngine
from src.core.exceptions import EngineInputError
from src.parsers.json_input import parse_json_payload


# =============================================================================
# Input Validation Models
# =============================================================================

class FioriHttpResponse(BaseModel):
    status_code: int = Field(default=403, description="HTTP response status code (e.g. 403, 401)")
    method: str = Field(default="GET", description="HTTP request method (GET, POST, PUT, DELETE, PATCH)")
    url: str = Field(default="", description="Request URL or service URI")
    headers: Dict[str, str] = Field(default_factory=dict, description="HTTP response and request headers")
    body: str = Field(default="", description="Raw response body or error message JSON/XML")


class IwfndErrorLogEntry(BaseModel):
    timestamp: Optional[str] = None
    error_code: str = Field(default="", description="Gateway error code (e.g. CX_IWFND_MED_MDL_NOT_FOUND)")
    message: str = Field(default="", description="Error description message")
    service_name: str = Field(default="", description="OData service name or technical service ID")
    namespace: Optional[str] = "/SAP/"
    user_id: Optional[str] = None
    system_alias: Optional[str] = None


class Su53TraceEntry(BaseModel):
    user_id: Optional[str] = None
    auth_object: str = Field(..., description="Authorization object (e.g. S_SERVICE, S_START, S_RFC)")
    return_code: int = Field(default=4, description="Authorization check return code (4 or 12 = failed)")
    field_values: Dict[str, str] = Field(default_factory=dict, description="Tested authorization field values")
    transaction_code: Optional[str] = None
    timestamp: Optional[str] = None


class SicfServiceEntry(BaseModel):
    service_path: str = Field(..., description="ICF URL path (e.g. /sap/opu/odata/sap/C_SALESORDER_CDS)")
    service_name: Optional[str] = None
    is_active: bool = Field(default=True, description="Whether the ICF service node is active")
    handler_list: List[str] = Field(default_factory=list, description="Registered HTTP handlers")


class UconRuleEntry(BaseModel):
    service_name: str = Field(..., description="RFC or HTTP service name")
    scenario_id: Optional[str] = None
    is_blocked: bool = Field(default=False, description="Whether ingress is blocked by UCON policy")
    reason: Optional[str] = None


class CloudConnectorEntry(BaseModel):
    timestamp: Optional[str] = None
    resource_path: str = Field(default="", description="Requested backend resource path")
    status: str = Field(default="ALLOWED", description="SCC status: ALLOWED, DENIED, REJECTED")
    reason: Optional[str] = None
    principal: Optional[str] = None


class Fiori403NormalizedContext(BaseModel):
    http_response: Optional[FioriHttpResponse] = None
    error_logs: List[IwfndErrorLogEntry] = Field(default_factory=list)
    su53_traces: List[Su53TraceEntry] = Field(default_factory=list)
    icf_services: List[SicfServiceEntry] = Field(default_factory=list)
    ucon_rules: List[UconRuleEntry] = Field(default_factory=list)
    cloud_connector_logs: List[CloudConnectorEntry] = Field(default_factory=list)
    pfcg_roles: List[str] = Field(default_factory=list)


# =============================================================================
# Feature 31: Fiori 403 & Authorization Diagnostic Guard Engine
# =============================================================================

# ==== ENGINE CONTRACT (rule catalog + input contract) ====
import re as _re

RULES = rule_catalog(
    RuleSpec(
        "FIORI_CSRF_TOKEN_INVALID", "CSRF token missing or invalid on modifying request", Severity.CRITICAL,
        "Fetch a token with 'X-CSRF-Token: Fetch' on a GET/HEAD, then send the token and session cookies with the "
        "POST/PUT/PATCH/DELETE; check that proxies / Web Dispatcher keep the session cookie.", "Security / CSRF",
    ),
    RuleSpec(
        "FIORI_ICF_INACTIVE", "ICF service node inactive (SICF)", Severity.BLOCKER,
        "Activate the service node and its parents in SICF (or /IWFND/MAINT_SERVICE > ICF Node > Activate).",
        "ICF Configuration",
    ),
    RuleSpec(
        "FIORI_GATEWAY_SERVICE_NOT_ACTIVATED", "Gateway service not registered / no system alias", Severity.CRITICAL,
        "Register and activate the OData service in /IWFND/MAINT_SERVICE (V2) or /IWFND/V4_ADMIN (V4) and assign "
        "the correct system alias.", "Gateway Service Registration",
    ),
    RuleSpec(
        "FIORI_AUTH_OBJECT_MISSING", "Authorization check failed (SU53)", Severity.CRITICAL,
        "Add the failing authorization object values (e.g. S_SERVICE for the service hash, S_START) to the "
        "user's PFCG role — via the Fiori business catalog / IAM app in the cloud — and regenerate the profile.",
        "Authorization / Security",
    ),
    RuleSpec(
        "FIORI_UCON_DENIED", "Blocked by UCON / RFC allowlist", Severity.CRITICAL,
        "Add the service / RFC function to the UCON communication assembly (UCONCOCKPIT) allowlist or move it "
        "out of the logging phase correctly.", "Network / UCON",
    ),
    RuleSpec(
        "FIORI_CLOUD_CONNECTOR_DENIED", "Denied by SAP Cloud Connector", Severity.CRITICAL,
        "Expose the backend resource path in the Cloud Connector access control and fix principal propagation "
        "(trust / CN mapping).", "Infrastructure / Cloud Connector",
    ),
    RuleSpec(
        "FIORI_CATALOG_ROLE_MISSING", "Business catalog / role not assigned", Severity.MAJOR,
        "Assign the business role containing the app's catalog (Maintain Business Roles / PFCG).",
        "Authorization / Security",
    ),
    RuleSpec(
        "FIORI_403_INSUFFICIENT_TELEMETRY", "Root cause not determinable from supplied telemetry", Severity.MINOR,
        "Capture an SU53 trace, the /IWFND/ERROR_LOG entry and the SICF status for the failing request and "
        "re-run; the supplied data did not identify a root cause.", "Diagnostic Telemetry Gap",
    ),
)


class Fiori403Input(ContractModel):
    signal_fields = (
        "http_response", "status_code", "status", "iwfnd_error_log", "error_logs", "error_log", "su53",
        "su53_traces", "auth_trace", "icf_services", "sicf", "sicf_export", "ucon", "ucon_rules",
        "cloud_connector", "cloud_connector_logs",
    )
    signal_message = (
        "No 403 telemetry supplied: provide 'http_response', 'su53', 'iwfnd_error_log', 'icf_services', 'ucon' "
        "or 'cloud_connector' data."
    )


def _fiori_text_check(text: str) -> Optional[str]:
    if _re.search(r"^\s*HTTP/\d(\.\d)?\s+\d{3}", text, _re.M) or _re.search(
        r"^\s*(GET|POST|PUT|DELETE|PATCH|HEAD|MERGE)\s+\S+", text, _re.M
    ) or _re.search(r"authorization check failed|failed authorization", text, _re.I):
        return None
    return "text is neither an HTTP request/response dump nor an SU53 authorization trace."


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.JSON, InputFormat.CSV, InputFormat.TEXT),
    summary=(
        "403 diagnostic telemetry: JSON {'http_response': {status_code, method, url, headers, body}, 'su53': [...], "
        "'iwfnd_error_log': [...], 'icf_services': [...], 'ucon_rules': [...], 'cloud_connector_logs': [...]}, "
        "an HTTP request/response text dump or SU53 text export, or SICF/SU53 CSV artifacts."
    ),
    required=("At least one telemetry source (HTTP trace, SU53, /IWFND/ERROR_LOG, SICF, UCON, Cloud Connector)",),
    json_model=Fiori403Input,
    json_array_field="su53",
    text_check=_fiori_text_check,
)


# ==== END ENGINE CONTRACT ====


@register_engine
class Fiori403Engine(BaseEngine):
    """
    Fiori 403 Root-Cause Doctor Engine
    Traverses a deterministic 7-step diagnostic decision tree to identify the
    exact technical root cause of HTTP 403 Forbidden / unauthorized errors across
    Fiori Launchpad, SAP Gateway, ICF, UCON, Cloud Connector, and PFCG roles.
    """

    engine_type = EngineType.FIORI_403_ROOT_CAUSE_DOCTOR
    rule_prefix = "FIORI_403"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "Fiori 403 Root-Cause Doctor"
    description = "Deterministic 7-step decision-tree diagnosis across HTTP 403 / unauthorized errors"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.TXT, ArtifactType.CSV]

    # Technical Authorization Objects audited in Gateway/Fiori
    TECHNICAL_AUTH_OBJECTS: Set[str] = {
        "S_SERVICE",
        "S_START",
        "S_RFC",
        "S_RFCACL",
        "I_AUTH",
        "S_DEVELOP",
        "S_TABU_DIS",
        "S_ICF",
    }

    # Standard Finding Codes
    RULE_CSRF_INVALID = "FIORI_CSRF_TOKEN_INVALID"
    RULE_ICF_INACTIVE = "FIORI_ICF_INACTIVE"
    RULE_GATEWAY_NOT_ACTIVATED = "FIORI_GATEWAY_SERVICE_NOT_ACTIVATED"
    RULE_AUTH_OBJECT_MISSING = "FIORI_AUTH_OBJECT_MISSING"
    RULE_UCON_DENIED = "FIORI_UCON_DENIED"
    RULE_CLOUD_CONNECTOR_DENIED = "FIORI_CLOUD_CONNECTOR_DENIED"
    RULE_CATALOG_ROLE_MISSING = "FIORI_CATALOG_ROLE_MISSING"
    RULE_INSUFFICIENT_TELEMETRY = "FIORI_403_INSUFFICIENT_TELEMETRY"

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """
        Executes the deterministic 7-step diagnosis over the submitted request artifacts.
        """
        findings: List[Finding] = []
        rules_evaluated = 0
        artifacts_scanned = max(1, len(request.artifacts))

        # 1. Parse and Normalize Inputs
        context, source_lines, artifact_path, raw_content_str = self._parse_inputs(request)
        has_telemetry = bool(
            context.http_response or context.error_logs or context.su53_traces or context.icf_services
            or context.ucon_rules or context.cloud_connector_logs
        )
        if not has_telemetry:
            supplied = bool((request.raw_content or "").strip()) or any(a.raw_content for a in request.artifacts)
            raise EngineInputError(
                f"{self.rule_prefix}_INVALID_INPUT" if supplied else f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No 403 diagnostic telemetry recognised: supply the failing HTTP request/response (status line, "
                "headers, body), an SU53 trace, /IWFND/ERROR_LOG entries, SICF status, UCON rules or Cloud "
                "Connector logs.",
            )
        artifact_hash = EvidenceEngine.compute_sha256(raw_content_str)

        # 2. Execute Deterministic 7-Step Diagnostic Decision Tree
        step_findings, steps_run, root_cause_area = self._evaluate_decision_tree(
            context=context,
            source_lines=source_lines,
            artifact_path=artifact_path,
            artifact_hash=artifact_hash,
            target_release=request.target_release,
        )
        findings.extend(step_findings)
        rules_evaluated += steps_run

        # 3. Determine Overall Status & Confidence Metrics
        status = AnalysisStatus.COMPLETED
        if not findings:
            status = AnalysisStatus.COMPLETED

        highest_confidence = 1.0
        if any(f.confidence == ConfidenceClass.VERIFIED for f in findings):
            highest_confidence = 1.0
        elif any(f.confidence == ConfidenceClass.RULE_DERIVED for f in findings):
            highest_confidence = 0.85
        elif any(f.confidence == ConfidenceClass.UNKNOWN for f in findings):
            highest_confidence = 0.30

        additional_metrics = {
            "diagnosticStepsEvaluated": steps_run,
            "rootCauseArea": root_cause_area,
            "confidenceScore": highest_confidence,
            "findingsCount": len(findings),
            "targetRelease": request.target_release,
            "hasSu53Trace": len(context.su53_traces) > 0,
            "hasIwfndLog": len(context.error_logs) > 0,
            "hasSicfData": len(context.icf_services) > 0,
            "hasCloudConnectorLog": len(context.cloud_connector_logs) > 0,
        }

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=status,
            findings=findings,
            metrics=AnalysisMetrics(
                rules_evaluated=max(rules_evaluated, 7),
                artifacts_scanned=artifacts_scanned,
                additional_metrics=additional_metrics,
            ),
        )

    # -------------------------------------------------------------------------
    # Deterministic 7-Step Decision Tree
    # -------------------------------------------------------------------------
    def _evaluate_decision_tree(
        self,
        context: Fiori403NormalizedContext,
        source_lines: Dict[str, int],
        artifact_path: str,
        artifact_hash: str,
        target_release: str,
    ) -> Tuple[List[Finding], int, str]:
        """
        Traverses the 7-step decision tree in strict priority order:
        Step 1: Status Code & Protocol Verification
        Step 2: CSRF Token Integrity Check
        Step 3: SICF Service Status Check (ICF Inactivity)
        Step 4: Gateway Service Registration & System Alias Check
        Step 5: SU53 / Authorization Trace Check
        Step 6: UCON Deny Policy Check
        Step 7: Cloud Connector & Principal Propagation Check
        Fallback: Missing Telemetry / Unlogged Proxy Error
        """
        findings: List[Finding] = []
        steps_evaluated = 0
        root_cause_area = "UNKNOWN"

        http = context.http_response
        headers_lower = {k.lower(): v for k, v in (http.headers.items() if http else [])}

        # ---------------------------------------------------------------------
        # Step 1: Status Code & Protocol Verification
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        is_403_or_401 = http is None or http.status_code in (403, 401)
        sap_error_code = headers_lower.get("sap-error-code", "").upper()

        # ---------------------------------------------------------------------
        # Step 2: CSRF Token Integrity Check
        # State-modifying requests (POST, PUT, DELETE, PATCH) lacking or with invalid CSRF token
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        csrf_failed = False
        csrf_reason = ""
        csrf_line = source_lines.get("http_headers", 1)

        if http and http.method.upper() in ("POST", "PUT", "DELETE", "PATCH", "MERGE"):
            token_val = headers_lower.get("x-csrf-token", "").strip().lower()
            if token_val in ("required", "invalid") or "csrf" in sap_error_code.lower():
                csrf_failed = True
                csrf_reason = f"Response header sap-error-code indicates CSRF failure: '{sap_error_code or token_val}'"
            elif "csrf token validation failed" in http.body.lower() or "csrf-token-validierung fehlgeschlagen" in http.body.lower():
                csrf_failed = True
                csrf_reason = "Response body explicitly states 'CSRF token validation failed'"
            elif not token_val and ("403" in str(http.status_code) and "csrf" in http.body.lower()):
                csrf_failed = True
                csrf_reason = "Request method is state-modifying and response payload flags missing CSRF token"

        if csrf_failed:
            root_cause_area = "CSRF_PROTECTION"
            findings.append(
                Finding(
                    rule_id=self.RULE_CSRF_INVALID,
                    severity=Severity.CRITICAL,
                    category="Security / CSRF",
                    title="CSRF Token Validation Failed on State-Modifying Request",
                    description=(
                        f"The {http.method.upper() if http else 'HTTP'} request to '{http.url if http else ''}' was rejected "
                        f"with HTTP 403 because the SAP Gateway / ICF CSRF security token was missing, expired, or invalid. {csrf_reason}."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        "1. Issue an initial GET or HEAD request with HTTP header 'X-CSRF-Token: Fetch' to obtain a valid CSRF token.\n"
                        "2. Ensure the returned 'x-csrf-token' header value and all session cookies (e.g. MYSAPSSO2, SAP_SESSION) "
                        "are forwarded in subsequent state-modifying requests.\n"
                        "3. In SAP Fiori apps, ensure sap.ui.model.odata.v2.ODataModel or v4.ODataModel token refresh handling is enabled."
                    ),
                    evidence=[
                        Evidence(
                            artifact_path=f"{artifact_path}#http_response",
                            line_number=csrf_line,
                            snippet=f"Method: {http.method if http else 'POST'}, Status: 403, sap-error-code: {sap_error_code}",
                            sha256=artifact_hash,
                            provenance=ConfidenceClass.VERIFIED,
                            trust_score=1.0,
                        )
                    ],
                    technical_details={
                        "step": "Step 2: CSRF Token Integrity",
                        "method": http.method if http else "POST",
                        "sapErrorCode": sap_error_code,
                        "url": http.url if http else "",
                    },
                    affected_objects=[http.url] if http and http.url else ["OData Service"],
                )
            )
            # If CSRF is the definitive failure, we still evaluate further steps if multiple issues present

        # ---------------------------------------------------------------------
        # Step 3: SICF Service Status Check (ICF Inactivity)
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        for icf in context.icf_services:
            if not icf.is_active:
                root_cause_area = "ICF_SERVICE"
                line_no = source_lines.get(f"sicf_{icf.service_path}", source_lines.get("sicf", 1))
                findings.append(
                    Finding(
                        rule_id=self.RULE_ICF_INACTIVE,
                        severity=Severity.BLOCKER,
                        category="ICF Configuration",
                        title=f"ICF Service Node Inactive: {icf.service_path}",
                        description=(
                            f"The Internet Communication Framework (ICF) service node '{icf.service_path}' "
                            f"is currently deactivated in transaction SICF. All incoming HTTP/OData requests are "
                            f"halted with HTTP 403 Forbidden before reaching the Gateway runtime."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"1. Log in to the target SAP system client and open transaction SICF.\n"
                            f"2. Navigate to path '{icf.service_path}'.\n"
                            f"3. Right-click the node and select 'Activate Service' (or execute report RSICF_SERVICE_ACTIVATE).\n"
                            f"4. Confirm activation of the node and all dependent child handlers."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#sicf",
                                line_number=line_no,
                                snippet=f"path: {icf.service_path}, is_active: {icf.is_active}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Step 3: SICF Service Status",
                            "service_path": icf.service_path,
                            "service_name": icf.service_name,
                            "handlers": icf.handler_list,
                        },
                        affected_objects=[icf.service_path],
                    )
                )

        # Check if HTTP headers directly complain about ICF inactive
        if "icf_inact" in sap_error_code.lower() or "service is inactive" in (http.body.lower() if http else ""):
            if not any(f.rule_id == self.RULE_ICF_INACTIVE for f in findings):
                root_cause_area = "ICF_SERVICE"
                findings.append(
                    Finding(
                        rule_id=self.RULE_ICF_INACTIVE,
                        severity=Severity.BLOCKER,
                        category="ICF Configuration",
                        title="ICF Node Inactive Detected via Gateway Response",
                        description=(
                            "The HTTP response headers and error payload indicate the target ICF service node "
                            "is deactivated in transaction SICF."
                        ),
                        confidence=ConfidenceClass.RULE_DERIVED,
                        confidence_score=0.85,
                        remediation="Activate the requested URL service path in transaction SICF.",
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#http_response",
                                line_number=source_lines.get("http_headers", 1),
                                snippet=f"sap-error-code: {sap_error_code}, body: {http.body[:120] if http else ''}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.RULE_DERIVED,
                                trust_score=0.85,
                            )
                        ],
                    )
                )

        # ---------------------------------------------------------------------
        # Step 4: Gateway Service Registration Check (/IWFND/MAINT_SERVICE)
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        for log in context.error_logs:
            err_upper = (log.error_code or "").upper()
            msg_upper = (log.message or "").upper()
            if (
                "NOT_FOUND" in err_upper
                or "CX_IWFND_MED_MDL_NOT_FOUND" in err_upper
                or "NO_SYSTEM_ALIAS" in err_upper
                or "NO_SYSTEM_ALIAS" in msg_upper
                or "SERVICE NOT FOUND" in msg_upper
            ):
                root_cause_area = "GATEWAY_REGISTRATION"
                log_line = source_lines.get(f"iwfnd_{log.service_name}", source_lines.get("iwfnd", 1))
                findings.append(
                    Finding(
                        rule_id=self.RULE_GATEWAY_NOT_ACTIVATED,
                        severity=Severity.CRITICAL,
                        category="Gateway Service Registration",
                        title=f"OData Service Not Activated in /IWFND/MAINT_SERVICE: {log.service_name or 'Unknown Service'}",
                        description=(
                            f"SAP Gateway error log record '{log.error_code}' confirms that service '{log.service_name}' "
                            f"is either not registered in transaction /IWFND/MAINT_SERVICE or lacks an active SAP System Alias. "
                            f"Error message: {log.message}."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "1. Open transaction /IWFND/MAINT_SERVICE in the Gateway hub / embedded system.\n"
                            f"2. Search for technical service '{log.service_name}'. If missing, click 'Add Service'.\n"
                            "3. Select the target System Alias (e.g. 'LOCAL' or backend RFC destination).\n"
                            "4. Add the service and verify ICF Node status is set to green (active)."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#/IWFND/ERROR_LOG",
                                line_number=log_line,
                                snippet=f"error_code: {log.error_code}, service: {log.service_name}, msg: {log.message}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Step 4: Gateway Registration",
                            "errorCode": log.error_code,
                            "serviceName": log.service_name,
                            "systemAlias": log.system_alias,
                            "message": log.message,
                        },
                        affected_objects=[log.service_name] if log.service_name else ["SAP Gateway"],
                    )
                )

        # ---------------------------------------------------------------------
        # Step 5: SU53 / Authorization Trace Check
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        for su53 in context.su53_traces:
            if su53.return_code in (4, 12, 16):
                root_cause_area = "AUTHORIZATION"
                auth_line = source_lines.get(f"su53_{su53.auth_object}", source_lines.get("su53", 1))
                fields_str = ", ".join(f"{k}='{v}'" for k, v in su53.field_values.items())
                is_technical = su53.auth_object.upper() in self.TECHNICAL_AUTH_OBJECTS

                title_prefix = "Technical Service Authorization Missing" if is_technical else "Business Authorization Missing"
                description = (
                    f"User '{su53.user_id or 'CURRENT_USER'}' failed authorization check for object '{su53.auth_object}' "
                    f"(Return Code RC={su53.return_code}). Tested values: {fields_str}."
                )

                # Tailored remediation per object
                if su53.auth_object == "S_SERVICE":
                    remediation = (
                        f"1. Open transaction PFCG and edit the user's business role.\n"
                        f"2. In the 'Menu' tab, click 'Insert Node' -> 'Authorization Default' -> 'TADIR Service'.\n"
                        f"3. Select Program ID 'R3TR', Object Type 'IWSV' (OData V2) or 'G4BA'/'IWSG' (OData V4), "
                        f"and specify service '{su53.field_values.get('SRV_NAME', '')}'.\n"
                        f"4. Go to 'Authorizations' tab, click 'Change Authorization Data', merge defaults, and generate the profile."
                    )
                elif su53.auth_object == "S_START":
                    remediation = (
                        f"1. Open transaction PFCG and edit the assigned role.\n"
                        f"2. Add TADIR Service for Web Dynpro / BSP / OData start authorization.\n"
                        f"3. Ensure object S_START has AUTHPGM and AUTHNAME matching '{fields_str}'."
                    )
                elif su53.auth_object == "S_RFC":
                    remediation = (
                        f"1. In transaction PFCG, grant authorization object S_RFC with RFC_NAME='{su53.field_values.get('RFC_NAME', '*')}' "
                        f"and RFC_TYPE='{su53.field_values.get('RFC_TYPE', 'FUGR')}'.\n"
                        f"2. Regulate RFC access strictly under Clean Core principles."
                    )
                else:
                    remediation = (
                        f"1. In transaction PFCG, add authorization object '{su53.auth_object}' to the relevant functional role.\n"
                        f"2. Maintain authorized organizational levels or field values: {fields_str}.\n"
                        f"3. Re-generate the authorization profile and perform user comparison."
                    )

                findings.append(
                    Finding(
                        rule_id=self.RULE_AUTH_OBJECT_MISSING,
                        severity=Severity.BLOCKER if is_technical else Severity.CRITICAL,
                        category="Authorization / Security",
                        title=f"{title_prefix}: {su53.auth_object}",
                        description=description,
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=remediation,
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#su53",
                                line_number=auth_line,
                                snippet=f"object: {su53.auth_object}, rc: {su53.return_code}, fields: {fields_str}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Step 5: SU53 Authorization Audit",
                            "authObject": su53.auth_object,
                            "returnCode": su53.return_code,
                            "fieldValues": su53.field_values,
                            "userId": su53.user_id,
                            "transactionCode": su53.transaction_code,
                            "isTechnicalAuth": is_technical,
                        },
                        affected_objects=[su53.auth_object],
                    )
                )

        # ---------------------------------------------------------------------
        # Step 6: UCON Deny Policy Check
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        for ucon in context.ucon_rules:
            if ucon.is_blocked:
                root_cause_area = "UCON_POLICY"
                ucon_line = source_lines.get(f"ucon_{ucon.service_name}", source_lines.get("ucon", 1))
                findings.append(
                    Finding(
                        rule_id=self.RULE_UCON_DENIED,
                        severity=Severity.CRITICAL,
                        category="Network / UCON",
                        title=f"Unified Connectivity (UCON) Ingress Denied: {ucon.service_name}",
                        description=(
                            f"Unified Connectivity (UCON) runtime policy blocked access to service '{ucon.service_name}'. "
                            f"The endpoint is not included in the active communication scenario allowlist. Reason: {ucon.reason or 'Blocked by UCON phase RUNTIME'}."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "1. Open transaction UCONHTTP or UCONCOCKPIT in the target system.\n"
                            f"2. Locate service or function module '{ucon.service_name}'.\n"
                            "3. Add the service to the relevant active UCON Communication Scenario.\n"
                            "4. If in development or testing, adjust the UCON phase from 'Active' to 'Logging' temporarily to gather usage."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#ucon",
                                line_number=ucon_line,
                                snippet=f"service: {ucon.service_name}, is_blocked: {ucon.is_blocked}, reason: {ucon.reason}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Step 6: UCON Deny Policy",
                            "serviceName": ucon.service_name,
                            "scenarioId": ucon.scenario_id,
                            "reason": ucon.reason,
                        },
                        affected_objects=[ucon.service_name],
                    )
                )

        # Check for UCON header flags
        if "ucon" in sap_error_code.lower() or "ucon_http_denied" in (http.body.lower() if http else ""):
            if not any(f.rule_id == self.RULE_UCON_DENIED for f in findings):
                root_cause_area = "UCON_POLICY"
                findings.append(
                    Finding(
                        rule_id=self.RULE_UCON_DENIED,
                        severity=Severity.CRITICAL,
                        category="Network / UCON",
                        title="UCON Policy Ingress Block Detected in Response Header",
                        description="HTTP response header or body explicitly flags a Unified Connectivity (UCON) policy denial.",
                        confidence=ConfidenceClass.RULE_DERIVED,
                        confidence_score=0.85,
                        remediation="Check transaction UCONHTTP / UCONCOCKPIT to ensure endpoint is allowlisted.",
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#http_response",
                                line_number=source_lines.get("http_headers", 1),
                                snippet=f"sap-error-code: {sap_error_code}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.RULE_DERIVED,
                                trust_score=0.85,
                            )
                        ],
                    )
                )

        # ---------------------------------------------------------------------
        # Step 7: Cloud Connector & Principal Propagation Check
        # ---------------------------------------------------------------------
        steps_evaluated += 1
        for scc in context.cloud_connector_logs:
            if scc.status.upper() in ("DENIED", "REJECTED", "BLOCKED"):
                root_cause_area = "CLOUD_CONNECTOR"
                scc_line = source_lines.get("cloud_connector", 1)
                findings.append(
                    Finding(
                        rule_id=self.RULE_CLOUD_CONNECTOR_DENIED,
                        severity=Severity.CRITICAL,
                        category="Infrastructure / Cloud Connector",
                        title=f"SAP Cloud Connector Ingress Denied: {scc.resource_path or 'Resource Path'}",
                        description=(
                            f"SAP Cloud Connector (SCC) or SAP BTP Destination rejected the request for resource '{scc.resource_path}'. "
                            f"Reason: {scc.reason or 'Resource not accessible or principal propagation failed'} (Principal: {scc.principal or 'N/A'})."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "1. Open the SAP Cloud Connector administration console.\n"
                            "2. Navigate to 'Cloud To On-Premise' -> Select the backend mapping system.\n"
                            f"3. In 'Accessible Resources', add URL path '{scc.resource_path}' with 'Path and all sub-paths' enabled.\n"
                            "4. If principal propagation is used, verify CA certificate mapping in transaction CERTRULE."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#cloud_connector",
                                line_number=scc_line,
                                snippet=f"resource: {scc.resource_path}, status: {scc.status}, reason: {scc.reason}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Step 7: Cloud Connector",
                            "resourcePath": scc.resource_path,
                            "status": scc.status,
                            "reason": scc.reason,
                            "principal": scc.principal,
                        },
                        affected_objects=[scc.resource_path] if scc.resource_path else ["Cloud Connector"],
                    )
                )

        # Check for Cloud Connector rejection keywords in response body
        if http and ("resource not accessible on cloud connector" in http.body.lower() or "forbidden on cloud connector" in http.body.lower()):
            if not any(f.rule_id == self.RULE_CLOUD_CONNECTOR_DENIED for f in findings):
                root_cause_area = "CLOUD_CONNECTOR"
                findings.append(
                    Finding(
                        rule_id=self.RULE_CLOUD_CONNECTOR_DENIED,
                        severity=Severity.CRITICAL,
                        category="Infrastructure / Cloud Connector",
                        title="Resource Denied by SAP Cloud Connector Access Control",
                        description="HTTP response body indicates Cloud Connector rejected the requested resource path.",
                        confidence=ConfidenceClass.RULE_DERIVED,
                        confidence_score=0.85,
                        remediation="Add the URL path to Accessible Resources in the Cloud Connector administration console.",
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#http_response",
                                line_number=source_lines.get("http_headers", 1),
                                snippet=http.body[:150],
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.RULE_DERIVED,
                                trust_score=0.85,
                            )
                        ],
                    )
                )

        # ---------------------------------------------------------------------
        # Fallback / Missing Telemetry Check
        # If an HTTP 403 occurred but none of the steps could identify the cause
        # due to missing logs, flag missing telemetry with UNKNOWN confidence (0.30)
        # ---------------------------------------------------------------------
        if is_403_or_401 and not findings:
            root_cause_area = "INSUFFICIENT_TELEMETRY"
            missing_items = []
            if not context.su53_traces:
                missing_items.append("SU53 authorization trace export")
            if not context.error_logs:
                missing_items.append("SAP Gateway error log (/IWFND/ERROR_LOG)")
            if not context.icf_services:
                missing_items.append("SICF service status export")

            missing_str = ", ".join(missing_items) if missing_items else "detailed diagnostic logs"

            findings.append(
                Finding(
                    rule_id=self.RULE_INSUFFICIENT_TELEMETRY,
                    severity=Severity.MINOR,
                    category="Diagnostic Telemetry Gap",
                    title="HTTP 403 Received with Insufficient Diagnostic Telemetry",
                    description=(
                        f"An HTTP 403 Forbidden response was observed, but the root cause cannot be definitively determined "
                        f"because the following diagnostic artifacts are missing from the analysis request: {missing_str}. "
                        f"In accordance with Cardinal Axiom 2 and sap-evidence.md, confidence is demoted to UNKNOWN."
                    ),
                    confidence=ConfidenceClass.UNKNOWN,
                    confidence_score=0.30,
                    remediation=(
                        "To perform an exhaustive root-cause diagnosis, attach the following artifacts:\n"
                        "1. SU53 authorization failure export (run transaction SU53 immediately after receiving HTTP 403 and export text).\n"
                        "2. SAP Gateway error log (/IWFND/ERROR_LOG export for the relevant timestamp and user).\n"
                        "3. ICF service state from transaction SICF."
                    ),
                    evidence=[
                        Evidence(
                            artifact_path=f"{artifact_path}#http_response",
                            line_number=source_lines.get("http_headers", 1),
                            snippet=f"HTTP {http.status_code if http else 403} response received without matching SU53/IWFND failure records",
                            sha256=artifact_hash,
                            provenance=ConfidenceClass.UNKNOWN,
                            trust_score=0.30,
                        )
                    ],
                    technical_details={
                        "missingArtifacts": missing_items,
                        "httpStatus": http.status_code if http else 403,
                    },
                )
            )

        return findings, steps_evaluated, root_cause_area

    # -------------------------------------------------------------------------
    # Input Parser & Multi-Source Normalizer
    # -------------------------------------------------------------------------
    def _parse_inputs(
        self, request: AnalysisRequest
    ) -> Tuple[Fiori403NormalizedContext, Dict[str, int], str, str]:
        """
        Parses all available artifacts (JSON, raw text headers, SU53 trace, SICF tables, etc.).
        """
        context = Fiori403NormalizedContext()
        source_lines: Dict[str, int] = {}
        artifact_path = request.artifact_s3_key or "fiori_403_diagnostic_payload"
        raw_content_str = request.raw_content or ""

        # 1. Parse from request.configuration if provided
        if request.configuration:
            self._merge_dict_into_context(request.configuration, context, source_lines, 1)

        # 2. Parse inline raw_content
        if request.raw_content and request.raw_content.strip():
            raw_str = request.raw_content.strip()
            if raw_str.startswith("{") or raw_str.startswith("["):
                parsed_json = parse_json_payload(raw_str, self.rule_prefix)
                if isinstance(parsed_json, dict):
                    self._merge_dict_into_context(parsed_json, context, source_lines, 1)
                elif isinstance(parsed_json, list):
                    # List of traces or logs
                    for idx, item in enumerate(parsed_json):
                        if isinstance(item, dict):
                            self._merge_dict_into_context(item, context, source_lines, idx + 1)
            else:
                # Text-based parsing (HTTP header dump or SU53 text dump)
                self._parse_raw_text(raw_str, context, source_lines)

        # 3. Parse artifact attachments
        for art in request.artifacts:
            content = art.raw_content or ""
            if not content:
                continue
            art_name = art.file_name or "artifact"
            if art.artifact_type == ArtifactType.JSON or art_name.endswith(".json"):
                p_json = parse_json_payload(content, self.rule_prefix)
                if isinstance(p_json, dict):
                    self._merge_dict_into_context(p_json, context, source_lines, 1)
            elif art.artifact_type == ArtifactType.CSV or art_name.endswith(".csv"):
                self._parse_csv_artifact(content, art_name, context, source_lines)
            elif art.artifact_type == ArtifactType.TXT or art_name.endswith(".txt"):
                self._parse_raw_text(content, context, source_lines)

        return context, source_lines, artifact_path, raw_content_str

    def _merge_dict_into_context(
        self, data: Dict[str, Any], context: Fiori403NormalizedContext, source_lines: Dict[str, int], base_line: int
    ):
        # HTTP response
        if "http_response" in data and isinstance(data["http_response"], dict):
            context.http_response = FioriHttpResponse(**data["http_response"])
            source_lines["http_headers"] = base_line
        elif "status_code" in data or "status" in data:
            sc = int(data.get("status_code", data.get("status", 403)))
            meth = str(data.get("method", "GET"))
            url = str(data.get("url", ""))
            hdrs = data.get("headers", {}) if isinstance(data.get("headers"), dict) else {}
            body = str(data.get("body", ""))
            context.http_response = FioriHttpResponse(status_code=sc, method=meth, url=url, headers=hdrs, body=body)
            source_lines["http_headers"] = base_line

        # Error logs (/IWFND/ERROR_LOG)
        logs = data.get("iwfnd_error_log") or data.get("error_logs") or data.get("error_log")
        if isinstance(logs, list):
            for i, log_item in enumerate(logs):
                if isinstance(log_item, dict):
                    entry = IwfndErrorLogEntry(**log_item)
                    context.error_logs.append(entry)
                    if entry.service_name:
                        source_lines[f"iwfnd_{entry.service_name}"] = base_line + i

        # SU53 trace
        su53_data = data.get("su53") or data.get("su53_traces") or data.get("auth_trace")
        if isinstance(su53_data, list):
            for i, s in enumerate(su53_data):
                if isinstance(s, dict):
                    entry = Su53TraceEntry(**s)
                    context.su53_traces.append(entry)
                    source_lines[f"su53_{entry.auth_object}"] = base_line + i
        elif isinstance(su53_data, dict):
            entry = Su53TraceEntry(**su53_data)
            context.su53_traces.append(entry)
            source_lines[f"su53_{entry.auth_object}"] = base_line

        # SICF services
        sicf_data = data.get("sicf") or data.get("icf_services") or data.get("sicf_export")
        if isinstance(sicf_data, list):
            for i, sc in enumerate(sicf_data):
                if isinstance(sc, dict):
                    entry = SicfServiceEntry(**sc)
                    context.icf_services.append(entry)
                    source_lines[f"sicf_{entry.service_path}"] = base_line + i

        # UCON
        ucon_data = data.get("ucon") or data.get("ucon_rules")
        if isinstance(ucon_data, list):
            for i, u in enumerate(ucon_data):
                if isinstance(u, dict):
                    entry = UconRuleEntry(**u)
                    context.ucon_rules.append(entry)
                    source_lines[f"ucon_{entry.service_name}"] = base_line + i

        # Cloud Connector
        scc_data = data.get("cloud_connector") or data.get("cloud_connector_logs")
        if isinstance(scc_data, list):
            for i, c in enumerate(scc_data):
                if isinstance(c, dict):
                    context.cloud_connector_logs.append(CloudConnectorEntry(**c))
                    source_lines["cloud_connector"] = base_line + i

    def _parse_raw_text(
        self, text: str, context: Fiori403NormalizedContext, source_lines: Dict[str, int]
    ):
        """Parses raw HTTP header dumps or formatted SU53 text exports."""
        lines = text.splitlines()
        headers: Dict[str, str] = {}
        status_code = 403
        method = "GET"
        url = ""

        saw_http = False
        in_su53_block = False
        current_auth_obj = None
        current_fields: Dict[str, str] = {}
        current_rc = 4

        for idx, line in enumerate(lines, start=1):
            line_s = line.strip()
            if not line_s:
                continue

            # Detect HTTP status line: HTTP/1.1 403 Forbidden
            if line_s.startswith("HTTP/"):
                parts = line_s.split()
                if len(parts) >= 2 and parts[1].isdigit():
                    status_code = int(parts[1])
                    saw_http = True
                source_lines["http_headers"] = idx
            # Detect Method line: GET /sap/opu/odata/...
            elif any(line_s.startswith(m + " ") for m in ("GET", "POST", "PUT", "DELETE", "PATCH", "HEAD")):
                m_parts = line_s.split()
                method = m_parts[0]
                url = m_parts[1] if len(m_parts) > 1 else ""
                saw_http = True
            # Header key: value
            elif ":" in line_s and not in_su53_block:
                k, v = line_s.split(":", 1)
                headers[k.strip()] = v.strip()

            # SU53 text pattern: "Authorization Check Failed" or "Object: S_SERVICE"
            if "AUTHORIZATION CHECK FAILED" in line_s.upper() or "FAILED AUTHORIZATION" in line_s.upper():
                in_su53_block = True
            if in_su53_block:
                if "OBJECT" in line_s.upper() and ":" in line_s:
                    obj = line_s.split(":", 1)[1].strip()
                    current_auth_obj = obj
                elif "RC=" in line_s or "RETURN CODE" in line_s.upper():
                    m = re.search(r"RC\s*=\s*(\d+)", line_s, re.IGNORECASE)
                    if m:
                        current_rc = int(m.group(1))
                elif "=" in line_s and current_auth_obj:
                    # Field name = value
                    f_parts = line_s.split("=", 1)
                    current_fields[f_parts[0].strip()] = f_parts[1].strip()

        if current_auth_obj:
            context.su53_traces.append(
                Su53TraceEntry(
                    auth_object=current_auth_obj,
                    return_code=current_rc,
                    field_values=current_fields,
                )
            )
            source_lines[f"su53_{current_auth_obj}"] = 1

        # Header-like "key: value" lines alone are not an HTTP trace (they would turn any text into a 403).
        if not context.http_response and saw_http:
            context.http_response = FioriHttpResponse(
                status_code=status_code,
                method=method,
                url=url,
                headers=headers,
            )

    def _parse_csv_artifact(
        self, content: str, file_name: str, context: Fiori403NormalizedContext, source_lines: Dict[str, int]
    ):
        """Parses CSV tables representing SICF exports or SU53 extracts."""
        reader = csv.DictReader(io.StringIO(content))
        file_lower = file_name.lower()

        for idx, row in enumerate(reader, start=2):
            norm_row = {k.strip().lower(): (v.strip() if v is not None else "") for k, v in row.items() if k}
            if "sicf" in file_lower or "service_path" in norm_row or "icf_p结点" in norm_row:
                path = norm_row.get("service_path", norm_row.get("path", norm_row.get("url", "")))
                active_val = norm_row.get("is_active", norm_row.get("active", "true")).lower()
                is_act = active_val in ("true", "1", "x", "yes")
                if path:
                    context.icf_services.append(SicfServiceEntry(service_path=path, is_active=is_act))
                    source_lines[f"sicf_{path}"] = idx
            elif "su53" in file_lower or "auth_object" in norm_row or "object" in norm_row:
                obj = norm_row.get("auth_object", norm_row.get("object", ""))
                try:
                    rc = int(norm_row.get("return_code", norm_row.get("rc", 4)))
                except (ValueError, TypeError):
                    rc = 4
                if obj:
                    context.su53_traces.append(
                        Su53TraceEntry(auth_object=obj, return_code=rc, field_values=norm_row)
                    )
                    source_lines[f"su53_{obj}"] = idx
            elif "iwfnd" in file_lower or "error_code" in norm_row:
                err = norm_row.get("error_code", "")
                msg = norm_row.get("message", "")
                srv = norm_row.get("service_name", norm_row.get("service", ""))
                context.error_logs.append(IwfndErrorLogEntry(error_code=err, message=msg, service_name=srv))
                source_lines[f"iwfnd_{srv}"] = idx


# Backward-compatibility alias
FioriAuthGuardEngine = Fiori403Engine

__all__ = ["Fiori403Engine", "FioriAuthGuardEngine"]
