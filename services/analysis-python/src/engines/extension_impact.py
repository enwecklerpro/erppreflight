"""Extension Impact Guard Engine.

Authoritative preflight calculation of blast radius, consumer dependency traversal,
directed cycle detection, and safe-to-delete verification for SAP custom extensions.
Implements the 14-point engine anatomy mandated by Cardinal Axiom 2.
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from collections import deque
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field, model_validator

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
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine


class ExtensionObjectType(str, Enum):
    CUSTOM_FIELD = "CUSTOM_FIELD"
    CDS_VIEW = "CDS_VIEW"
    BADI = "BADI"
    FORM_TEMPLATE = "FORM_TEMPLATE"
    CUSTOM_API = "CUSTOM_API"
    APP_VARIANT = "APP_VARIANT"
    SOFTWARE_COLLECTION = "SOFTWARE_COLLECTION"
    UNKNOWN = "UNKNOWN"


class ExtensionItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = ""
    type: ExtensionObjectType = Field(default=ExtensionObjectType.UNKNOWN)
    name: Optional[str] = None
    status: str = Field(default="ACTIVE")  # ACTIVE, INACTIVE, DRAFT
    package: Optional[str] = None
    dependencies: List[str] = Field(default_factory=list)
    is_analytical_query: bool = False
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            obj_id = data.get("id") or data.get("object_name") or data.get("name") or "UNKNOWN"
            data["id"] = obj_id
            if not data.get("name"):
                data["name"] = data.get("object_name") or obj_id
            raw_type = data.get("type") or data.get("object_type") or "UNKNOWN"
            if str(raw_type).upper() in ("ODATA_API", "API", "ODATA"):
                raw_type = "CUSTOM_API"
            try:
                data["type"] = ExtensionObjectType(raw_type)
            except ValueError:
                data["type"] = ExtensionObjectType.UNKNOWN
        return data


# Criticality weights for blast radius calculation (Max 100.0)
CATEGORY_WEIGHTS: Dict[ExtensionObjectType, float] = {
    ExtensionObjectType.FORM_TEMPLATE: 25.0,
    ExtensionObjectType.CUSTOM_API: 25.0,
    ExtensionObjectType.CDS_VIEW: 15.0,  # Elevated to 20.0 if analytical query
    ExtensionObjectType.BADI: 20.0,
    ExtensionObjectType.APP_VARIANT: 10.0,
    ExtensionObjectType.SOFTWARE_COLLECTION: 15.0,
    ExtensionObjectType.CUSTOM_FIELD: 15.0,
    ExtensionObjectType.UNKNOWN: 10.0,
}

DEPTH_ATTENUATION_FACTOR = 0.85


def _locate_line_in_text(raw_text: str, token: str) -> Tuple[int, int, str]:
    """Deterministically identifies the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return 1, 1, ""
    lines = raw_text.splitlines()
    for idx, line in enumerate(lines, 1):
        pos = line.find(token)
        if pos != -1:
            return idx, pos + 1, line.strip()
    return 1, 1, lines[0].strip() if lines else ""


def _infer_extension_type(object_id: str) -> ExtensionObjectType:
    """Infers extension category from standard SAP naming conventions."""
    clean = object_id.upper()
    if clean.startswith("FORM_") or "FORM" in clean or clean.endswith(".XDP"):
        return ExtensionObjectType.FORM_TEMPLATE
    if clean.startswith("API_") or "API_" in clean or "SRV" in clean or "ODATA" in clean:
        return ExtensionObjectType.CUSTOM_API
    if clean.startswith("CDS_") or "CDS" in clean or clean.startswith("I_") or clean.startswith("C_") or clean.startswith("ZCDS"):
        return ExtensionObjectType.CDS_VIEW
    if clean.startswith("BADI_") or "BADI" in clean:
        return ExtensionObjectType.BADI
    if clean.startswith("APP_") or "VARIANT" in clean:
        return ExtensionObjectType.APP_VARIANT
    if clean.startswith("YY1_") or clean.startswith("ZZ1_"):
        return ExtensionObjectType.CUSTOM_FIELD
    return ExtensionObjectType.UNKNOWN


@register_engine
class ExtensionImpactEngine(BaseEngine):
    """Engine calculating extension dependency blast radius, cycles, and deletion gates."""

    engine_type = EngineType.EXTENSION_IMPACT_GUARD
    name = "Extension Impact Guard"
    description = "Cloud BAdI, key-user extensibility, and upgrade stability analyzer"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.ABAP, ArtifactType.XML]

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "extension_impact/extension_graph.json"

        # Parse payload from raw_content or configuration
        payload: Dict[str, Any] = {}
        if raw_text:
            try:
                payload = json.loads(raw_text)
            except Exception:
                payload = request.configuration or {}
        else:
            payload = request.configuration or {}

        # Extract target object and action
        target_object = payload.get("target_object") or request.configuration.get("target_object")
        action = (payload.get("action") or request.configuration.get("action") or "DELETE").upper()

        # Build Graph Data Structures:
        # forward_consumers: u -> set of nodes that consume u (v consumes u if v depends on u)
        # dependencies_of: v -> set of nodes that v depends on
        forward_consumers: Dict[str, Set[str]] = {}
        dependencies_of: Dict[str, Set[str]] = {}
        extension_items: Dict[str, ExtensionItem] = {}

        # 1. Parse manifest list format if provided: "extensions": [...]
        if "extensions" in payload and isinstance(payload["extensions"], list):
            for ext_data in payload["extensions"]:
                item = ExtensionItem.model_validate(ext_data) if isinstance(ext_data, dict) else ext_data
                extension_items[item.id] = item
                forward_consumers.setdefault(item.id, set())
                dependencies_of.setdefault(item.id, set()).update(item.dependencies)
                for dep in item.dependencies:
                    forward_consumers.setdefault(dep, set()).add(item.id)

        # 2. Parse graph map format if provided: "dependencies": { ... }, "graph": { ... } OR top-level dict
        raw_graph = None
        if isinstance(payload.get("dependencies"), dict):
            raw_graph = payload["dependencies"]
        elif isinstance(payload.get("graph"), dict):
            raw_graph = payload["graph"]
        elif isinstance(payload, dict):
            raw_graph = payload

        if isinstance(raw_graph, dict):
            for src_node, targets in raw_graph.items():
                if src_node in ("target_object", "action", "extensions", "project_id", "dependencies", "graph"):
                    continue
                forward_consumers.setdefault(src_node, set())
                dependencies_of.setdefault(src_node, set())
                if isinstance(targets, list):
                    target_list = [str(t) for t in targets]
                    # In fixture: {"YY1_FIELD": ["CDS_VIEW", "FORM"]} means CDS_VIEW and FORM consume YY1_FIELD
                    forward_consumers.setdefault(src_node, set()).update(target_list)
                    for tgt in target_list:
                        dependencies_of.setdefault(tgt, set()).add(src_node)
                        forward_consumers.setdefault(tgt, set())

        # If target_object is not explicitly specified, choose the first root node or first item
        all_nodes = set(forward_consumers.keys()).union(dependencies_of.keys())
        if not target_object and all_nodes:
            # Prefer a node that has consumers or is a custom field
            cf_nodes = [n for n in all_nodes if n.startswith("YY1_") or n.startswith("ZZ1_")]
            target_object = cf_nodes[0] if cf_nodes else sorted(list(all_nodes))[0]

        # ----------------------------------------------------------------------
        # Rule 1: Target Object Existence Validation
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        if not target_object or target_object not in all_nodes:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, str(target_object))
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or str(target_object),
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f'"{target_object}"',
                provenance=ConfidenceClass.UNKNOWN,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="EXT_TARGET_OBJECT_NOT_FOUND",
                severity=Severity.MAJOR,
                category="GRAPH_INTEGRITY",
                title=f"Target Extension Object '{target_object}' Not Found in Graph",
                description=(
                    f"The specified target extension object '{target_object}' does not exist in the "
                    "provided dependency graph. Unable to traverse impact lineage."
                ),
                confidence=ConfidenceClass.UNKNOWN,
                confidence_score=0.30,
                remediation="Ensure the target object is defined as a node in the uploaded dependency manifest.",
                evidence=[ev],
                technical_details={"target_object": target_object, "available_nodes": sorted(list(all_nodes))},
                affected_objects=[str(target_object)] if target_object else [],
            )
            findings.append(ConfidenceClassifier.classify(f))

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
                ),
            )

        # ----------------------------------------------------------------------
        # Rule 2: Directed Cycle Detection (DFS 3-color algorithm)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        cycles_detected: List[List[str]] = []
        color: Dict[str, int] = {node: 0 for node in all_nodes}  # 0=WHITE, 1=GRAY, 2=BLACK
        parent_map: Dict[str, str] = {}

        def dfs_cycle(u: str, path: List[str]):
            color[u] = 1  # GRAY
            path.append(u)
            for v in forward_consumers.get(u, set()):
                if color.get(v, 0) == 1:  # Cycle detected
                    cycle_start_idx = path.index(v)
                    cycle_path = path[cycle_start_idx:] + [v]
                    cycles_detected.append(cycle_path)
                elif color.get(v, 0) == 0:
                    dfs_cycle(v, path)
            path.pop()
            color[u] = 2  # BLACK

        for node in sorted(list(all_nodes)):
            if color[node] == 0:
                dfs_cycle(node, [])

        if cycles_detected:
            # Emit finding for detected cycle
            cycle_example = cycles_detected[0]
            cycle_str = " -> ".join(cycle_example)
            line_no, col_no, snippet = _locate_line_in_text(raw_text, cycle_example[0])
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or cycle_str,
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f'"{cycle_example[0]}"',
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="EXT_CYCLIC_DEPENDENCY_DETECTED",
                severity=Severity.BLOCKER,
                category="GRAPH_INTEGRITY",
                title=f"Cyclic Extension Dependency Detected: {cycle_str}",
                description=(
                    f"A directed dependency cycle was detected involving {len(cycle_example)-1} extension objects: "
                    f"{cycle_str}. Cyclic dependencies cause activation deadlocks and block software collection exports."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Refactor the cyclical references into independent interface CDS views or extract shared "
                    "dimensions into separate software collection packages."
                ),
                evidence=[ev],
                technical_details={"cycle_path": cycle_example, "total_cycles": len(cycles_detected)},
                affected_objects=cycle_example[:-1],
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 3: Traversal of Direct and Transitive Consumers
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        direct_consumers = sorted(list(forward_consumers.get(target_object, set())))

        # BFS for transitive closure and depth calculation
        visited: Set[str] = set()
        consumer_depths: Dict[str, int] = {}
        queue: deque[Tuple[str, int]] = deque((c, 1) for c in direct_consumers)

        while queue:
            current, depth = queue.popleft()
            if current in visited or current == target_object:
                continue
            visited.add(current)
            consumer_depths[current] = depth

            for next_node in forward_consumers.get(current, set()):
                if next_node not in visited and next_node != target_object:
                    queue.append((next_node, depth + 1))

        transitive_consumers = sorted(list(visited))

        # Categorize consumers by type and status
        active_consumers_count = 0
        consumer_type_counts: Dict[str, int] = {}
        raw_score = 0.0

        for c_id in transitive_consumers:
            item = extension_items.get(c_id)
            if item:
                c_type = item.type
                is_active = item.status.upper() == "ACTIVE"
                is_query = item.is_analytical_query
            else:
                c_type = _infer_extension_type(c_id)
                is_active = True
                is_query = False

            if is_active:
                active_consumers_count += 1

            type_name = c_type.value
            consumer_type_counts[type_name] = consumer_type_counts.get(type_name, 0) + 1

            # Weight calculation
            base_weight = CATEGORY_WEIGHTS.get(c_type, 10.0)
            if is_query and c_type == ExtensionObjectType.CDS_VIEW:
                base_weight = 20.0

            status_multiplier = 1.0 if is_active else 0.25
            depth = consumer_depths.get(c_id, 1)
            raw_score += base_weight * status_multiplier * (DEPTH_ATTENUATION_FACTOR ** depth)

        blast_radius_score = min(100.0, round(raw_score, 1))

        # ----------------------------------------------------------------------
        # Rule 4: Safe-to-Delete Action Evaluation
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        is_safe_to_delete = active_consumers_count == 0

        line_no, col_no, snippet = _locate_line_in_text(raw_text, target_object)
        ev_target = EvidenceEngine.create_evidence(
            artifact_path=artifact_path,
            content=raw_text or target_object,
            line_number=line_no,
            column_number=col_no,
            snippet=snippet or f'"{target_object}"',
            provenance=ConfidenceClass.VERIFIED,
            source_type=TrustLevel.CUSTOMER_EVIDENCE,
        )

        if action == "DELETE":
            if not is_safe_to_delete:
                rules_evaluated += 1
                f = Finding(
                    rule_id="EXT_DELETE_BLOCKED_ACTIVE_CONSUMERS",
                    severity=Severity.CRITICAL,
                    category="DELETION_SAFETY",
                    title=f"Cannot Delete '{target_object}': {active_consumers_count} Active Consumer(s) Exist",
                    description=(
                        f"Target extension object '{target_object}' is actively consumed by "
                        f"{len(direct_consumers)} direct consumer(s) and {len(transitive_consumers)} transitive consumer(s). "
                        "Deleting this object will cause fatal compilation and runtime failures in downstream applications."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation=(
                        f"Decommission or re-point all {active_consumers_count} active consumers before deleting '{target_object}'. "
                        "Inspect downstream Form Templates, CDS Analytical Queries, and APIs."
                    ),
                    evidence=[ev_target],
                    technical_details={
                        "target_object": target_object,
                        "direct_consumers": direct_consumers,
                        "transitive_consumers": transitive_consumers,
                        "active_consumers_count": active_consumers_count,
                        "consumer_type_counts": consumer_type_counts,
                        "blast_radius_score": blast_radius_score,
                    },
                    affected_objects=[target_object] + direct_consumers,
                )
                findings.append(ConfidenceClassifier.classify(f))
            else:
                rules_evaluated += 1
                f = Finding(
                    rule_id="EXT_SAFE_TO_DELETE",
                    severity=Severity.INFO,
                    category="DELETION_SAFETY",
                    title=f"Extension '{target_object}' Safe to Delete",
                    description=(
                        f"Extension object '{target_object}' has zero active consumers in the analyzed dependency graph. "
                        "It is safe to decommission or remove from the software collection."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation="Proceed with deletion in Key-User Extensibility or transport removal.",
                    evidence=[ev_target],
                    technical_details={
                        "target_object": target_object,
                        "safe_to_delete": True,
                        "blast_radius_score": 0.0,
                    },
                    affected_objects=[target_object],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 5: High Blast Radius Warning
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        if blast_radius_score >= 50.0:
            f = Finding(
                rule_id="EXT_HIGH_BLAST_RADIUS_WARNING",
                severity=Severity.MAJOR,
                category="CHANGE_IMPACT",
                title=f"High Impact Blast Radius ({blast_radius_score}/100) for '{target_object}'",
                description=(
                    f"Modifying '{target_object}' carries an elevated blast radius score of {blast_radius_score}/100. "
                    f"A total of {len(transitive_consumers)} downstream artifact(s) are dependent on this extension."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Implement regression testing across all impacted Form Templates, CDS Views, and API contracts. "
                    "Ensure stage gate sign-off prior to production deployment."
                ),
                evidence=[ev_target],
                technical_details={
                    "target_object": target_object,
                    "blast_radius_score": blast_radius_score,
                    "consumer_type_counts": consumer_type_counts,
                },
                affected_objects=[target_object] + direct_consumers[:5],
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 6: Modification Breaking Consumer Warning
        # ----------------------------------------------------------------------
        if action == "MODIFY":
            rules_evaluated += 1
            if len(transitive_consumers) > 0:
                f = Finding(
                    rule_id="EXT_MODIFICATION_BREAKING_CONSUMERS",
                    severity=Severity.MAJOR,
                    category="CHANGE_IMPACT",
                    title=f"Modification Affects {len(transitive_consumers)} Downstream Consumer(s)",
                    description=(
                        f"Modifications to '{target_object}' will impact {len(direct_consumers)} direct and "
                        f"{len(transitive_consumers)} transitive consumers. Type changes or field removals will break contracts."
                    ),
                    confidence=ConfidenceClass.VERIFIED,
                    confidence_score=1.0,
                    remediation="Audit downstream consumer field mappings and run automated regression tests.",
                    evidence=[ev_target],
                    technical_details={
                        "target_object": target_object,
                        "direct_consumers": direct_consumers,
                        "transitive_consumers": transitive_consumers,
                    },
                    affected_objects=[target_object] + direct_consumers,
                )
                findings.append(ConfidenceClassifier.classify(f))

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
                    "target_object": target_object,
                    "direct_consumers_count": len(direct_consumers),
                    "transitive_consumers_count": len(transitive_consumers),
                    "active_consumers_count": active_consumers_count,
                    "blast_radius_score": blast_radius_score,
                    "safe_to_delete": is_safe_to_delete,
                    "cycles_count": len(cycles_detected),
                },
            ),
        )
