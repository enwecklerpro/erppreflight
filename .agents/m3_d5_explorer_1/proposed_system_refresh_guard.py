"""System Refresh & Data Masking Sanity Guard Engine.

Authoritative preflight audit engine verifying system isolation, configuration
sanitization, and data masking sanity after an SAP system refresh/homogeneous system
copy (e.g., PRD -> QAS or PRD -> DEV).

Features:
- Differential comparison of pre-refresh vs post-refresh system configurations.
- Production RFC destination target detection (RFCDES pointing to prod hosts/IPs/SIDs).
- Active SCOT outbound email routing verification (stopping email leakage to customers).
- Unadjusted logical system detection & incomplete BDLS conversion analysis (T000/BD54).
- Production payment, EDI, and billing background job sanitization check (TBTCO).
- Physical production network printer routing inspection (SPAD).
- Mathematically bounded Isolation Risk Score (0.0 - 10.0).
- Automated Post-Refresh Remediation Action Checklist generation.
- Full compliance with Cardinal Axiom 2 (14-Point Engine Anatomy).
"""

from __future__ import annotations

import csv
import io
import json
import re
import time
from typing import Any, Dict, List, Optional, Set, Tuple, Union

from pydantic import BaseModel, ConfigDict, Field

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


# ==============================================================================
# Input Domain Schemas & Models (Point 2: Input Schema)
# ==============================================================================

class RFCDestConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    destination: str = Field(..., description="RFC Destination name")
    dest_type: str = Field("3", description="RFC Type: 3=ABAP, T=TCP/IP, H=HTTP, G=Ext HTTP")
    target_host: Optional[str] = Field(None, description="Target host or IP address")
    target_ip: Optional[str] = None
    gateway_host: Optional[str] = None
    sysid: Optional[str] = None
    client: Optional[str] = None
    username: Optional[str] = None
    description: Optional[str] = None


class SCOTConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    smtp_active: bool = Field(False, description="Flag indicating outbound SMTP node is active")
    default_domain: Optional[str] = None
    routing_domain: Optional[str] = Field(None, description="Configured routing domain, e.g. '*' or test domain")
    redirect_all_to: Optional[str] = Field(None, description="Catch-all test email address")
    allowed_domains: List[str] = Field(default_factory=list, description="Whitelisted domains for test outbound")
    hold_outbound: bool = Field(False, description="Flag indicating all outbound email is held on queue")


class LogicalSystemConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    client: str = Field("100", description="SAP client number")
    logical_system: str = Field(..., description="Assigned logical system name, e.g. PRDCLNT100 or QASCLNT100")
    expected_logical_system: Optional[str] = None
    bdls_executed: bool = Field(True, description="Flag indicating BDLS conversion was successfully executed")


class JobSanitizationConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    job_name: str = Field(..., description="Background job name")
    job_count: str = Field("00000001")
    exec_user: Optional[str] = None
    status: str = Field("P", description="Status: P=Scheduled, S=Released, R=Running, F=Finished")
    periodic: bool = False


class PrinterConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    printer_name: str = Field(..., description="Spool device name")
    device_type: Optional[str] = None
    host_spool: Optional[str] = None
    is_production_printer: bool = False
    destination_host: Optional[str] = None


class IsolationPolicy(BaseModel):
    model_config = ConfigDict(extra="ignore")
    target_sid: str = Field("QAS", description="Expected SID of refreshed non-production system")
    target_client: str = Field("100", description="Expected primary client")
    environment_type: str = Field("QAS", description="Environment type: QAS, DEV, SANDBOX, TRAINING")
    production_sids: List[str] = Field(default_factory=lambda: ["PRD", "PROD"])
    production_host_patterns: List[str] = Field(
        default_factory=lambda: [r".*prd.*", r".*prod.*", r"^10\.100\..*", r"^10\.200\..*"]
    )
    allowed_email_domains: List[str] = Field(default_factory=lambda: ["test.corp", "dummy.local", "sandbox.corp"])
    sensitive_job_patterns: List[str] = Field(
        default_factory=lambda: [
            r".*f110.*",
            r".*payment.*",
            r".*billing.*",
            r".*edi.*",
            r".*idoc.*",
            r".*bank.*",
            r".*dtaus.*",
            r".*sepa.*",
        ]
    )


class SystemSnapshot(BaseModel):
    model_config = ConfigDict(extra="ignore")
    sid: str = "QAS"
    client: str = "100"
    rfc_destinations: List[RFCDestConfig] = Field(default_factory=list)
    scot: Optional[SCOTConfig] = None
    logical_systems: List[LogicalSystemConfig] = Field(default_factory=list)
    jobs: List[JobSanitizationConfig] = Field(default_factory=list)
    printers: List[PrinterConfig] = Field(default_factory=list)


class SystemRefreshNormalizedData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    pre_refresh: Optional[SystemSnapshot] = None
    post_refresh: SystemSnapshot = Field(default_factory=SystemSnapshot)
    policy: IsolationPolicy = Field(default_factory=IsolationPolicy)


# ==============================================================================
# Helper Utilities & Evidence Coordinate Resolver (Point 6)
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: str) -> Tuple[int, int, str]:
    """Deterministically locates the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return 1, 1, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return 1, 1, lines[0].strip() if lines else ""

    for idx, line in enumerate(lines, 1):
        pos = line.find(token_str)
        if pos != -1:
            return idx, pos + 1, line.strip()

    token_lower = token_str.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()

    return 1, 1, lines[0].strip() if lines else ""


def _normalize_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        clean = val.strip().upper()
        return clean in ("X", "TRUE", "1", "YES", "ACTIVE", "T")
    return False


ACTIVE_JOB_STATUSES = {"P", "S", "R", "Y", "SCHEDULED", "RELEASED", "RUNNING", "READY"}


# ==============================================================================
# Feature 35: System Refresh & Data Masking Sanity Guard (Cardinal Axiom 2)
# ==============================================================================

@register_engine
class SystemRefreshEngine(BaseEngine):
    """Authoritative preflight engine for system refresh and landscape isolation auditing."""

    # Point 1: Metadata
    engine_type = EngineType.SYSTEM_REFRESH_DELTA_GUARD
    name = "System Refresh Delta Guard"
    description = "Post-refresh BDLS, RFC destination, and logical system change validator"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.CSV, ArtifactType.TXT]

    def _parse_inputs(self, request: AnalysisRequest) -> Tuple[SystemRefreshNormalizedData, str, str]:
        """Parses pre-refresh, post-refresh, and isolation policy configurations."""
        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "refresh/post_refresh_config.json"

        if not raw_text and request.artifacts:
            for art in request.artifacts:
                if art.raw_content:
                    raw_text = art.raw_content
                    artifact_path = art.file_name
                    break

        data = SystemRefreshNormalizedData()

        # Parse raw JSON or configuration
        if raw_text and raw_text.strip().startswith("{"):
            try:
                parsed = json.loads(raw_text)
            except Exception:
                parsed = request.configuration or {}
        elif not raw_text and request.configuration:
            parsed = request.configuration
        elif raw_text and ("\n" in raw_text or "," in raw_text or ";" in raw_text):
            parsed = self._parse_csv_content(raw_text)
        else:
            parsed = request.configuration or {}

        # 1. Parse Policy
        raw_policy = parsed.get("isolation_policy", parsed.get("policy", request.configuration.get("policy", {})))
        if isinstance(raw_policy, dict):
            data.policy = IsolationPolicy(**raw_policy)

        # 2. Parse Pre-Refresh Snapshot (if present)
        raw_pre = parsed.get("pre_refresh", parsed.get("baseline"))
        if isinstance(raw_pre, dict):
            data.pre_refresh = self._parse_snapshot(raw_pre)

        # 3. Parse Post-Refresh Snapshot (primary evaluation target)
        raw_post = parsed.get("post_refresh", parsed.get("target", parsed))
        if isinstance(raw_post, dict):
            data.post_refresh = self._parse_snapshot(raw_post)

        # Support multi-artifact payload references
        if request.artifacts:
            for art in request.artifacts:
                c = art.raw_content or ""
                fn = art.file_name.lower()
                if "pre" in fn or "baseline" in fn:
                    try:
                        p = json.loads(c)
                        data.pre_refresh = self._parse_snapshot(p)
                    except Exception:
                        pass
                elif "post" in fn or "target" in fn:
                    try:
                        p = json.loads(c)
                        data.post_refresh = self._parse_snapshot(p)
                    except Exception:
                        pass
                elif "policy" in fn:
                    try:
                        p = json.loads(c)
                        data.policy = IsolationPolicy(**p)
                    except Exception:
                        pass

        return data, artifact_path, raw_text

    def _parse_snapshot(self, d: Dict[str, Any]) -> SystemSnapshot:
        snap = SystemSnapshot(
            sid=str(d.get("sid", "QAS")).strip().upper(),
            client=str(d.get("client", "100")).strip(),
        )

        # RFC Destinations
        raw_rfcs = d.get("rfc_destinations", d.get("rfcdes", d.get("rfc", [])))
        if isinstance(raw_rfcs, list):
            for r in raw_rfcs:
                if isinstance(r, dict):
                    dst = str(r.get("destination", r.get("rfcdest", ""))).strip().upper()
                    if dst:
                        snap.rfc_destinations.append(
                            RFCDestConfig(
                                destination=dst,
                                dest_type=str(r.get("dest_type", r.get("rfctype", "3"))).strip(),
                                target_host=r.get("target_host", r.get("rfchost")),
                                target_ip=r.get("target_ip", r.get("rfcip")),
                                gateway_host=r.get("gateway_host", r.get("rfcgwhost")),
                                sysid=r.get("sysid", r.get("rfcsysid")),
                                client=r.get("client", r.get("rfcclient")),
                                username=r.get("username", r.get("rfcuser")),
                                description=r.get("description", r.get("rfcdoc")),
                            )
                        )

        # SCOT
        raw_scot = d.get("scot", d.get("smtp"))
        if isinstance(raw_scot, dict):
            snap.scot = SCOTConfig(
                smtp_active=_normalize_bool(raw_scot.get("smtp_active", raw_scot.get("active", False))),
                default_domain=raw_scot.get("default_domain"),
                routing_domain=raw_scot.get("routing_domain"),
                redirect_all_to=raw_scot.get("redirect_all_to", raw_scot.get("redirect_address")),
                allowed_domains=raw_scot.get("allowed_domains", []),
                hold_outbound=_normalize_bool(raw_scot.get("hold_outbound", False)),
            )

        # Logical Systems
        raw_logsys = d.get("logical_systems", d.get("bd54", d.get("t000", [])))
        if isinstance(raw_logsys, list):
            for ls in raw_logsys:
                if isinstance(ls, dict):
                    name = str(ls.get("logical_system", ls.get("logsys", ""))).strip().upper()
                    if name:
                        snap.logical_systems.append(
                            LogicalSystemConfig(
                                client=str(ls.get("client", ls.get("mandt", snap.client))).strip(),
                                logical_system=name,
                                expected_logical_system=ls.get("expected_logical_system"),
                                bdls_executed=_normalize_bool(ls.get("bdls_executed", True)),
                            )
                        )
        elif isinstance(raw_logsys, dict):
            for client_k, ls_v in raw_logsys.items():
                snap.logical_systems.append(
                    LogicalSystemConfig(
                        client=str(client_k).strip(),
                        logical_system=str(ls_v).strip().upper(),
                    )
                )

        # Jobs
        raw_jobs = d.get("jobs", d.get("tbtco", []))
        if isinstance(raw_jobs, list):
            for j in raw_jobs:
                if isinstance(j, dict):
                    jn = str(j.get("job_name", j.get("jobname", ""))).strip().upper()
                    if jn:
                        snap.jobs.append(
                            JobSanitizationConfig(
                                job_name=jn,
                                job_count=str(j.get("job_count", "00000001")),
                                exec_user=j.get("exec_user", j.get("authname")),
                                status=str(j.get("status", "P")).strip().upper(),
                                periodic=_normalize_bool(j.get("periodic", False)),
                            )
                        )

        # Printers
        raw_printers = d.get("printers", d.get("spad", []))
        if isinstance(raw_printers, list):
            for p in raw_printers:
                if isinstance(p, dict):
                    pname = str(p.get("printer_name", p.get("padest", ""))).strip().upper()
                    if pname:
                        snap.printers.append(
                            PrinterConfig(
                                printer_name=pname,
                                device_type=p.get("device_type", p.get("patype")),
                                host_spool=p.get("host_spool", p.get("pacomm")),
                                is_production_printer=_normalize_bool(p.get("is_production_printer", False)),
                                destination_host=p.get("destination_host"),
                            )
                        )

        return snap

    def _parse_csv_content(self, text: str) -> Dict[str, Any]:
        """Parses CSV content with table section headers."""
        result: Dict[str, Any] = {"rfc_destinations": [], "logical_systems": [], "jobs": [], "printers": []}
        current_section = "rfc_destinations"
        lines = text.splitlines()
        reader = csv.reader(lines)

        for row in reader:
            if not row or not any(row):
                continue
            first = row[0].strip().upper()
            if first.startswith("[") and first.endswith("]"):
                tag = first[1:-1].strip().lower()
                if tag in result:
                    current_section = tag
                continue

            if current_section == "rfc_destinations" and len(row) >= 2:
                # e.g. RFCDEST,RFCHOST,RFCSYSID
                result["rfc_destinations"].append({
                    "destination": row[0].strip(),
                    "target_host": row[1].strip(),
                    "sysid": row[2].strip() if len(row) > 2 else None,
                })
            elif current_section == "logical_systems" and len(row) >= 2:
                # e.g. MANDT,LOGSYS
                result["logical_systems"].append({
                    "client": row[0].strip(),
                    "logical_system": row[1].strip(),
                })
            elif current_section == "jobs" and len(row) >= 2:
                # e.g. JOBNAME,STATUS
                result["jobs"].append({
                    "job_name": row[0].strip(),
                    "status": row[1].strip(),
                })
            elif current_section == "printers" and len(row) >= 2:
                # e.g. PADEST,PATYPE
                result["printers"].append({
                    "printer_name": row[0].strip(),
                    "device_type": row[1].strip(),
                })

        return {"post_refresh": result}

    # ==========================================================================
    # Main Engine Evaluation Pipeline (Point 4: Pure Rule Evaluation)
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        data, artifact_path, raw_text = self._parse_inputs(request)
        policy = data.policy
        post = data.post_refresh
        pre = data.pre_refresh

        total_settings_compared = 0
        identical_count = 0
        safe_deltas_count = 0
        hazardous_deltas_count = 0

        # Precompile policy patterns
        prod_host_regexes = [re.compile(p, re.IGNORECASE) for p in policy.production_host_patterns]
        job_regexes = [re.compile(p, re.IGNORECASE) for p in policy.sensitive_job_patterns]
        prod_sids_set = {s.upper() for s in policy.production_sids}

        # ----------------------------------------------------------------------
        # Rule 0: Target SID Sanity Check
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        total_settings_compared += 1
        if post.sid.upper() != policy.target_sid.upper():
            line_no, col_no, snippet = _locate_line_in_text(raw_text, post.sid)
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"sid: {post.sid}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Target snapshot SID is '{post.sid}', expected '{policy.target_sid}'",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="REFRESH_INPUT_SID_MISMATCH",
                severity=Severity.BLOCKER,
                category="LANDSCAPE_ISOLATION",
                title=f"Refreshed System SID Mismatch ('{post.sid}' vs Expected '{policy.target_sid}')",
                description=(
                    f"The post-refresh configuration export reports SID '{post.sid}', but the configured target "
                    f"isolation policy specifies '{policy.target_sid}'. Evaluating isolation rules against the wrong "
                    "system ID will produce false positive or invalid isolation results."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Verify that the uploaded post-refresh export matches the target system '{policy.target_sid}'. "
                    "Update the isolation policy target_sid parameter if inspecting a different environment."
                ),
                evidence=[ev],
                affected_objects=[post.sid, policy.target_sid],
                technical_details={"snapshotSID": post.sid, "expectedSID": policy.target_sid},
            )
            findings.append(ConfidenceClassifier.classify(f))
            hazardous_deltas_count += 1
        else:
            identical_count += 1

        # ----------------------------------------------------------------------
        # Rule 1: RFC Destination Points to Production System
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        dangerous_rfcs: List[Dict[str, Any]] = []

        # Build map of pre-refresh RFC hosts for delta comparison
        pre_rfc_hosts: Dict[str, str] = {}
        if pre:
            for r in pre.rfc_destinations:
                if r.target_host:
                    pre_rfc_hosts[r.destination.upper()] = r.target_host

        for rfc in post.rfc_destinations:
            total_settings_compared += 1
            host = rfc.target_host or rfc.target_ip or ""
            sysid = (rfc.sysid or "").upper()
            is_prod_target = False
            reason = ""

            # Check prod SID
            if sysid and sysid in prod_sids_set:
                is_prod_target = True
                reason = f"RFC Destination configured with production System ID '{sysid}'"

            # Check prod host regexes
            if not is_prod_target and host:
                for rgx in prod_host_regexes:
                    if rgx.match(host):
                        is_prod_target = True
                        reason = f"Target host '{host}' matches production host pattern '{rgx.pattern}'"
                        break

            # Check unadjusted pre-refresh prod host
            if not is_prod_target and host and pre_rfc_hosts.get(rfc.destination.upper()) == host:
                # If host in pre-refresh was also matching prod
                for rgx in prod_host_regexes:
                    if rgx.match(host):
                        is_prod_target = True
                        reason = f"Target host '{host}' was copied unchanged from production baseline"
                        break

            if is_prod_target:
                hazardous_deltas_count += 1
                dangerous_rfcs.append({
                    "destination": rfc.destination,
                    "targetHost": host,
                    "sysid": sysid,
                    "reason": reason,
                })
            else:
                if host:
                    safe_deltas_count += 1
                else:
                    identical_count += 1

        if dangerous_rfcs:
            rfc_dest_names = [d["destination"] for d in dangerous_rfcs]
            first_dest = dangerous_rfcs[0]["destination"]
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_dest)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"rfc_prod_target: {first_dest}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"RFC Destination '{first_dest}' points to production target",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="REFRESH_RFC_TARGETS_PRODUCTION",
                severity=Severity.CRITICAL,
                category="LANDSCAPE_ISOLATION",
                title=f"RFC Destination(s) Point to Production System in Refreshed {post.sid}",
                description=(
                    f"Detected {len(dangerous_rfcs)} RFC destination(s) in refreshed non-production system {post.sid} "
                    f"that point to production hostnames, IPs, or production SIDs: {', '.join(rfc_dest_names[:5])}. "
                    "Executing test transactions or background interfaces in this refreshed system will trigger live "
                    "remote calls and financial/inventory postings in production systems."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Immediately update or delete dangerous RFC destinations in transaction SM59. Redirect all RFC "
                    f"destinations to QA mock endpoints (e.g. qa-*.acme.corp) before unlocking dialog users."
                ),
                evidence=[ev],
                affected_objects=[post.sid] + rfc_dest_names[:10],
                technical_details={"dangerousRfcCount": len(dangerous_rfcs), "dangerousRfcs": dangerous_rfcs},
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 2: SCOT Outbound Email Routing Active Without Redirection
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        total_settings_compared += 1
        scot = post.scot
        if scot and scot.smtp_active:
            # Check if redirection is present
            has_redirect = bool(scot.redirect_all_to and scot.redirect_all_to.strip())
            is_held = scot.hold_outbound
            allowed_domains = {d.lower() for d in scot.allowed_domains}
            whitelisted_policy = {d.lower() for d in policy.allowed_email_domains}

            is_email_hazardous = False
            scot_reason = ""

            if not has_redirect and not is_held:
                # If routing domain is wildcard '*' or real domain
                if scot.routing_domain in ("*", None, "") or not allowed_domains.issubset(whitelisted_policy):
                    is_email_hazardous = True
                    scot_reason = "SMTP outbound is active with wildcard routing (*) and no central redirect address."
            elif has_redirect:
                # Check redirect address domain
                redirect_domain = scot.redirect_all_to.split("@")[-1].lower() if "@" in scot.redirect_all_to else ""
                if redirect_domain and not any(wd in redirect_domain for wd in whitelisted_policy):
                    is_email_hazardous = True
                    scot_reason = f"Redirect address '{scot.redirect_all_to}' does not route to approved test domain."

            if is_email_hazardous:
                hazardous_deltas_count += 1
                line_no, col_no, snippet = _locate_line_in_text(raw_text, "smtp_active")
                if line_no == 1 and not snippet:
                    line_no, col_no, snippet = _locate_line_in_text(raw_text, "scot")

                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or "scot_smtp_active: true",
                    line_number=line_no,
                    column_number=col_no,
                    snippet=snippet or "SCOT SMTP node active with unrestricted outbound routing",
                    provenance=ConfidenceClass.VERIFIED,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="REFRESH_SCOT_OUTBOUND_ACTIVE",
                    severity=Severity.CRITICAL,
                    category="LANDSCAPE_ISOLATION",
                    title=f"SCOT Email Routing Active Without Redirection in {post.sid}",
                    description=(
                        f"SAPconnect (SCOT) outbound email transmission is actively enabled in refreshed system {post.sid} "
                        "without a mandatory catch-all test redirection address or domain whitelist. Test business "
                        "transactions (billing runs, purchase orders, dunning) will dispatch real emails to actual "
                        "customers, vendors, and partners."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        "Configure global email redirection in transaction SCOT: Settings -> Routing -> "
                        "Set 'Redirect all outbound messages to' a designated test mailbox (e.g. qa-catchall@test.corp), "
                        "or set the SMTP node to HOLD state."
                    ),
                    evidence=[ev],
                    affected_objects=["SCOT", post.sid],
                    technical_details={
                        "smtpActive": scot.smtp_active,
                        "routingDomain": scot.routing_domain,
                        "redirectAddress": scot.redirect_all_to,
                        "reason": scot_reason,
                    },
                )
                findings.append(ConfidenceClassifier.classify(f))
            else:
                safe_deltas_count += 1
        elif scot and not scot.smtp_active:
            safe_deltas_count += 1
        else:
            identical_count += 1

        # ----------------------------------------------------------------------
        # Rule 3: Client Logical System Name Unadjusted / BDLS Incomplete
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        unadjusted_logsys: List[LogicalSystemConfig] = []

        for ls in post.logical_systems:
            total_settings_compared += 1
            curr = ls.logical_system.upper()
            has_prod_prefix = any(curr.startswith(ps) for ps in prod_sids_set)
            is_bdls_missing = not ls.bdls_executed

            # If expected_logical_system is defined
            mismatch_expected = (ls.expected_logical_system and curr != ls.expected_logical_system.upper())

            if has_prod_prefix or is_bdls_missing or mismatch_expected:
                hazardous_deltas_count += 1
                unadjusted_logsys.append(ls)
            else:
                safe_deltas_count += 1

        if unadjusted_logsys:
            first_ls = unadjusted_logsys[0]
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_ls.logical_system)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"logsys: {first_ls.logical_system}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Logical system '{first_ls.logical_system}' for client {first_ls.client}",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="REFRESH_LOGICAL_SYSTEM_UNADJUSTED",
                severity=Severity.CRITICAL,
                category="LANDSCAPE_ISOLATION",
                title=f"Logical System Name Unadjusted (BDLS Incomplete) in {post.sid}",
                description=(
                    f"Client {first_ls.client} in refreshed system {post.sid} is still assigned production logical system "
                    f"'{first_ls.logical_system}'. Incomplete BDLS conversion leaves ALE/IDoc partner profiles, BW extractors, "
                    "and workflow event linkages pointing to the production landscape."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Execute logical system conversion in transaction BDLS: Convert old logical system "
                    f"'{first_ls.logical_system}' to target logical system (e.g. '{post.sid}CLNT{first_ls.client}')."
                ),
                evidence=[ev],
                affected_objects=[first_ls.logical_system, f"CLIENT_{first_ls.client}"],
                technical_details={
                    "unadjustedCount": len(unadjusted_logsys),
                    "logicalSystems": [
                        {"client": l.client, "logicalSystem": l.logical_system, "bdlsExecuted": l.bdls_executed}
                        for l in unadjusted_logsys
                    ],
                },
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 4: Production Payment & Sensitive Jobs Scheduled Post-Refresh
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        critical_jobs: List[JobSanitizationConfig] = []

        for job in post.jobs:
            total_settings_compared += 1
            if job.status.upper() in ACTIVE_JOB_STATUSES:
                # Check sensitive job patterns
                is_sensitive = any(rgx.match(job.job_name) for rgx in job_regexes)
                if is_sensitive:
                    hazardous_deltas_count += 1
                    critical_jobs.append(job)
                else:
                    safe_deltas_count += 1
            else:
                identical_count += 1

        if critical_jobs:
            job_names = [j.job_name for j in critical_jobs]
            first_job = critical_jobs[0].job_name
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_job)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"critical_job: {first_job}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Sensitive job '{first_job}' active in refreshed system",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="REFRESH_CRITICAL_JOB_SCHEDULED",
                severity=Severity.CRITICAL,
                category="LANDSCAPE_ISOLATION",
                title=f"Sensitive Production Batch Jobs Scheduled in Refreshed {post.sid}",
                description=(
                    f"Detected {len(critical_jobs)} sensitive production background job(s) in active status "
                    f"(SCHEDULED/RELEASED) in {post.sid}: {', '.join(job_names[:5])}. "
                    "Uncancelled production payment runs (F110), EDI dispatches, and billing runs copied from PRD "
                    "will execute automatically upon background work process startup."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Execute report BTCTRNS1 in SE38 prior to batch scheduler startup to suspend all background jobs. "
                    "Delete or cancel production payment and interface jobs via SM37."
                ),
                evidence=[ev],
                affected_objects=[post.sid] + job_names[:10],
                technical_details={"criticalJobCount": len(critical_jobs), "jobs": job_names},
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 5: Production Physical Network Printers Active
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        active_prod_printers: List[PrinterConfig] = []

        for p in post.printers:
            total_settings_compared += 1
            if p.is_production_printer or (p.destination_host and any(rgx.match(p.destination_host) for rgx in prod_host_regexes)):
                hazardous_deltas_count += 1
                active_prod_printers.append(p)
            else:
                safe_deltas_count += 1

        if active_prod_printers:
            p_names = [p.printer_name for p in active_prod_printers]
            first_p = p_names[0]
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_p)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"prod_printer: {first_p}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Physical production printer '{first_p}' configured in {post.sid}",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="REFRESH_PRODUCTION_PRINTER_ACTIVE",
                severity=Severity.MAJOR,
                category="LANDSCAPE_ISOLATION",
                title=f"Production Physical Network Printers Configured in Refreshed {post.sid}",
                description=(
                    f"Found {len(active_prod_printers)} production physical printer(s) in spool administration (SPAD) "
                    f"in {post.sid}: {', '.join(p_names[:5])}. Test print requests will physically output onto "
                    "production plant or warehouse floor printers."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "In transaction SPAD, disable network output for physical printers or re-route spool requests "
                    "to dummy device 'LP01' or PDF archive destination."
                ),
                evidence=[ev],
                affected_objects=p_names[:10],
                technical_details={"productionPrinterCount": len(active_prod_printers), "printers": p_names},
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 6: Sanitary Isolation Confirmation
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        if hazardous_deltas_count == 0 and findings == []:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, post.sid)
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"isolation_verified: {post.sid}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"System {post.sid} isolation verified cleanly",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="REFRESH_ISOLATION_VERIFIED",
                severity=Severity.INFO,
                category="LANDSCAPE_ISOLATION",
                title=f"System Refresh Isolation Verified for {post.sid}",
                description=(
                    f"Differential configuration audit verified that non-production system {post.sid} is completely "
                    "isolated from the production landscape. All RFC destinations point to non-prod endpoints, SCOT "
                    "email redirection is active or held, logical system names are converted, and sensitive batch "
                    "jobs are sanitized."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation="System is safely isolated. Proceed with post-refresh user unlock and test execution.",
                evidence=[ev],
                affected_objects=[post.sid],
                technical_details={"isIsolated": True, "totalSettingsCompared": total_settings_compared},
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Mathematical Isolation Risk Score Calculation (0.0 - 10.0)
        # ----------------------------------------------------------------------
        risk_score = 0.0
        # Dangerous RFCs: +3.5 base + 1.0 per additional (cap +5.0)
        if dangerous_rfcs:
            risk_score += min(5.0, 3.5 + (len(dangerous_rfcs) - 1) * 1.0)

        # SCOT email active: +4.0
        if any(f.rule_id == "REFRESH_SCOT_OUTBOUND_ACTIVE" for f in findings):
            risk_score += 4.0

        # Unadjusted logical system (BDLS): +3.0
        if unadjusted_logsys:
            risk_score += 3.0

        # Critical jobs scheduled: +2.0 base + 0.5 per additional (cap +4.0)
        if critical_jobs:
            risk_score += min(4.0, 2.0 + (len(critical_jobs) - 1) * 0.5)

        # Active production printers: +1.0 base + 0.5 per additional (cap +2.0)
        if active_prod_printers:
            risk_score += min(2.0, 1.0 + (len(active_prod_printers) - 1) * 0.5)

        # SID Mismatch
        if any(f.rule_id == "REFRESH_INPUT_SID_MISMATCH" for f in findings):
            risk_score += 5.0

        isolation_risk_score = round(min(10.0, risk_score), 1)

        # ----------------------------------------------------------------------
        # Post-Refresh Remediation Action Checklist
        # ----------------------------------------------------------------------
        remediation_checklist: List[Dict[str, str]] = []
        if dangerous_rfcs:
            remediation_checklist.append({
                "step": "SANITIZE_RFC_DESTINATIONS",
                "transaction": "SM59",
                "action": f"Redirect {len(dangerous_rfcs)} RFC destinations to QA mock endpoints or delete them.",
            })
        if any(f.rule_id == "REFRESH_SCOT_OUTBOUND_ACTIVE" for f in findings):
            remediation_checklist.append({
                "step": "REDIRECT_SCOT_EMAIL",
                "transaction": "SCOT",
                "action": "Configure central test redirection address or set outbound SMTP node to HOLD state.",
            })
        if unadjusted_logsys:
            remediation_checklist.append({
                "step": "CONVERT_LOGICAL_SYSTEMS",
                "transaction": "BDLS",
                "action": f"Execute BDLS conversion from PRD logical system to {post.sid}CLNT{unadjusted_logsys[0].client}.",
            })
        if critical_jobs:
            remediation_checklist.append({
                "step": "SUSPEND_BATCH_JOBS",
                "program": "BTCTRNS1",
                "action": "Execute BTCTRNS1 to suspend background scheduling before starting batch application servers.",
            })
        if active_prod_printers:
            remediation_checklist.append({
                "step": "RE_ROUTE_SPAD_PRINTERS",
                "transaction": "SPAD",
                "action": f"Re-route {len(active_prod_printers)} production printers to dummy device LP01.",
            })

        execution_time_ms = int((time.perf_counter() - start_time) * 1000)

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=execution_time_ms,
                rules_evaluated=rules_evaluated,
                artifacts_scanned=1,
                additional_metrics={
                    "targetSID": post.sid,
                    "targetClient": post.client,
                    "totalSettingsCompared": total_settings_compared,
                    "identicalCount": identical_count,
                    "safeDeltasCount": safe_deltas_count,
                    "hazardousDeltasCount": hazardous_deltas_count,
                    "isolationRiskScore": isolation_risk_score,
                    "remediationChecklist": remediation_checklist,
                },
            ),
        )
