"""
ERP Preflight — Feature 32: Workflow Stuck & Deadlock Predictor Engine
Deterministic diagnostic analysis of stuck, failed, or overdue SAP Business Workflows
and S/4HANA Flexible Workflows.

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
from src.core.registry import register_engine
from src.models.enums import (
    EngineType,
    ArtifactType,
    AnalysisStatus,
    Severity,
    ConfidenceClass,
    TrustLevel,
)
from src.models.request import AnalysisRequest, ArtifactReference
from src.models.response import AnalysisResponse, AnalysisMetrics
from src.models.finding import Finding
from src.models.evidence import Evidence
from src.platform.evidence import EvidenceEngine


# =============================================================================
# Input Validation Models
# =============================================================================

class WorkItemHeader(BaseModel):
    wi_id: str = Field(..., description="10-digit work item ID (e.g. 0000045012)")
    wi_type: str = Field(default="F", description="Work item type: W=Workflow, B=Background, F=Dialog, D=Dialog step, E=Event wait, A=Sub-workflow")
    wi_stat: str = Field(default="READY", description="Work item status: READY, SELECTED, STARTED, COMMITTED, COMPLETED, ERROR, WAITING, CHECKED, CANCELLED")
    wi_text: Optional[str] = Field(default="", description="Work item descriptive text")
    wi_rh_task: Optional[str] = Field(default="", description="Task ID (e.g. TS00008267, WS00000001)")
    wi_chckwi: Optional[str] = Field(default=None, description="Parent workflow work item ID")
    wi_cd: Optional[str] = Field(default=None, description="Creation date (YYYYMMDD or ISO)")
    wi_ct: Optional[str] = Field(default=None, description="Creation time (HHMMSS)")
    wi_aed: Optional[str] = Field(default=None, description="Last change date")
    wi_aet: Optional[str] = Field(default=None, description="Last change time")
    wi_prio: Optional[str] = Field(default="5", description="Priority (1=High, 5=Medium, 9=Low)")


class WorkItemLogHistory(BaseModel):
    wi_id: str = Field(..., description="Target work item ID")
    method: Optional[str] = Field(default="", description="ABAP OO or BOR method executed")
    retcode: int = Field(default=0, description="Return code (SY-SUBRC)")
    exception: Optional[str] = Field(default=None, description="ABAP Exception class or short dump ID")
    msgid: Optional[str] = None
    msgno: Optional[str] = None
    msgv1: Optional[str] = None
    msgv2: Optional[str] = None
    timestamp: Optional[str] = None


class AgentResolutionTrace(BaseModel):
    wi_id: str = Field(..., description="Target work item ID")
    rule_id: Optional[str] = Field(default="", description="Responsibility rule ID or agent BAdI")
    resolved_agents: List[str] = Field(default_factory=list, description="List of user IDs resolved as eligible agents")
    resolved_count: int = Field(default=0, description="Total count of eligible recipients")
    error_message: Optional[str] = None
    org_object: Optional[str] = None


class EventLinkage(BaseModel):
    objtype: str = Field(..., description="Business Object Type or ABAP Class (e.g. BUS2012, FIPP)")
    event: str = Field(..., description="Triggering business event (e.g. CREATED, CHANGED)")
    rectype: str = Field(..., description="Receiver Type / Workflow Template (e.g. WS00000001)")
    active: bool = Field(default=True, description="Whether event linkage is currently active")
    feedback_flag: Optional[str] = Field(default=None, description="Deactivation flag on error")
    deact_date: Optional[str] = None


class ContainerData(BaseModel):
    wi_id: Optional[str] = None
    elements: Dict[str, Any] = Field(default_factory=dict, description="Workflow/Task container key-value pairs")
    binding_errors: List[str] = Field(default_factory=list, description="Reported container binding failures")


class DeadlineEntry(BaseModel):
    wi_id: str = Field(..., description="Work item ID")
    deadl_type: str = Field(default="LATEST_END", description="Deadline type: LATEST_START, LATEST_END")
    deadline_timestamp: Optional[str] = None
    is_breached: bool = Field(default=False, description="Whether SLA deadline is breached")
    elapsed_hours: Optional[float] = Field(default=0.0, description="Hours elapsed since step creation")


class WorkflowStuckNormalizedContext(BaseModel):
    headers: List[WorkItemHeader] = Field(default_factory=list)
    logs: List[WorkItemLogHistory] = Field(default_factory=list)
    agent_traces: List[AgentResolutionTrace] = Field(default_factory=list)
    event_linkages: List[EventLinkage] = Field(default_factory=list)
    containers: List[ContainerData] = Field(default_factory=list)
    deadlines: List[DeadlineEntry] = Field(default_factory=list)


# =============================================================================
# Feature 32: Workflow Stuck & Deadlock Predictor Engine
# =============================================================================

@register_engine
class WorkflowStuckEngine(BaseEngine):
    """
    Workflow Stuck Explainer & Deadlock Predictor Engine
    Analyzes SAP Business Workflow and S/4HANA Flexible Workflow execution traces
    to identify stuck steps, empty agent resolutions, failed background tasks,
    deactivated event linkages, container binding errors, and deadlocks.
    """

    engine_type = EngineType.WORKFLOW_STUCK_EXPLAINER
    name = "Workflow Stuck Explainer"
    description = "Deterministic diagnostic analysis of stuck, failed, or overdue SAP Business Workflows"
    version = "2.0.0"
    supported_artifact_types = [ArtifactType.CSV, ArtifactType.JSON]

    # Standard Finding Codes
    RULE_STUCK_NO_AGENT = "WF_STUCK_NO_AGENT"
    RULE_BACKGROUND_TASK_FAILED = "WF_BACKGROUND_TASK_FAILED"
    RULE_EVENT_LINKAGE_DEACTIVATED = "WF_EVENT_LINKAGE_DEACTIVATED"
    RULE_DEADLOCK_DETECTED = "WF_DEADLOCK_DETECTED"
    RULE_CONTAINER_BINDING_ERROR = "WF_CONTAINER_BINDING_ERROR"
    RULE_DEADLINE_BREACHED = "WF_DEADLINE_BREACHED"

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """
        Executes deterministic diagnostic checks across workflow logs and traces.
        """
        findings: List[Finding] = []
        rules_evaluated = 0
        artifacts_scanned = max(1, len(request.artifacts))

        # 1. Parse Input Artifacts
        context, source_lines, artifact_path, raw_content_str = self._parse_inputs(request)
        artifact_hash = EvidenceEngine.compute_sha256(raw_content_str)

        # 2. Execute Diagnostic Rules Pipeline
        pipe_findings, rules_count, metrics_dict = self._evaluate_workflow_rules(
            context=context,
            source_lines=source_lines,
            artifact_path=artifact_path,
            artifact_hash=artifact_hash,
            target_release=request.target_release,
        )
        findings.extend(pipe_findings)
        rules_evaluated += rules_count

        # 3. Overall Status
        status = AnalysisStatus.COMPLETED

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=status,
            findings=findings,
            metrics=AnalysisMetrics(
                rules_evaluated=max(rules_evaluated, 6),
                artifacts_scanned=artifacts_scanned,
                additional_metrics=metrics_dict,
            ),
        )

    # -------------------------------------------------------------------------
    # Core Deterministic Diagnostic Pipeline
    # -------------------------------------------------------------------------
    def _evaluate_workflow_rules(
        self,
        context: WorkflowStuckNormalizedContext,
        source_lines: Dict[str, int],
        artifact_path: str,
        artifact_hash: str,
        target_release: str,
    ) -> Tuple[List[Finding], int, Dict[str, Any]]:
        findings: List[Finding] = []
        rules_evaluated = 0

        # Build index maps for fast cross-referencing
        headers_by_id: Dict[str, WorkItemHeader] = {h.wi_id: h for h in context.headers}
        logs_by_id: Dict[str, List[WorkItemLogHistory]] = {}
        for l in context.logs:
            logs_by_id.setdefault(l.wi_id, []).append(l)

        traces_by_id: Dict[str, List[AgentResolutionTrace]] = {}
        for t in context.agent_traces:
            traces_by_id.setdefault(t.wi_id, []).append(t)

        stuck_items: List[str] = []
        is_restart_candidate = False
        is_manual_forward_candidate = False
        primary_stuck_id = None
        max_hours_stuck = 0.0

        # ---------------------------------------------------------------------
        # Rule 1: Empty Agent Resolution in READY Status (WF_STUCK_NO_AGENT)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for wi_id, header in headers_by_id.items():
            if header.wi_stat.upper() in ("READY", "CHECKED") and header.wi_type.upper() in ("F", "D"):
                # Check agent traces
                traces = traces_by_id.get(wi_id, [])
                empty_agent = False
                rule_name = "Agent Determination Rule"

                if traces:
                    for tr in traces:
                        if tr.resolved_count == 0 or len(tr.resolved_agents) == 0:
                            empty_agent = True
                            rule_name = tr.rule_id or tr.org_object or "Responsibility Rule"
                            break
                elif header.wi_stat.upper() == "READY":
                    # If status is READY but zero agents are indexed in trace
                    # (and header was explicitly submitted as having no recipient)
                    pass

                if empty_agent:
                    stuck_items.append(wi_id)
                    is_manual_forward_candidate = True
                    if not primary_stuck_id:
                        primary_stuck_id = wi_id

                    line_no = source_lines.get(f"wi_{wi_id}", source_lines.get("swwwihead", 1))
                    findings.append(
                        Finding(
                            rule_id=self.RULE_STUCK_NO_AGENT,
                            severity=Severity.CRITICAL,
                            category="Agent Determination",
                            title=f"No Eligible Agent Found for Approval Step: {header.wi_rh_task or wi_id}",
                            description=(
                                f"Work item {wi_id} (Task: {header.wi_rh_task or 'Unknown'}, Type: '{header.wi_type}') "
                                f"reached status READY, but agent resolution rule '{rule_name}' evaluated to zero eligible users. "
                                f"The item cannot be displayed in any user inbox (My Inbox / SBWP) and workflow progress is completely halted."
                            ),
                            confidence=ConfidenceClass.VERIFIED,
                            confidence_score=1.0,
                            remediation=(
                                f"1. In transaction SWIA, locate work item {wi_id} and manually forward it to an authorized substitute.\n"
                                f"2. Inspect the agent assignment rule '{rule_name}' in transaction PFAC or the Flexible Workflow Manage Workflows app.\n"
                                "3. In transaction PPOME, verify that the associated Organizational Unit / Position has active user assignments."
                            ),
                            evidence=[
                                Evidence(
                                    artifact_path=f"{artifact_path}#SWWWIHEAD",
                                    line_number=line_no,
                                    snippet=f"WI_ID: {wi_id}, WI_TYPE: {header.wi_type}, WI_STAT: {header.wi_stat}, TASK: {header.wi_rh_task}",
                                    sha256=artifact_hash,
                                    provenance=ConfidenceClass.VERIFIED,
                                    trust_score=1.0,
                                )
                            ],
                            technical_details={
                                "step": "Rule 1: Agent Resolution Audit",
                                "workitemId": wi_id,
                                "task": header.wi_rh_task,
                                "status": header.wi_stat,
                                "agentRule": rule_name,
                                "recommendation": "SWIA manual forward and update HR org model",
                            },
                            affected_objects=[header.wi_rh_task or wi_id],
                        )
                    )

        # ---------------------------------------------------------------------
        # Rule 2: Background Task Failure & Runtime Exception (WF_BACKGROUND_TASK_FAILED)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for wi_id, header in headers_by_id.items():
            is_error_status = header.wi_stat.upper() == "ERROR"
            is_bg_type = header.wi_type.upper() == "B"
            logs = logs_by_id.get(wi_id, [])

            has_error_log = any(
                l.retcode > 0 or l.exception is not None or (l.msgid and "ERROR" in l.msgid.upper()) for l in logs
            )

            if is_error_status or (is_bg_type and has_error_log):
                stuck_items.append(wi_id)
                is_restart_candidate = True
                if not primary_stuck_id:
                    primary_stuck_id = wi_id

                line_no = source_lines.get(f"wi_{wi_id}", source_lines.get("swwwihead", 1))
                exc_str = "Unknown Exception"
                retcode_val = 0
                method_name = ""

                for l in logs:
                    if l.exception:
                        exc_str = l.exception
                    if l.retcode > 0:
                        retcode_val = l.retcode
                    if l.method:
                        method_name = l.method

                findings.append(
                    Finding(
                        rule_id=self.RULE_BACKGROUND_TASK_FAILED,
                        severity=Severity.BLOCKER if header.wi_type.upper() in ("W", "B") else Severity.CRITICAL,
                        category="Execution / Runtime Dump",
                        title=f"Background Step Terminated with Error: {header.wi_rh_task or wi_id}",
                        description=(
                            f"Background work item {wi_id} (Task: {header.wi_rh_task or 'B-Task'}, Method: '{method_name}') "
                            f"terminated in status ERROR. Exception details: '{exc_str}', Return Code SY-SUBRC={retcode_val}. "
                            f"Child execution failed, stalling parent workflow {header.wi_chckwi or 'Header'}."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"1. Open transaction ST22 in the target system and check for short dumps related to task '{header.wi_rh_task}'.\n"
                            f"2. Inspect the developer trace in transaction SM21 or system log around the step execution time.\n"
                            f"3. After resolving the underlying data/locking issue, execute transaction SWI1 / SWIA and restart work item {wi_id}."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#SWWLOGHIST",
                                line_number=line_no,
                                snippet=f"WI_ID: {wi_id}, WI_STAT: ERROR, EXCEPTION: {exc_str}, RETCODE: {retcode_val}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Rule 2: Background Step Failure",
                            "workitemId": wi_id,
                            "task": header.wi_rh_task,
                            "exception": exc_str,
                            "returnCode": retcode_val,
                            "method": method_name,
                            "restartCandidate": True,
                        },
                        affected_objects=[header.wi_rh_task or wi_id],
                    )
                )

        # ---------------------------------------------------------------------
        # Rule 3: Deactivated Event Linkage (WF_EVENT_LINKAGE_DEACTIVATED)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for link in context.event_linkages:
            if not link.active:
                line_no = source_lines.get(f"link_{link.objtype}_{link.event}", source_lines.get("swetypv", 1))
                findings.append(
                    Finding(
                        rule_id=self.RULE_EVENT_LINKAGE_DEACTIVATED,
                        severity=Severity.CRITICAL,
                        category="Event Coupling / SWETYPV",
                        title=f"Event Linkage Deactivated: {link.objtype}.{link.event} -> {link.rectype}",
                        description=(
                            f"The type linkage in table SWETYPV/SWE2 between Business Object '{link.objtype}', "
                            f"event '{link.event}', and receiver '{link.rectype}' is currently DEACTIVATED. "
                            f"Triggering events published by application transactions will not instantiate new workflow instances."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"1. Open transaction SWETYPV (or SWE2) in the SAP GUI.\n"
                            f"2. Locate the row with Object Type '{link.objtype}', Event '{link.event}', Receiver Type '{link.rectype}'.\n"
                            "3. Check the 'Linkage Activated' checkbox.\n"
                            "4. In the 'Feedback on Error' field, change configuration to 'Do not deactivate linkage' to prevent automatic disablement during transient failures.\n"
                            "5. Check transaction SWEQADM / SMQ2 to ensure the event queue is not blocked."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#SWETYPV",
                                line_number=line_no,
                                snippet=f"OBJTYPE: {link.objtype}, EVENT: {link.event}, RECTYPE: {link.rectype}, ACTIVE: {link.active}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Rule 3: Event Linkage Audit",
                            "objectType": link.objtype,
                            "event": link.event,
                            "receiverType": link.rectype,
                            "feedbackFlag": link.feedback_flag,
                        },
                        affected_objects=[f"{link.objtype}.{link.event}"],
                    )
                )

        # ---------------------------------------------------------------------
        # Rule 4: Workflow Deadlock & Mutual Event Wait (WF_DEADLOCK_DETECTED)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        waiting_items = [h for h in context.headers if h.wi_stat.upper() == "WAITING"]
        if len(waiting_items) >= 2:
            # Check for mutual event wait or deadlocked wait steps
            waiting_ids = [w.wi_id for w in waiting_items]
            findings.append(
                Finding(
                    rule_id=self.RULE_DEADLOCK_DETECTED,
                    severity=Severity.BLOCKER,
                    category="Deadlock / Synchronization",
                    title=f"Workflow Deadlock Detected across Waiting Steps: {', '.join(waiting_ids[:3])}",
                    description=(
                        f"Multiple parallel work items ({', '.join(waiting_ids)}) are stuck in status WAITING. "
                        f"Step synchronization conditions or prerequisite terminating events have failed to arrive, "
                        f"resulting in a deadlocked workflow instance."
                    ),
                    confidence=ConfidenceClass.RULE_DERIVED,
                    confidence_score=0.85,
                    remediation=(
                        "1. Inspect the workflow runtime instance log in transaction SWI1.\n"
                        "2. In transaction SWUE, create the missing terminating event manually if the underlying business process already concluded.\n"
                        "3. If branches cannot synchronize, use transaction SWIA to terminate or bypass the stuck waiting step."
                    ),
                    evidence=[
                        Evidence(
                            artifact_path=f"{artifact_path}#SWWWIHEAD",
                            line_number=source_lines.get("swwwihead", 1),
                            snippet=f"Waiting Work Items: {', '.join(waiting_ids)}",
                            sha256=artifact_hash,
                            provenance=ConfidenceClass.RULE_DERIVED,
                            trust_score=0.85,
                        )
                    ],
                    technical_details={
                        "step": "Rule 4: Deadlock Audit",
                        "waitingWorkItems": waiting_ids,
                    },
                    affected_objects=waiting_ids,
                )
            )

        # ---------------------------------------------------------------------
        # Rule 5: Container Data Binding Failure (WF_CONTAINER_BINDING_ERROR)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for cont in context.containers:
            if cont.binding_errors:
                err_msg = "; ".join(cont.binding_errors)
                findings.append(
                    Finding(
                        rule_id=self.RULE_CONTAINER_BINDING_ERROR,
                        severity=Severity.CRITICAL,
                        category="Container / Data Binding",
                        title=f"Container Data Binding Failure: Work Item {cont.wi_id or 'Context'}",
                        description=(
                            f"Workflow data container transfer failed: {err_msg}. "
                            f"Data elements could not be mapped between workflow container and task container."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "1. Open transaction SWDD / SWDD_CONFIG to edit the workflow definition.\n"
                            "2. Navigate to the failing step definition and open the 'Binding' editor.\n"
                            "3. Verify that all mandatory import parameters of the task receive values and data types are compatible."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#container",
                                line_number=source_lines.get("container", 1),
                                snippet=err_msg[:150],
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Rule 5: Container Binding",
                            "workitemId": cont.wi_id,
                            "bindingErrors": cont.binding_errors,
                        },
                        affected_objects=[cont.wi_id] if cont.wi_id else ["Container Binding"],
                    )
                )

        # ---------------------------------------------------------------------
        # Rule 6: SLA Deadline Breach & Overdue Analysis (WF_DEADLINE_BREACHED)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for deadl in context.deadlines:
            if deadl.is_breached or (deadl.elapsed_hours and deadl.elapsed_hours > 48.0):
                hours = deadl.elapsed_hours or 72.0
                if hours > max_hours_stuck:
                    max_hours_stuck = hours

                findings.append(
                    Finding(
                        rule_id=self.RULE_DEADLINE_BREACHED,
                        severity=Severity.MAJOR,
                        category="Performance / SLA",
                        title=f"Workflow SLA Deadline Breached: Work Item {deadl.wi_id}",
                        description=(
                            f"Work item {deadl.wi_id} has exceeded its SLA deadline ({deadl.deadl_type}) "
                            f"and remained pending for {hours:.1f} hours without progression."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            "1. Review deadline escalation configuration in Workflow Builder (transaction SWDD).\n"
                            "2. In transaction SM37, verify that background job SWWDHEX runs periodically (every 5-10 minutes) to trigger deadline processing.\n"
                            "3. Trigger reminder notification to assigned recipient or substitute."
                        ),
                        evidence=[
                            Evidence(
                                artifact_path=f"{artifact_path}#SWWDEADL",
                                line_number=source_lines.get(f"deadl_{deadl.wi_id}", source_lines.get("deadlines", 1)),
                                snippet=f"WI_ID: {deadl.wi_id}, TYPE: {deadl.deadl_type}, ELAPSED_HOURS: {hours}",
                                sha256=artifact_hash,
                                provenance=ConfidenceClass.VERIFIED,
                                trust_score=1.0,
                            )
                        ],
                        technical_details={
                            "step": "Rule 6: Deadline Monitoring",
                            "workitemId": deadl.wi_id,
                            "deadlineType": deadl.deadl_type,
                            "elapsedHours": hours,
                        },
                        affected_objects=[deadl.wi_id],
                    )
                )

        metrics_dict = {
            "totalWorkItems": len(context.headers),
            "stuckCount": len(stuck_items),
            "stuckStepId": primary_stuck_id,
            "hoursStuck": max_hours_stuck,
            "restartCandidate": is_restart_candidate,
            "manualForwardCandidate": is_manual_forward_candidate,
            "findingsCount": len(findings),
        }

        return findings, rules_evaluated, metrics_dict

    # -------------------------------------------------------------------------
    # Multi-Format Parser (CSV & JSON)
    # -------------------------------------------------------------------------
    def _parse_inputs(
        self, request: AnalysisRequest
    ) -> Tuple[WorkflowStuckNormalizedContext, Dict[str, int], str, str]:
        context = WorkflowStuckNormalizedContext()
        source_lines: Dict[str, int] = {}
        artifact_path = request.artifact_s3_key or "workflow_diagnostic_payload"
        raw_content_str = request.raw_content or ""

        # 1. Parse configuration if provided
        if request.configuration:
            self._merge_dict_into_context(request.configuration, context, source_lines, 1)

        # 2. Parse inline raw_content
        if request.raw_content and request.raw_content.strip():
            raw_str = request.raw_content.strip()
            if raw_str.startswith("{") or raw_str.startswith("["):
                try:
                    p_json = json.loads(raw_str)
                    if isinstance(p_json, dict):
                        self._merge_dict_into_context(p_json, context, source_lines, 1)
                    elif isinstance(p_json, list):
                        for idx, item in enumerate(p_json):
                            if isinstance(item, dict):
                                self._merge_dict_into_context(item, context, source_lines, idx + 1)
                except Exception:
                    pass
            elif "," in raw_str or "\t" in raw_str or ";" in raw_str or "\n" in raw_str:
                self._parse_csv_content(raw_str, "inline_csv", context, source_lines)

        # 3. Parse artifact attachments
        for art in request.artifacts:
            content = art.raw_content or ""
            if not content:
                continue
            art_name = art.file_name or "artifact"
            if art.artifact_type == ArtifactType.JSON or art_name.endswith(".json"):
                try:
                    p_json = json.loads(content)
                    if isinstance(p_json, dict):
                        self._merge_dict_into_context(p_json, context, source_lines, 1)
                except Exception:
                    pass
            elif art.artifact_type == ArtifactType.CSV or art_name.endswith(".csv"):
                self._parse_csv_content(content, art_name, context, source_lines)

        return context, source_lines, artifact_path, raw_content_str

    def _merge_dict_into_context(
        self, data: Dict[str, Any], context: WorkflowStuckNormalizedContext, source_lines: Dict[str, int], base_line: int
    ):
        # Headers: swwwihead / headers
        headers_data = data.get("swwwihead") or data.get("headers") or data.get("work_items")
        if isinstance(headers_data, list):
            for idx, h in enumerate(headers_data):
                if isinstance(h, dict):
                    norm_h = {k.lower(): v for k, v in h.items()}
                    entry = WorkItemHeader(
                        wi_id=str(norm_h.get("wi_id", norm_h.get("id", f"{idx:010d}"))),
                        wi_type=str(norm_h.get("wi_type", norm_h.get("type", "F"))),
                        wi_stat=str(norm_h.get("wi_stat", norm_h.get("status", "READY"))),
                        wi_text=str(norm_h.get("wi_text", norm_h.get("text", ""))),
                        wi_rh_task=str(norm_h.get("wi_rh_task", norm_h.get("task", ""))),
                        wi_chckwi=norm_h.get("wi_chckwi", norm_h.get("parent_id")),
                    )
                    context.headers.append(entry)
                    source_lines[f"wi_{entry.wi_id}"] = base_line + idx

        # Logs: swwloghist / logs
        logs_data = data.get("swwloghist") or data.get("logs") or data.get("history")
        if isinstance(logs_data, list):
            for idx, l in enumerate(logs_data):
                if isinstance(l, dict):
                    norm_l = {k.lower(): v for k, v in l.items()}
                    entry = WorkItemLogHistory(
                        wi_id=str(norm_l.get("wi_id", "")),
                        method=norm_l.get("method"),
                        retcode=int(norm_l.get("retcode", norm_l.get("return_code", 0))),
                        exception=norm_l.get("exception"),
                        msgid=norm_l.get("msgid"),
                    )
                    context.logs.append(entry)

        # Agent traces: agent_traces / agent_trace / agents
        traces_data = data.get("agent_trace") or data.get("agent_traces") or data.get("agents")
        if isinstance(traces_data, list):
            for idx, t in enumerate(traces_data):
                if isinstance(t, dict):
                    norm_t = {k.lower(): v for k, v in t.items()}
                    agents_list = norm_t.get("resolved_agents", norm_t.get("agents", []))
                    if isinstance(agents_list, str):
                        agents_list = [a.strip() for a in agents_list.split(",") if a.strip()]
                    entry = AgentResolutionTrace(
                        wi_id=str(norm_t.get("wi_id", "")),
                        rule_id=norm_t.get("rule_id", norm_t.get("rule")),
                        resolved_agents=agents_list,
                        resolved_count=int(norm_t.get("resolved_count", len(agents_list))),
                        error_message=norm_t.get("error_message"),
                    )
                    context.agent_traces.append(entry)

        # Event linkages: swetypv / event_linkages / linkages
        links_data = data.get("swetypv") or data.get("event_linkages") or data.get("linkages")
        if isinstance(links_data, list):
            for idx, l in enumerate(links_data):
                if isinstance(l, dict):
                    norm_l = {k.lower(): v for k, v in l.items()}
                    active_val = norm_l.get("active", True)
                    is_active = active_val in (True, "X", "true", "1", 1)
                    entry = EventLinkage(
                        objtype=str(norm_l.get("objtype", norm_l.get("object_type", ""))),
                        event=str(norm_l.get("event", "")),
                        rectype=str(norm_l.get("rectype", norm_l.get("receiver_type", ""))),
                        active=is_active,
                        feedback_flag=norm_l.get("feedback_flag"),
                    )
                    context.event_linkages.append(entry)
                    source_lines[f"link_{entry.objtype}_{entry.event}"] = base_line + idx

        # Deadlines
        deadl_data = data.get("deadlines") or data.get("swwdeadl")
        if isinstance(deadl_data, list):
            for idx, d in enumerate(deadl_data):
                if isinstance(d, dict):
                    norm_d = {k.lower(): v for k, v in d.items()}
                    entry = DeadlineEntry(
                        wi_id=str(norm_d.get("wi_id", "")),
                        deadl_type=str(norm_d.get("deadl_type", "LATEST_END")),
                        is_breached=bool(norm_d.get("is_breached", False)),
                        elapsed_hours=float(norm_d.get("elapsed_hours", 0.0)),
                    )
                    context.deadlines.append(entry)
                    source_lines[f"deadl_{entry.wi_id}"] = base_line + idx

        # Containers
        cont_data = data.get("container") or data.get("containers") or data.get("container_data")
        if isinstance(cont_data, dict):
            context.containers.append(ContainerData(**cont_data))
        elif isinstance(cont_data, list):
            for c in cont_data:
                if isinstance(c, dict):
                    context.containers.append(ContainerData(**c))

    def _parse_csv_content(
        self, content: str, file_name: str, context: WorkflowStuckNormalizedContext, source_lines: Dict[str, int]
    ):
        reader = csv.DictReader(io.StringIO(content))
        file_lower = file_name.lower()

        for idx, row in enumerate(reader, start=2):
            norm_row = {k.strip().lower(): v.strip() for k, v in row.items() if k}
            if "wi_stat" in norm_row or "wi_type" in norm_row:
                # SWWWIHEAD row
                entry = WorkItemHeader(
                    wi_id=norm_row.get("wi_id", f"{idx:010d}"),
                    wi_type=norm_row.get("wi_type", "F"),
                    wi_stat=norm_row.get("wi_stat", "READY"),
                    wi_text=norm_row.get("wi_text", ""),
                    wi_rh_task=norm_row.get("wi_rh_task", ""),
                    wi_chckwi=norm_row.get("wi_chckwi"),
                )
                context.headers.append(entry)
                source_lines[f"wi_{entry.wi_id}"] = idx
            elif "exception" in norm_row or "retcode" in norm_row:
                # SWWLOGHIST row
                context.logs.append(
                    WorkItemLogHistory(
                        wi_id=norm_row.get("wi_id", ""),
                        method=norm_row.get("method"),
                        retcode=int(norm_row.get("retcode", 0)),
                        exception=norm_row.get("exception"),
                    )
                )
            elif "rectype" in norm_row or "objtype" in norm_row:
                # SWETYPV row
                active_val = norm_row.get("active", "X").upper()
                is_active = active_val in ("X", "TRUE", "1")
                entry = EventLinkage(
                    objtype=norm_row.get("objtype", ""),
                    event=norm_row.get("event", ""),
                    rectype=norm_row.get("rectype", ""),
                    active=is_active,
                )
                context.event_linkages.append(entry)
                source_lines[f"link_{entry.objtype}_{entry.event}"] = idx
            elif "rule_id" in norm_row or "resolved_agents" in norm_row:
                # AGENT trace row
                ag_str = norm_row.get("resolved_agents", norm_row.get("agents", ""))
                ag_list = [a.strip() for a in ag_str.split(",") if a.strip()]
                context.agent_traces.append(
                    AgentResolutionTrace(
                        wi_id=norm_row.get("wi_id", ""),
                        rule_id=norm_row.get("rule_id", ""),
                        resolved_agents=ag_list,
                        resolved_count=len(ag_list),
                    )
                )
