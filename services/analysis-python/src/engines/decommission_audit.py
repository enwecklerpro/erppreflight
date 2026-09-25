"""Safe Decommission & Archiving Readiness Engine.

Authoritative preflight audit engine assessing operational impact before locking,
deactivating, or archiving SAP user accounts, technical users, RFC destinations,
and service accounts.

Features:
- Multi-artifact ingestion across USR02, TBTCO/TBTCP, RFCDES, SWWWIHEAD, and SM20/ST03N.
- Scheduled background job ownership & execution analysis (TBTCO).
- Active RFC destination logon credentials analysis (RFCDES).
- Pending workflow work items and sole agent deadlock analysis (SWWWIHEAD).
- Recent activity audit and locked-user call flood detection (SM20 / ST03N / USR02).
- Mathematically bounded Decommission Risk Score (0.0 - 10.0).
- Automated Reassignment Action Checklist generation.
- Full compliance with Cardinal Axiom 2 (14-Point Engine Anatomy).
"""

from __future__ import annotations

import csv
import json
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional, Tuple

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
from src.core.exceptions import EngineInputError
from src.parsers.json_input import parse_json_object


# ==============================================================================
# Input Domain Schemas & Models (Point 2: Input Schema)
# ==============================================================================

class USR02Entry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    bname: str = Field(..., description="User logon name")
    user_type: str = Field("A", description="User type: A=Dialog, B=System, C=Comm, S=Service, X=Ref")
    user_group: Optional[str] = None
    lock_status: int = Field(0, description="Lock status: 0=unlocked, 64=admin locked, 128=pwd locked")
    valid_from: Optional[str] = None
    valid_to: Optional[str] = None
    last_logon_date: Optional[str] = None
    last_logon_time: Optional[str] = None


class TBTCOEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    job_name: str = Field(..., description="Background job name")
    job_count: str = Field("00000001", description="Background job ID count")
    scheduler: Optional[str] = Field(None, description="Scheduled by user (SDLUNAME)")
    exec_user: Optional[str] = Field(None, description="Execution user (AUTHNAME)")
    status: str = Field("P", description="Job status: P=Scheduled, S=Released, R=Running, Y=Ready, F=Finished, A=Aborted")
    periodic: bool = Field(False, description="Flag indicating recurring periodic job")
    period_details: Optional[str] = None
    program_name: Optional[str] = None


class RFCDESEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    destination: str = Field(..., description="RFC destination name")
    dest_type: str = Field("3", description="RFC type: 3=ABAP, T=TCP/IP, H=HTTP, G=Ext HTTP")
    username: Optional[str] = Field(None, description="Configured logon username")
    target_host: Optional[str] = None
    gateway_host: Optional[str] = None
    sysid: Optional[str] = None
    client: Optional[str] = None
    description: Optional[str] = None


class SWWWIHEADEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    wi_id: str = Field(..., description="Workflow work item ID")
    wi_type: str = Field("W", description="Work item type: W=Dialog Task, F=Workflow, B=Background")
    status: str = Field("READY", description="Status: READY, SELECTED, STARTED, COMMITTED, COMPLETED, ERROR, CANCELLED")
    assigned_agent: Optional[str] = Field(None, description="Assigned recipient user or rule")
    actual_agent: Optional[str] = Field(None, description="Current processor / actual agent")
    task_id: Optional[str] = None
    wi_text: Optional[str] = None
    creation_date: Optional[str] = None


class AuditLogEntry(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user: str = Field(..., description="User ID in audit entry")
    event_type: str = Field("LOGON", description="Event type: LOGON, RFC_CALL, TCODE_EXEC, FAILED_LOGON")
    tcode: Optional[str] = None
    report_name: Optional[str] = None
    timestamp: Optional[str] = None
    terminal: Optional[str] = None
    success: bool = True
    call_count: int = 1


class DecommissionNormalizedData(BaseModel):
    model_config = ConfigDict(extra="ignore")
    target_user: Optional[str] = None
    grace_period_days: int = 90
    evaluation_date: Optional[str] = None
    users: Dict[str, USR02Entry] = Field(default_factory=dict)
    jobs: List[TBTCOEntry] = Field(default_factory=list)
    rfc_destinations: List[RFCDESEntry] = Field(default_factory=list)
    work_items: List[SWWWIHEADEntry] = Field(default_factory=list)
    audit_logs: List[AuditLogEntry] = Field(default_factory=list)
    # Tables actually supplied in the input (even if empty) — a positive verdict requires all of
    # REQUIRED_VERDICT_TABLES; absence of a table is never treated as "no dependencies".
    supplied_tables: List[str] = Field(default_factory=list)


# ==============================================================================
# Helper Utilities & Evidence Coordinate Resolver (Point 6)
# ==============================================================================

def _locate_line_in_text(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically locates the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    token_str = str(token).strip()
    if not token_str:
        return None, None, ""

    for idx, line in enumerate(lines, 1):
        pos = line.find(token_str)
        if pos != -1:
            return idx, pos + 1, line.strip()

    token_lower = token_str.lower()
    for idx, line in enumerate(lines, 1):
        pos = line.lower().find(token_lower)
        if pos != -1:
            return idx, pos + 1, line.strip()

    return None, None, ""


def _normalize_bool(val: Any) -> bool:
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        return val != 0
    if isinstance(val, str):
        clean = val.strip().upper()
        return clean in ("X", "TRUE", "1", "YES", "ACTIVE", "T")
    return False


def _parse_date(date_val: Optional[str]) -> Optional[date]:
    if not date_val:
        return None
    cleaned = str(date_val).strip()
    for fmt in ("%Y-%m-%d", "%Y%m%d", "%d.%m.%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            pass
    return None


REQUIRED_VERDICT_TABLES = ("usr02", "tbtco", "rfcdes", "swwwihead")
_TABLE_KEYS = {
    "usr02": ("usr02", "users"),
    "tbtco": ("tbtco", "jobs"),
    "rfcdes": ("rfcdes", "rfc_destinations", "rfc"),
    "swwwihead": ("swwwihead", "work_items", "workflows"),
    "sm20": ("sm20", "st03n", "audit_logs"),
}

ACTIVE_JOB_STATUSES = {"P", "S", "R", "Y", "SCHEDULED", "RELEASED", "RUNNING", "READY"}
PENDING_WORK_ITEM_STATUSES = {"READY", "SELECTED", "STARTED"}


# ==============================================================================
# Feature 30: Safe Decommission & Archiving Readiness Engine (Cardinal Axiom 2)
# ==============================================================================

@register_engine
class DecommissionAuditEngine(BaseEngine):
    """Authoritative preflight engine for safe decommissioning and user archiving."""

    # Point 1: Metadata
    engine_type = EngineType.SAFE_DECOMMISSION_PREFLIGHT
    rule_prefix = "DECOM"
    name = "Safe Decommission Preflight"
    description = "Unused Z-program, table, and interface retirement preflight validator"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.CSV, ArtifactType.TXT]

    def _parse_inputs(self, request: AnalysisRequest) -> Tuple[DecommissionNormalizedData, str, str]:
        """Parses and normalizes multi-artifact input across JSON, CSV, and multi-file requests."""
        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "decommission/user_inventory.json"

        # Check multi-artifact list
        if not raw_text and request.artifacts:
            for art in request.artifacts:
                if art.raw_content:
                    raw_text = art.raw_content
                    artifact_path = art.file_name
                    break

        data = DecommissionNormalizedData()

        # Parse raw content or configuration (malformed JSON is reported, never replaced by {})
        stripped = raw_text.strip() if raw_text else ""
        if stripped.startswith("{") or stripped.startswith("["):
            parsed = parse_json_object(raw_text, self.rule_prefix)
        elif not raw_text and request.configuration:
            parsed = request.configuration
        elif raw_text and ("\n" in raw_text or "," in raw_text or ";" in raw_text):
            parsed = self._parse_csv_content(raw_text)
        else:
            parsed = request.configuration or {}

        # 1. Target user & options (no default identity: the decommissioning candidate must be supplied)
        t_user = (
            parsed.get("target_user")
            or parsed.get("bname")
            or parsed.get("username")
            or parsed.get("user")
            or request.configuration.get("target_user")
        )
        if isinstance(t_user, str) and t_user.strip():
            data.target_user = t_user.strip().upper()
        raw_grace = parsed.get("grace_period_days", request.configuration.get("grace_period_days", 90))
        try:
            data.grace_period_days = int(raw_grace)
        except (TypeError, ValueError):
            raise EngineInputError(
                f"{self.rule_prefix}_INVALID_INPUT",
                "Field 'grace_period_days' must be an integer number of days.",
            )
        for table, keys in _TABLE_KEYS.items():
            if any(isinstance(parsed.get(k), list) for k in keys):
                data.supplied_tables.append(table)
        data.evaluation_date = (
            parsed.get("evaluation_date")
            or parsed.get("snapshot_date")
            or (request.configuration or {}).get("evaluation_date")
            or (request.configuration or {}).get("snapshot_date")
        )

        # Also inspect multi-artifacts if provided
        if request.artifacts:
            for art in request.artifacts:
                c = art.raw_content or ""
                fn = art.file_name.lower()
                if "usr02" in fn:
                    self._populate_usr02(data, c)
                    data.supplied_tables.append("usr02")
                elif "tbtco" in fn or "jobs" in fn:
                    self._populate_tbtco(data, c)
                    data.supplied_tables.append("tbtco")
                elif "rfcdes" in fn or "rfc" in fn:
                    self._populate_rfcdes(data, c)
                    data.supplied_tables.append("rfcdes")
                elif "swwwihead" in fn or "workflow" in fn:
                    self._populate_swwwihead(data, c)
                    data.supplied_tables.append("swwwihead")
                elif "sm20" in fn or "st03n" in fn or "audit" in fn:
                    self._populate_audit(data, c)
                    data.supplied_tables.append("sm20")

        # 2. Extract USR02
        raw_usr02 = parsed.get("usr02", parsed.get("users", []))
        if isinstance(raw_usr02, list):
            for item in raw_usr02:
                if isinstance(item, dict):
                    bname = str(item.get("bname", item.get("username", ""))).strip().upper()
                    if bname:
                        u_type = str(item.get("user_type", item.get("ustyp", "A"))).strip().upper()
                        lock = int(item.get("lock_status", item.get("uflag", 0)))
                        data.users[bname] = USR02Entry(
                            bname=bname,
                            user_type=u_type,
                            user_group=item.get("user_group", item.get("class")),
                            lock_status=lock,
                            valid_from=item.get("valid_from", item.get("gltgv")),
                            valid_to=item.get("valid_to", item.get("gltgb")),
                            last_logon_date=item.get("last_logon_date", item.get("trdat")),
                            last_logon_time=item.get("last_logon_time", item.get("ltime")),
                        )

        # 3. Extract TBTCO
        raw_tbtco = parsed.get("tbtco", parsed.get("jobs", []))
        if isinstance(raw_tbtco, list):
            for item in raw_tbtco:
                if isinstance(item, dict):
                    j_name = str(item.get("job_name", item.get("jobname", ""))).strip().upper()
                    if j_name:
                        data.jobs.append(
                            TBTCOEntry(
                                job_name=j_name,
                                job_count=str(item.get("job_count", item.get("jobcount", "00000001"))),
                                scheduler=str(item.get("scheduler", item.get("sdlutype", item.get("sdlname", "")))).strip().upper() or None,
                                exec_user=str(item.get("exec_user", item.get("authname", ""))).strip().upper() or None,
                                status=str(item.get("status", "P")).strip().upper(),
                                periodic=_normalize_bool(item.get("periodic", False)),
                                period_details=item.get("period_details", item.get("prdtext")),
                                program_name=item.get("program_name", item.get("progname")),
                            )
                        )

        # 4. Extract RFCDES
        raw_rfcdes = parsed.get("rfcdes", parsed.get("rfc_destinations", parsed.get("rfc", [])))
        if isinstance(raw_rfcdes, list):
            for item in raw_rfcdes:
                if isinstance(item, dict):
                    dest = str(item.get("destination", item.get("rfcdest", ""))).strip().upper()
                    if dest:
                        u_name = item.get("username", item.get("rfcuser"))
                        data.rfc_destinations.append(
                            RFCDESEntry(
                                destination=dest,
                                dest_type=str(item.get("dest_type", item.get("rfctype", "3"))).strip(),
                                username=str(u_name).strip().upper() if u_name else None,
                                target_host=item.get("target_host", item.get("rfchost")),
                                gateway_host=item.get("gateway_host", item.get("rfcgwhost")),
                                sysid=item.get("sysid", item.get("rfcsysid")),
                                client=item.get("client", item.get("rfcclient")),
                                description=item.get("description", item.get("rfcdoc")),
                            )
                        )

        # 5. Extract SWWWIHEAD
        raw_wf = parsed.get("swwwihead", parsed.get("work_items", parsed.get("workflows", [])))
        if isinstance(raw_wf, list):
            for item in raw_wf:
                if isinstance(item, dict):
                    wi_id = str(item.get("wi_id", item.get("wiid", ""))).strip()
                    if wi_id:
                        data.work_items.append(
                            SWWWIHEADEntry(
                                wi_id=wi_id,
                                wi_type=str(item.get("wi_type", item.get("witype", "W"))).strip().upper(),
                                status=str(item.get("status", item.get("wi_stat", "READY"))).strip().upper(),
                                assigned_agent=str(item.get("assigned_agent", item.get("agent", ""))).strip().upper() or None,
                                actual_agent=str(item.get("actual_agent", item.get("wi_aagent", ""))).strip().upper() or None,
                                task_id=item.get("task_id", item.get("wi_rh_task")),
                                wi_text=item.get("wi_text", item.get("text")),
                                creation_date=item.get("creation_date", item.get("wi_cd")),
                            )
                        )

        # 6. Extract SM20 / ST03N
        raw_audit = parsed.get("sm20", parsed.get("st03n", parsed.get("audit_logs", [])))
        if isinstance(raw_audit, list):
            for item in raw_audit:
                if isinstance(item, dict):
                    u = str(item.get("user", item.get("bname", ""))).strip().upper()
                    if u:
                        data.audit_logs.append(
                            AuditLogEntry(
                                user=u,
                                event_type=str(item.get("event_type", item.get("event", "LOGON"))).strip().upper(),
                                tcode=item.get("tcode"),
                                report_name=item.get("report_name", item.get("report")),
                                timestamp=item.get("timestamp", item.get("time")),
                                terminal=item.get("terminal"),
                                success=_normalize_bool(item.get("success", True)),
                                call_count=int(item.get("call_count", item.get("count", 1))),
                            )
                        )

        return data, artifact_path, raw_text

    def _parse_csv_content(self, text: str) -> Dict[str, Any]:
        """Parses CSV content with optional table section blocks."""
        result: Dict[str, Any] = {"usr02": [], "tbtco": [], "rfcdes": [], "swwwihead": [], "sm20": []}
        current_section = "usr02"
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

            if current_section == "usr02" and len(row) >= 2:
                # e.g. BNAME,USTYP,UFLAG,TRDAT
                result["usr02"].append({
                    "bname": row[0].strip(),
                    "user_type": row[1].strip() if len(row) > 1 else "A",
                    "lock_status": int(row[2].strip()) if len(row) > 2 and row[2].strip().isdigit() else 0,
                    "last_logon_date": row[3].strip() if len(row) > 3 else None,
                })
            elif current_section == "tbtco" and len(row) >= 3:
                # e.g. JOBNAME,AUTHNAME,STATUS,PERIODIC
                result["tbtco"].append({
                    "job_name": row[0].strip(),
                    "exec_user": row[1].strip(),
                    "status": row[2].strip(),
                    "periodic": _normalize_bool(row[3]) if len(row) > 3 else False,
                })
            elif current_section == "rfcdes" and len(row) >= 2:
                # e.g. RFCDEST,RFCUSER,RFCHOST
                result["rfcdes"].append({
                    "destination": row[0].strip(),
                    "username": row[1].strip(),
                    "target_host": row[2].strip() if len(row) > 2 else None,
                })
            elif current_section == "swwwihead" and len(row) >= 3:
                # e.g. WI_ID,AGENT,STATUS
                result["swwwihead"].append({
                    "wi_id": row[0].strip(),
                    "assigned_agent": row[1].strip(),
                    "status": row[2].strip(),
                })

        return result

    def _populate_usr02(self, data: DecommissionNormalizedData, content: str):
        if content.strip().startswith("{") or content.strip().startswith("["):
            try:
                items = json.loads(content)
                if isinstance(items, list):
                    for it in items:
                        bn = str(it.get("bname", "")).strip().upper()
                        if bn:
                            data.users[bn] = USR02Entry(**it)
            except Exception:
                pass

    def _populate_tbtco(self, data: DecommissionNormalizedData, content: str):
        if content.strip().startswith("{") or content.strip().startswith("["):
            try:
                items = json.loads(content)
                if isinstance(items, list):
                    for it in items:
                        jn = str(it.get("job_name", it.get("jobname", ""))).strip().upper()
                        if jn:
                            data.jobs.append(TBTCOEntry(**it))
            except Exception:
                pass

    def _populate_rfcdes(self, data: DecommissionNormalizedData, content: str):
        if content.strip().startswith("{") or content.strip().startswith("["):
            try:
                items = json.loads(content)
                if isinstance(items, list):
                    for it in items:
                        dst = str(it.get("destination", it.get("rfcdest", ""))).strip().upper()
                        if dst:
                            data.rfc_destinations.append(RFCDESEntry(**it))
            except Exception:
                pass

    def _populate_swwwihead(self, data: DecommissionNormalizedData, content: str):
        if content.strip().startswith("{") or content.strip().startswith("["):
            try:
                items = json.loads(content)
                if isinstance(items, list):
                    for it in items:
                        wid = str(it.get("wi_id", "")).strip()
                        if wid:
                            data.work_items.append(SWWWIHEADEntry(**it))
            except Exception:
                pass

    def _populate_audit(self, data: DecommissionNormalizedData, content: str):
        if content.strip().startswith("{") or content.strip().startswith("["):
            try:
                items = json.loads(content)
                if isinstance(items, list):
                    for it in items:
                        u = str(it.get("user", "")).strip().upper()
                        if u:
                            data.audit_logs.append(AuditLogEntry(**it))
            except Exception:
                pass

    # ==========================================================================
    # Main Engine Evaluation Pipeline (Point 4: Pure Rule Evaluation)
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        data, artifact_path, raw_text = self._parse_inputs(request)
        if not data.target_user:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "No decommissioning candidate supplied: provide 'target_user' (or bname/username).",
            )
        if not data.supplied_tables:
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "None of the required tables (USR02, TBTCO, RFCDES, SWWWIHEAD) were supplied; "
                "no decommissioning assessment can be made.",
            )
        target = data.target_user

        ref_date_str = (
            (request.configuration or {}).get("evaluation_date")
            or (request.configuration or {}).get("snapshot_date")
            or data.evaluation_date
        )
        if ref_date_str:
            try:
                ref_date = date.fromisoformat(str(ref_date_str)[:10])
            except Exception:
                ref_date = date.today()
        else:
            ref_date = date.today()

        # ----------------------------------------------------------------------
        # Rule 0: Verify Target User Existence in USR02
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        user_entry = data.users.get(target)
        if data.users and not user_entry:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, target)
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"target_user: {target}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"target_user: {target}",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_USER_NOT_FOUND",
                severity=Severity.CRITICAL,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Target User '{target}' Not Found in User Master Record (USR02)",
                description=(
                    f"The specified decommissioning candidate '{target}' does not exist in the provided "
                    "USR02 master user table. Decommissioning actions cannot be safely assessed without master data."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Verify the user ID spelling for '{target}'. Confirm that the complete USR02 export "
                    "for the relevant client was supplied to ERP Preflight."
                ),
                evidence=[ev],
                affected_objects=[target],
                technical_details={"target_user": target},
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 1: Scheduled Background Job Dependency (TBTCO)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        matching_jobs: List[TBTCOEntry] = []
        for job in data.jobs:
            is_exec = (job.exec_user and job.exec_user.upper() == target)
            is_sched = (job.scheduler and job.scheduler.upper() == target)
            is_active = (job.status.upper() in ACTIVE_JOB_STATUSES or job.periodic)
            if (is_exec or is_sched) and is_active:
                matching_jobs.append(job)

        if matching_jobs:
            has_periodic = any(j.periodic for j in matching_jobs)
            has_running = any(j.status.upper() in ("R", "RUNNING") for j in matching_jobs)
            sev = Severity.BLOCKER if (has_periodic or has_running) else Severity.CRITICAL

            job_names = sorted(list({j.job_name for j in matching_jobs}))
            first_job = job_names[0]
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_job)
            if line_no is None:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, target)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"job: {first_job}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Job '{first_job}' owned by user '{target}'",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_SCHEDULED_JOB_DEPENDENCY",
                severity=sev,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Active Scheduled Background Jobs Owned by User '{target}'",
                description=(
                    f"User '{target}' is configured as execution user (AUTHNAME) or scheduler (SDLUNAME) "
                    f"for {len(matching_jobs)} active or periodic background job(s) in table TBTCO. "
                    "Deactivating or locking this user will cause immediate job aborts with authorization failure."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Reassign job ownership before deactivating user account. In transaction SM36/SM37, "
                    f"change the execution user for jobs {job_names} to a dedicated technical service user "
                    "(e.g., 'BATCH_SVC')."
                ),
                evidence=[ev],
                affected_objects=[target] + job_names,
                technical_details={
                    "jobCount": len(matching_jobs),
                    "jobNames": job_names,
                    "hasPeriodicJobs": has_periodic,
                    "hasRunningJobs": has_running,
                },
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 2: Active RFC Destination Dependency (RFCDES)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        matching_rfcs: List[RFCDESEntry] = []
        for rfc in data.rfc_destinations:
            if rfc.username and rfc.username.upper() == target:
                matching_rfcs.append(rfc)

        if matching_rfcs:
            rfc_names = sorted(list({r.destination for r in matching_rfcs}))
            first_rfc = rfc_names[0]
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_rfc)
            if line_no is None:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, target)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"rfc: {first_rfc}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"RFC '{first_rfc}' configured with user '{target}'",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_ACTIVE_RFC_DEPENDENCY",
                severity=Severity.CRITICAL,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Active RFC Destination Dependency for User '{target}'",
                description=(
                    f"User '{target}' is configured as the logon user in {len(matching_rfcs)} RFC destination(s) "
                    f"in table RFCDES: {', '.join(rfc_names)}. "
                    "Locking or deleting this account will immediately terminate external interfaces and BAPI calls."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Update RFC destinations in transaction SM59. Assign dedicated communication service users "
                    f"with least-privilege authorizations to destinations: {rfc_names} before locking '{target}'."
                ),
                evidence=[ev],
                affected_objects=[target] + rfc_names,
                technical_details={
                    "rfcCount": len(matching_rfcs),
                    "rfcDestinations": [
                        {"destination": r.destination, "type": r.dest_type, "targetHost": r.target_host}
                        for r in matching_rfcs
                    ],
                },
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 3: Workflow Work Item Agent Dependency (SWWWIHEAD)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        matching_wf: List[SWWWIHEADEntry] = []
        for wi in data.work_items:
            is_agent = (wi.assigned_agent and wi.assigned_agent.upper() == target)
            is_actual = (wi.actual_agent and wi.actual_agent.upper() == target)
            is_pending = (wi.status.upper() in PENDING_WORK_ITEM_STATUSES)
            if (is_agent or is_actual) and is_pending:
                matching_wf.append(wi)

        if matching_wf:
            wi_ids = [w.wi_id for w in matching_wf]
            first_wi = wi_ids[0]
            line_no, col_no, snippet = _locate_line_in_text(raw_text, first_wi)
            if line_no is None:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, target)

            sev = Severity.CRITICAL if len(matching_wf) >= 5 else Severity.MAJOR
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"wi_id: {first_wi}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Work item '{first_wi}' assigned to '{target}'",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_WORKFLOW_AGENT_DEPENDENCY",
                severity=sev,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Pending Workflow Work Items Assigned to User '{target}'",
                description=(
                    f"User '{target}' is the assigned agent or current processor for {len(matching_wf)} pending "
                    f"workflow work item(s) in status READY/SELECTED/STARTED. Deactivating this user will cause "
                    "approval workflows to stall indefinitely with no active agent."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Forward or reassign pending workflow work items in transaction SWIA (Workflow Administration) "
                    f"or SBWP (Business Workplace). Reassign work item IDs {wi_ids[:10]} to an active deputy or role."
                ),
                evidence=[ev],
                affected_objects=[target] + wi_ids[:10],
                technical_details={
                    "pendingWorkItemsCount": len(matching_wf),
                    "workItems": [
                        {"wi_id": w.wi_id, "status": w.status, "task": w.task_id, "created": w.creation_date}
                        for w in matching_wf[:20]
                    ],
                },
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 4: Recent Usage Activity Detection (SM20 / ST03N / USR02.TRDAT)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        days_since_active = 999
        last_active_date: Optional[date] = None

        if user_entry and user_entry.last_logon_date:
            p_date = _parse_date(user_entry.last_logon_date)
            if p_date:
                last_active_date = p_date
                days_since_active = max(0, (ref_date - p_date).days)

        # Also inspect audit logs
        user_audit_entries = [a for a in data.audit_logs if a.user.upper() == target]
        if user_audit_entries:
            for entry in user_audit_entries:
                if entry.timestamp:
                    d_parsed = _parse_date(entry.timestamp[:10])
                    if d_parsed:
                        diff = max(0, (ref_date - d_parsed).days)
                        if diff < days_since_active:
                            days_since_active = diff
                            last_active_date = d_parsed

        if days_since_active <= data.grace_period_days:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, str(user_entry.last_logon_date if user_entry else target))
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"last_logon: {last_active_date}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"User '{target}' last active {days_since_active} days ago",
                provenance=ConfidenceClass.RULE_DERIVED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_RECENT_ACTIVITY_DETECTED",
                severity=Severity.MAJOR,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Recent Activity Detected for Decommission Candidate '{target}'",
                description=(
                    f"User '{target}' was active {days_since_active} day(s) ago (last recorded date: {last_active_date}). "
                    f"The configured decommission grace period is {data.grace_period_days} days. "
                    "Decommissioning an account with recent production usage indicates active human or interface reliance."
                ),
                confidence=ConfidenceClass.RULE_DERIVED,
                confidence_score=0.85,
                remediation=(
                    f"Place user account '{target}' into observation state (lock dialog logons via SU01) for 14-30 days "
                    "prior to permanent deletion or table archiving. Verify with business stakeholders."
                ),
                evidence=[ev],
                affected_objects=[target],
                technical_details={
                    "daysSinceLastActive": days_since_active,
                    "lastActiveDate": str(last_active_date) if last_active_date else None,
                    "gracePeriodDays": data.grace_period_days,
                },
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 5: Locked User Call Flood Risk (USR02.UFLAG != 0 & SM20 Activity)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        is_locked = user_entry and (user_entry.lock_status != 0)
        recent_failed_attempts = [
            a for a in user_audit_entries
            if not a.success or a.event_type.upper() in ("FAILED_LOGON", "AUTH_FAILURE")
        ]
        if is_locked and recent_failed_attempts:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, "FAILED_LOGON")
            if line_no is None:
                line_no, col_no, snippet = _locate_line_in_text(raw_text, target)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"locked_user_flood: {target}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"Locked user '{target}' receiving repeated failed logon attempts",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_LOCKED_USER_CALL_FLOOD",
                severity=Severity.CRITICAL,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Locked Technical User '{target}' Receiving Ongoing Authentication Traffic",
                description=(
                    f"User '{target}' is currently locked in USR02 (UFLAG={user_entry.lock_status}), but security audit "
                    f"logs reveal {len(recent_failed_attempts)} failed logon attempt(s) from external callers. "
                    "An external integration middleware is repeatedly attempting to connect with invalid credentials, "
                    "flooding SAP system logs and consuming gateway work processes."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Identify the calling external endpoint from SM20/SM21 system log terminal field. "
                    "Update credentials in the calling middleware or deactivate the remote caller interface."
                ),
                evidence=[ev],
                affected_objects=[target],
                technical_details={
                    "lockStatus": user_entry.lock_status,
                    "failedLogonCount": len(recent_failed_attempts),
                },
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 6: Safe Decommission Verdict
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        user_missing = not user_entry
        missing_tables = [t for t in REQUIRED_VERDICT_TABLES if t not in data.supplied_tables]
        has_blockers = bool(matching_jobs or matching_rfcs or matching_wf or user_missing)
        verdict_withheld = False
        if missing_tables and not (matching_jobs or matching_rfcs or matching_wf):
            # A positive verdict needs every required table; absent tables are not "zero dependencies".
            verdict_withheld = True
            f = Finding(
                rule_id="DECOM_INSUFFICIENT_INPUT",
                severity=Severity.INFO,
                category="DECOMMISSION_PREFLIGHT",
                title=f"Decommission Verdict Withheld for '{target}': Required Tables Missing",
                description=(
                    "A safe-to-decommission verdict requires USR02, TBTCO, RFCDES and SWWWIHEAD extracts. "
                    f"Missing: {', '.join(t.upper() for t in missing_tables)}."
                ),
                confidence=ConfidenceClass.UNKNOWN,
                confidence_score=0.30,
                remediation="Export the missing tables for the relevant client and re-run the preflight.",
                evidence=[],
                affected_objects=[target],
                technical_details={"missingTables": [t.upper() for t in missing_tables]},
            )
            findings.append(ConfidenceClassifier.classify(f))
        if not has_blockers and not missing_tables and days_since_active >= data.grace_period_days:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, target)
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or f"safe_decommission: {target}",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f"User '{target}' has no active dependencies",
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="DECOM_SAFE_FOR_ARCHIVING",
                severity=Severity.INFO,
                category="DECOMMISSION_PREFLIGHT",
                title=f"User '{target}' is Safe for Decommissioning and Archiving",
                description=(
                    f"Preflight evaluation confirmed zero active background jobs, zero RFC destinations, "
                    f"zero pending workflow work items, and no activity within the past {days_since_active} days. "
                    "The user account is safe to lock, deactivate, and archive."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Proceed with standard decommissioning runbook: lock user in SU01, set valid-to date to today, "
                    "remove active role assignments, and schedule table archiving via transaction SARA."
                ),
                evidence=[ev],
                affected_objects=[target],
                technical_details={"safeToDecommission": True, "daysSinceLastActive": days_since_active},
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Mathematical Decommission Risk Score Calculation (0.0 - 10.0)
        # ----------------------------------------------------------------------
        score = 0.0
        # Active Jobs: +3.0 base + 0.5 per job (cap +4.0)
        if matching_jobs:
            score += min(4.0, 3.0 + (len(matching_jobs) - 1) * 0.5)

        # RFC Destinations: +3.5 base + 0.5 per RFC (cap +4.5)
        if matching_rfcs:
            score += min(4.5, 3.5 + (len(matching_rfcs) - 1) * 0.5)

        # Workflow Items: +1.5 base + 0.3 per item (cap +3.0)
        if matching_wf:
            score += min(3.0, 1.5 + (len(matching_wf) - 1) * 0.3)

        # Activity decay:
        if days_since_active <= 7:
            score += 2.0
        elif days_since_active <= 30:
            score += 1.5
        elif days_since_active <= 90:
            score += 1.0

        # Locked user flood risk
        if is_locked and recent_failed_attempts:
            score += 2.5

        # Cap score
        decom_risk_score = round(min(10.0, score), 1)

        # ----------------------------------------------------------------------
        # Reassignment Action Checklist Generation
        # ----------------------------------------------------------------------
        reassignment_checklist: List[Dict[str, str]] = []
        if matching_jobs:
            reassignment_checklist.append({
                "step": "REASSIGN_BACKGROUND_JOBS",
                "transaction": "SM36 / SM37",
                "action": f"Reassign execution user of {len(matching_jobs)} job(s) ({', '.join(sorted(list({j.job_name for j in matching_jobs}))[:5])}) to dedicated technical user.",
            })
        if matching_rfcs:
            reassignment_checklist.append({
                "step": "UPDATE_RFC_DESTINATIONS",
                "transaction": "SM59",
                "action": f"Update credentials in {len(matching_rfcs)} destination(s) ({', '.join(sorted(list({r.destination for r in matching_rfcs}))[:5])}) to a secure service account.",
            })
        if matching_wf:
            reassignment_checklist.append({
                "step": "FORWARD_WORKFLOW_ITEMS",
                "transaction": "SWIA / SBWP",
                "action": f"Forward {len(matching_wf)} pending work item(s) to designated deputy or functional group.",
            })
        if is_locked and recent_failed_attempts:
            reassignment_checklist.append({
                "step": "RESOLVE_CALLER_FLOOD",
                "transaction": "SM21 / SM20",
                "action": "Inspect failed authentication source terminals and update credentials in external middleware.",
            })
        reassignment_checklist.append({
            "step": "LOCK_AND_EXPIRE_ACCOUNT",
            "transaction": "SU01",
            "action": f"Lock user '{target}' (UFLAG=64) and set Valid To date (GLTGB) to current date.",
        })

        execution_time_ms = int((time.perf_counter() - start_time) * 1000)

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.PARTIAL if verdict_withheld else AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=AnalysisMetrics(
                execution_time_ms=execution_time_ms,
                rules_evaluated=rules_evaluated,
                artifacts_scanned=1,
                additional_metrics={
                    "targetUser": target,
                    "suppliedTables": sorted(set(data.supplied_tables)),
                    "activeJobsCount": len(matching_jobs),
                    "activeRfcCount": len(matching_rfcs),
                    "pendingWorkItemsCount": len(matching_wf),
                    "daysSinceLastActive": days_since_active,
                    "decommissionRiskScore": decom_risk_score,
                    "reassignmentChecklist": reassignment_checklist,
                },
            ),
        )


# Backward-compatibility alias
SafeDecommissionEngine = DecommissionAuditEngine

__all__ = ["DecommissionAuditEngine", "SafeDecommissionEngine"]
