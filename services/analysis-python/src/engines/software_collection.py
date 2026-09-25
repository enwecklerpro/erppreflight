"""Software Collection Dependency Guard Engine.

Authoritative preflight evaluation of SAP S/4HANA Cloud Key-User Software Collections
prior to export and import. Validates dependencies, detects cross-collection cycles,
flags draft items, identifies dangling field references, and calculates the optimal
deterministic topological import sequence.
Implements the 14-point engine anatomy mandated by Cardinal Axiom 2.
"""

from __future__ import annotations

import io
import json
import re
import time
import zipfile
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Tuple

from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator

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
from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine
from src.core.exceptions import EngineInputError
from src.parsers.safe_zip import ArchiveSecurityError, SafeZipReader


# ==============================================================================
# Domain Models & Enums
# ==============================================================================

class KeyUserItemType(str, Enum):
    """Authoritative SAP Key-User Extensibility Object Types."""
    CUSTOM_FIELD = "CUSTOM_FIELD"                     # YY1_/ZZ1_ Business Context Field
    CDS_VIEW = "CDS_VIEW"                             # Custom CDS View / Analytical Query
    CUSTOM_LOGIC = "CUSTOM_LOGIC"                     # Cloud BAdI implementation
    FORM_TEMPLATE = "FORM_TEMPLATE"                   # Custom Adobe Print / Email Template
    APP_VARIANT = "APP_VARIANT"                       # Fiori UI Adaptation App Variant
    CUSTOM_BUSINESS_OBJECT = "CUSTOM_BUSINESS_OBJECT" # Custom Business Object (CBO)
    CUSTOM_CODE_LIST = "CUSTOM_CODE_LIST"             # Reusable Code List
    COMMUNICATION_SCENARIO = "COMMUNICATION_SCENARIO" # Custom Communication Scenario
    UNKNOWN = "UNKNOWN"


class ItemLifecycleStatus(str, Enum):
    """Lifecycle and transport readiness status of an extensibility item."""
    PUBLISHED = "PUBLISHED"   # Active and compiled, ready for export
    EXPORTED = "EXPORTED"     # Packaged in exported collection
    ACTIVE = "ACTIVE"         # Equivalent to published
    DRAFT = "DRAFT"           # In work; uncommitted changes (VIOLATION in export)
    IN_WORK = "IN_WORK"       # Draft synonym (VIOLATION in export)
    DELETED = "DELETED"       # Marked for deletion / obsolete (VIOLATION if referenced)
    OBSOLETE = "OBSOLETE"     # Deprecated / deleted


class SoftwareCollectionItem(BaseModel):
    """Represents a discrete Key-User Extensibility item within a software collection."""
    model_config = ConfigDict(extra="ignore")

    id: str
    type: KeyUserItemType = KeyUserItemType.UNKNOWN
    name: Optional[str] = None
    status: str = "PUBLISHED"
    dependencies: List[str] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)
    line_number: Optional[int] = None
    column_number: Optional[int] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            item_id = str(data.get("id") or data.get("item_id") or data.get("name") or "UNKNOWN").strip()
            data["id"] = item_id
            if not data.get("name"):
                data["name"] = item_id

            raw_type = str(data.get("type") or data.get("item_type") or data.get("object_type") or "UNKNOWN").upper()
            if raw_type in ("FIELD", "CUSTOM_FIELD", "EXT_FIELD"):
                data["type"] = KeyUserItemType.CUSTOM_FIELD
            elif raw_type in ("CDS", "CDS_VIEW", "CUSTOM_CDS", "VIEW"):
                data["type"] = KeyUserItemType.CDS_VIEW
            elif raw_type in ("LOGIC", "CUSTOM_LOGIC", "BADI"):
                data["type"] = KeyUserItemType.CUSTOM_LOGIC
            elif raw_type in ("FORM", "FORM_TEMPLATE", "XDP"):
                data["type"] = KeyUserItemType.FORM_TEMPLATE
            elif raw_type in ("VARIANT", "APP_VARIANT", "UI_VARIANT"):
                data["type"] = KeyUserItemType.APP_VARIANT
            elif raw_type in ("CBO", "CUSTOM_BUSINESS_OBJECT"):
                data["type"] = KeyUserItemType.CUSTOM_BUSINESS_OBJECT
            elif raw_type in ("CODE_LIST", "CUSTOM_CODE_LIST"):
                data["type"] = KeyUserItemType.CUSTOM_CODE_LIST
            elif raw_type in ("COMM_SCENARIO", "COMMUNICATION_SCENARIO"):
                data["type"] = KeyUserItemType.COMMUNICATION_SCENARIO
            else:
                try:
                    data["type"] = KeyUserItemType(raw_type)
                except ValueError:
                    data["type"] = KeyUserItemType.UNKNOWN

            raw_status = str(data.get("status") or "PUBLISHED").upper().strip()
            data["status"] = raw_status

            raw_deps = data.get("dependencies")
            if isinstance(raw_deps, list):
                data["dependencies"] = [str(d).strip() for d in raw_deps if d]
            elif isinstance(raw_deps, str):
                data["dependencies"] = [d.strip() for d in raw_deps.split(",") if d.strip()]
            else:
                data["dependencies"] = []
        return data


class SoftwareCollection(BaseModel):
    """Represents a Software Collection container holding key-user items."""
    model_config = ConfigDict(extra="ignore")

    id: str
    name: Optional[str] = None
    version: Optional[str] = "1.0"
    status: str = "EXPORTED"
    items: List[SoftwareCollectionItem] = Field(default_factory=list)
    dependencies: List[str] = Field(default_factory=list)  # Direct collection-level prerequisites
    line_number: Optional[int] = None
    column_number: Optional[int] = None

    @model_validator(mode="before")
    @classmethod
    def normalize_fields(cls, data: Any) -> Any:
        if isinstance(data, dict):
            col_id = str(data.get("id") or data.get("collection_id") or data.get("name") or "UNKNOWN").strip()
            data["id"] = col_id
            if not data.get("name"):
                data["name"] = col_id
            raw_deps = data.get("dependencies")
            if isinstance(raw_deps, list):
                data["dependencies"] = [str(d).strip() for d in raw_deps if d]
            elif isinstance(raw_deps, str):
                data["dependencies"] = [d.strip() for d in raw_deps.split(",") if d.strip()]
            else:
                data["dependencies"] = []
        return data


class SoftwareCollectionManifest(BaseModel):
    """Top-level export manifest for software collections."""
    model_config = ConfigDict(extra="ignore")

    export_id: Optional[str] = None
    source_system: Optional[str] = None
    target_release: Optional[str] = None
    target_system_collections: List[str] = Field(default_factory=list)
    target_system_items: List[str] = Field(default_factory=list)
    collections: List[SoftwareCollection] = Field(default_factory=list)
    schema_errors: List[Dict[str, Any]] = Field(default_factory=list)


# ==============================================================================
# Helper Utilities
# ==============================================================================

UUID_REGEX = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$|"
    r"^[0-9a-fA-F]{32}$"
)

SAP_STANDARD_PREFIXES = (
    "I_", "C_", "E_", "P_", "R_", "BAPI_", "SAP_", "S4_", "/SAP/", "MARA", "VBAK", "VBAP", "BKPF", "BSEG"
)


def _locate_line_in_text(raw_text: str, token: str) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically identifies the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    for idx, line in enumerate(lines, 1):
        pos = line.find(token)
        if pos != -1:
            return idx, pos + 1, line.strip()
    return None, None, ""


def _is_probable_uuid(token: str) -> bool:
    """Checks whether an identifier resembles an unresolvable UUID or hex hash."""
    return bool(UUID_REGEX.match(token.strip()))


# ==============================================================================
# Main Engine Implementation
# ==============================================================================

@register_engine
class SoftwareCollectionEngine(BaseEngine):
    """Preflights SAP S/4HANA Cloud Key-User Software Collections and export manifests."""

    engine_type = EngineType.SOFTWARE_COLLECTION_DEPENDENCY_GUARD
    rule_prefix = "SC"
    accepts_binary_input = True
    name = "Software Collection Dependency Guard"
    description = "Export software collection item cross-reference and release validator"
    version = "1.0.0"
    supported_artifact_types = [ArtifactType.JSON, ArtifactType.XML, ArtifactType.ZIP]

    @classmethod
    def evaluate(
        cls,
        collections: Any,
        dependencies: Any,
    ) -> Dict[str, Any]:
        """Direct deterministic evaluation helper matching E2E test harness expectations.

        Args:
            collections: List of collection IDs or dictionary of collections.
            dependencies: Mapping from collection ID to list of prerequisite collection IDs.
        """
        # Normalize collections list
        if isinstance(collections, dict):
            col_list = list(collections.keys())
        elif isinstance(collections, (list, set, tuple)):
            col_list = [str(c) for c in collections]
        else:
            col_list = []

        # Normalize dependencies mapping: node -> list of nodes it depends on
        dep_map: Dict[str, List[str]] = {}
        if isinstance(dependencies, dict):
            for k, v in dependencies.items():
                if isinstance(v, list):
                    dep_map[str(k)] = [str(x) for x in v]
                else:
                    dep_map[str(k)] = [str(v)] if v else []

        # Ensure all collections are keys in dep_map
        for c in col_list:
            dep_map.setdefault(c, [])

        all_nodes = sorted(list(set(col_list).union(dep_map.keys())))

        # Cycle detection using 3-color DFS
        visited: Dict[str, int] = {node: 0 for node in all_nodes}  # 0: white, 1: gray, 2: black
        cycles: List[List[str]] = []

        def dfs(u: str, path: List[str]):
            visited[u] = 1
            # Sort neighbors for deterministic traversal
            for v in sorted(dep_map.get(u, [])):
                if visited.get(v) == 1:
                    # Detected cycle
                    try:
                        cycle_start_idx = path.index(v)
                        cycle = path[cycle_start_idx:] + [v]
                    except ValueError:
                        cycle = path + [v]
                    cycles.append(cycle)
                elif visited.get(v, 0) == 0:
                    dfs(v, path + [v])
            visited[u] = 2

        for node in all_nodes:
            if visited.get(node, 0) == 0:
                dfs(node, [node])

        # Topological sorting (Kahn's algorithm) for optimal import order
        # In dependency semantics: u depends on v means v must be imported BEFORE u.
        # So in-degree in Kahn's algorithm is the count of prerequisites.
        in_degree: Dict[str, int] = {node: 0 for node in all_nodes}
        dependents_of: Dict[str, List[str]] = {node: [] for node in all_nodes}

        for u in all_nodes:
            prereqs = [p for p in dep_map.get(u, []) if p in in_degree]
            in_degree[u] = len(prereqs)
            for p in prereqs:
                dependents_of[p].append(u)

        # Roots have 0 prerequisites
        ready_queue = [node for node in all_nodes if in_degree[node] == 0]
        ready_queue.sort()

        recommended_sequence: List[str] = []
        while ready_queue:
            curr = ready_queue.pop(0)
            recommended_sequence.append(curr)
            for dep in sorted(dependents_of.get(curr, [])):
                in_degree[dep] -= 1
                if in_degree[dep] == 0:
                    ready_queue.append(dep)
                    ready_queue.sort()

        has_cycles = len(cycles) > 0
        if has_cycles or len(recommended_sequence) != len(all_nodes):
            recommended_sequence = []

        findings: List[Dict[str, Any]] = []
        if has_cycles:
            for c in cycles:
                findings.append({
                    "code": "SC_CIRCULAR_DEPENDENCY",
                    "severity": "CRITICAL",
                    "confidence": "VERIFIED",
                    "title": "Circular Dependency Between Software Collections",
                    "message": f"Collections {' and '.join(c[:-1])} depend on each other and cannot be imported sequentially.",
                    "cycles": cycles,
                    "technicalDetails": {
                        "cycle": c,
                        "cycles": cycles,
                    },
                })

        return {
            "status": "COMPLETED",
            "has_cycles": has_cycles,
            "cycles": cycles,
            "findings": findings,
            "recommended_sequence": recommended_sequence,
            "total_collections": len(all_nodes),
        }

    @classmethod
    def _parse_inputs(cls, *args, **kwargs):
        """Compatibility alias for test harness and registry inspection."""
        return cls.parse_artifact(*args, **kwargs)

    @classmethod
    def parse_artifact(
        cls,
        raw_content: str | bytes,
        artifact_type: ArtifactType = ArtifactType.JSON,
        artifact_path: str = "software_collection.json",
    ) -> SoftwareCollectionManifest:
        """Deterministically parses JSON, XML, or ZIP into a SoftwareCollectionManifest."""
        if not raw_content:
            return SoftwareCollectionManifest()

        byte_data = raw_content.encode("utf-8", errors="replace") if isinstance(raw_content, str) else raw_content

        # Check for ZIP archive magic bytes PK\x03\x04 or explicit ZIP artifact type
        if byte_data.startswith(b"PK\x03\x04") or artifact_type == ArtifactType.ZIP:
            try:
                return cls._parse_zip_content(byte_data, artifact_path)
            except ArchiveSecurityError as exc:
                if not byte_data.startswith(b"PK\x03\x04"):
                    # Declared ZIP but not an archive: fall back to text parsing below.
                    pass
                else:
                    raise EngineInputError(
                        f"{cls.rule_prefix}_ARCHIVE_REJECTED",
                        f"Software collection archive rejected by ingestion safety limits: {exc}",
                    ) from exc

        if isinstance(raw_content, bytes):
            try:
                text_content = raw_content.decode("utf-8")
            except UnicodeDecodeError:
                text_content = raw_content.decode("latin1", errors="replace")
        else:
            text_content = str(raw_content or "")

        stripped = text_content.strip()

        # Format detection if not explicitly set
        if stripped.startswith("<") or artifact_type == ArtifactType.XML:
            return cls._parse_xml_content(stripped, artifact_path)
        else:
            return cls._parse_json_content(stripped, artifact_path)

    @classmethod
    def _parse_json_content(cls, json_text: str, artifact_path: str) -> SoftwareCollectionManifest:
        """Parses JSON content into a normalized SoftwareCollectionManifest."""
        if not json_text:
            return SoftwareCollectionManifest()

        try:
            data = json.loads(json_text)
        except json.JSONDecodeError:
            # Return empty manifest; rule evaluation will flag format error
            return SoftwareCollectionManifest()

        manifest = SoftwareCollectionManifest()

        # Format 1: Direct simplified map {"collections": [...], "dependencies": {...}}
        if isinstance(data, dict) and "dependencies" in data and not any(isinstance(x, dict) for x in data.get("collections", [])):
            cols = data.get("collections") or []
            deps = data.get("dependencies") or {}
            col_objs: List[SoftwareCollection] = []

            for c in cols:
                c_str = str(c)
                line_no, col_no, _ = _locate_line_in_text(json_text, f'"{c_str}"')
                c_deps = deps.get(c_str, [])
                if isinstance(c_deps, str):
                    c_deps = [c_deps]
                col_objs.append(
                    SoftwareCollection(
                        id=c_str,
                        name=c_str,
                        dependencies=[str(d) for d in c_deps],
                        line_number=line_no,
                        column_number=col_no,
                    )
                )

            manifest.collections = col_objs
            return manifest

        # Format 2: Enterprise Manifest
        if isinstance(data, dict):
            manifest.export_id = data.get("export_id")
            manifest.source_system = data.get("source_system")
            manifest.target_release = data.get("target_release")
            manifest.target_system_collections = [str(x) for x in data.get("target_system_collections", [])]
            manifest.target_system_items = [str(x) for x in data.get("target_system_items", [])]

            raw_cols = data.get("collections") or []
            if isinstance(raw_cols, list):
                for c_data in raw_cols:
                    if isinstance(c_data, dict):
                        c_id = str(c_data.get("collection_id") or c_data.get("id") or "UNKNOWN")
                        line_no, col_no, _ = _locate_line_in_text(json_text, f'"{c_id}"')
                        items_list: List[SoftwareCollectionItem] = []
                        raw_items = c_data.get("items") or []
                        for i_data in raw_items:
                            if isinstance(i_data, dict):
                                i_id = str(i_data.get("item_id") or i_data.get("id") or "UNKNOWN")
                                i_line, i_col, _ = _locate_line_in_text(json_text, f'"{i_id}"')
                                try:
                                    item = SoftwareCollectionItem.model_validate(i_data)
                                    item.line_number = i_line
                                    item.column_number = i_col
                                    items_list.append(item)
                                except (ValidationError, Exception) as err:
                                    manifest.schema_errors.append({
                                        "entity": i_id,
                                        "error": str(err),
                                        "line": i_line,
                                        "snippet": f'"{i_id}"',
                                    })

                        try:
                            col = SoftwareCollection.model_validate(c_data)
                            col.line_number = line_no
                            col.column_number = col_no
                            col.items = items_list
                            manifest.collections.append(col)
                        except (ValidationError, Exception) as err:
                            manifest.schema_errors.append({
                                "entity": c_id,
                                "error": str(err),
                                "line": line_no,
                                "snippet": f'"{c_id}"',
                            })

        return manifest

    @classmethod
    def _parse_xml_content(cls, xml_text: str, artifact_path: str) -> SoftwareCollectionManifest:
        """Safely parses Key-User ATO export XML with line number retention."""
        manifest = SoftwareCollectionManifest()
        if not xml_text:
            return manifest

        try:
            root = SafeXmlParser.parse_string(xml_text)
        except Exception:
            return manifest

        manifest.export_id = root.attrib.get("export_id")
        manifest.target_release = root.attrib.get("target_release")

        # Parse target system declarations if present
        target_sys = root.find("target_system")
        if target_sys is not None:
            for tc in target_sys.findall("collection"):
                cid = tc.attrib.get("id") or tc.attrib.get("collection_id")
                if cid:
                    manifest.target_system_collections.append(cid)
            for ti in target_sys.findall("item"):
                iid = ti.attrib.get("id") or ti.attrib.get("item_id")
                if iid:
                    manifest.target_system_items.append(iid)

        # Parse collections
        for col_elem in root.findall(".//collection"):
            cid = col_elem.attrib.get("id") or col_elem.attrib.get("collection_id") or "UNKNOWN"
            col_name = col_elem.attrib.get("name", cid)
            col_version = col_elem.attrib.get("version", "1.0")
            col_status = col_elem.attrib.get("status", "EXPORTED")
            line_no = getattr(col_elem, "sourceline", 1)
            col_no = getattr(col_elem, "sourcecolumn", 1)

            col_deps: List[str] = []
            col_items: List[SoftwareCollectionItem] = []

            # Direct collection-level dependency elements
            for c_dep in col_elem.findall("dependency"):
                dep_id = c_dep.attrib.get("id") or c_dep.attrib.get("collection_id")
                if dep_id:
                    col_deps.append(dep_id)

            # Items within collection
            for item_elem in col_elem.findall(".//item"):
                iid = item_elem.attrib.get("id") or item_elem.attrib.get("item_id") or "UNKNOWN"
                itype = item_elem.attrib.get("type") or item_elem.attrib.get("item_type") or "UNKNOWN"
                istatus = item_elem.attrib.get("status", "PUBLISHED")
                iname = item_elem.attrib.get("name", iid)
                i_line = getattr(item_elem, "sourceline", line_no)
                i_col = getattr(item_elem, "sourcecolumn", col_no)

                i_deps: List[str] = []
                for dep_elem in item_elem.findall("dependency"):
                    ref_id = dep_elem.attrib.get("id") or dep_elem.attrib.get("item_id")
                    ref_col = dep_elem.attrib.get("collection") or dep_elem.attrib.get("collection_id")
                    if ref_id:
                        if ref_col:
                            i_deps.append(f"{ref_col}:{ref_id}")
                        else:
                            i_deps.append(ref_id)

                col_items.append(
                    SoftwareCollectionItem(
                        id=iid,
                        type=itype,
                        name=iname,
                        status=istatus,
                        dependencies=i_deps,
                        line_number=i_line,
                        column_number=i_col,
                    )
                )

            manifest.collections.append(
                SoftwareCollection(
                    id=cid,
                    name=col_name,
                    version=col_version,
                    status=col_status,
                    dependencies=col_deps,
                    items=col_items,
                    line_number=line_no,
                    column_number=col_no,
                )
            )

        return manifest

    @classmethod
    def _parse_zip_content(cls, zip_bytes: bytes, artifact_path: str) -> SoftwareCollectionManifest:
        """Securely parses an in-memory ZIP archive via SafeZipReader (zip bomb / zip slip protection).

        Raises ArchiveSecurityError when the archive violates ingestion limits.
        """
        with SafeZipReader(zip_bytes) as zf:
            names = zf.namelist()
            # Locate manifest.json or manifest.xml
            manifest_files = [f for f in names if f.lower().endswith(("manifest.json", "collections.json", "manifest.xml", "collections.xml"))]
            if manifest_files:
                target_file = sorted(manifest_files)[0]
                content = zf.read(target_file)
                if target_file.lower().endswith(".json"):
                    return cls._parse_json_content(content.decode("utf-8", errors="replace"), target_file)
                return cls._parse_xml_content(content.decode("utf-8", errors="replace"), target_file)

            # Fallback: scan JSON files in zip (deterministic order)
            json_files = sorted(f for f in names if f.lower().endswith(".json"))
            if json_files:
                content = zf.read(json_files[0])
                return cls._parse_json_content(content.decode("utf-8", errors="replace"), json_files[0])

        return SoftwareCollectionManifest()

        return manifest

    # ==========================================================================
    # Asynchronous Engine Analysis
    # ==========================================================================

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        """Executes complete deterministic preflight evaluation of software collections."""
        start_time = time.perf_counter()
        rules_evaluated = 0
        findings: List[Finding] = []

        raw_text = request.raw_content or ""
        artifact_path = request.artifact_s3_key or "software_collection/manifest.json"
        raw_bytes = request.get_raw_bytes()
        # Binary ZIP exports arrive base64-encoded; pass exact bytes to the parser.
        is_binary = request.raw_content is None and bool(raw_bytes)

        # ----------------------------------------------------------------------
        # Step 1: Parse Input Artifact
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        manifest = self.parse_artifact(
            raw_content=raw_bytes if is_binary else raw_text,
            artifact_type=request.artifact_type,
            artifact_path=artifact_path,
        )

        # Fallback to request configuration if raw text is empty but configuration exists
        if not manifest.collections and request.configuration:
            config_json = json.dumps(request.configuration)
            manifest = self.parse_artifact(config_json, ArtifactType.JSON, artifact_path)

        if not manifest.collections:
            line_no, col_no, snippet = _locate_line_in_text(raw_text, "collections")
            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or "EMPTY",
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or "EMPTY",
                provenance=ConfidenceClass.UNKNOWN,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )
            f = Finding(
                rule_id="SC_SCHEMA_VALIDATION_FAILED",
                severity=Severity.BLOCKER,
                category="RELEASE_TRANSPORT",
                title="Invalid or Empty Software Collection Manifest",
                description="The supplied artifact could not be parsed into a valid software collection export manifest.",
                confidence=ConfidenceClass.UNKNOWN,
                confidence_score=0.30,
                remediation="Ensure the uploaded artifact conforms to SAP Key-User Software Collection export schema (JSON/XML).",
                evidence=[ev],
                technical_details={"raw_artifact_length": len(raw_text)},
                affected_objects=[],
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
                        "total_collections": 0,
                        "total_items": 0,
                        "circular_dependencies_count": 0,
                        "recommended_sequence": [],
                        "totalCollections": 0,
                        "totalItems": 0,
                        "circularDependenciesCount": 0,
                        "recommendedSequence": [],
                    }
                ),
            )

        # Emit findings for any individual item or collection schema validation failures
        if manifest.schema_errors:
            for err_info in manifest.schema_errors:
                ev = EvidenceEngine.create_evidence(
                    artifact_path=artifact_path,
                    content=raw_text or "SCHEMA_ERROR",
                    line_number=err_info.get("line", 1),
                    column_number=1,
                    snippet=err_info.get("snippet", "SCHEMA_ERROR"),
                    provenance=ConfidenceClass.UNKNOWN,
                    source_type=TrustLevel.CUSTOMER_EVIDENCE,
                )
                f = Finding(
                    rule_id="SC_SCHEMA_VALIDATION_FAILED",
                    severity=Severity.BLOCKER,
                    category="RELEASE_TRANSPORT",
                    title="Software Collection Schema Validation Failed",
                    description=f"Validation failed for {err_info.get('entity')}: {err_info.get('error')}",
                    confidence=ConfidenceClass.UNKNOWN,
                    confidence_score=0.30,
                    remediation="Ensure the uploaded artifact conforms to SAP Key-User Software Collection export schema.",
                    evidence=[ev],
                    technical_details=err_info,
                    affected_objects=[err_info.get("entity", "UNKNOWN")],
                )
                findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Step 2: Build Item and Collection Dependency Maps
        # ----------------------------------------------------------------------
        all_collections: Dict[str, SoftwareCollection] = {c.id: c for c in manifest.collections}
        item_to_collection: Dict[str, str] = {}
        all_items: Dict[str, SoftwareCollectionItem] = {}

        total_items_count = 0
        for col in manifest.collections:
            for item in col.items:
                total_items_count += 1
                all_items[item.id] = item
                item_to_collection[item.id] = col.id

        # Derived collection dependency graph: col -> set of prerequisite collections
        col_deps: Dict[str, Set[str]] = {col.id: set(col.dependencies) for col in manifest.collections}

        # Resolve cross-collection dependencies from item references
        for col in manifest.collections:
            for item in col.items:
                for dep in item.dependencies:
                    target_col: Optional[str] = None

                    if ":" in dep:
                        parts = dep.split(":", 1)
                        target_col = parts[0].strip()
                    elif dep in item_to_collection:
                        target_col = item_to_collection[dep]

                    if target_col and target_col != col.id:
                        col_deps[col.id].add(target_col)

        # ----------------------------------------------------------------------
        # Rule 1: Detect Circular Dependencies (SC_CIRCULAR_DEPENDENCY)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        all_col_ids = sorted(list(col_deps.keys()))
        visited_color: Dict[str, int] = {c: 0 for c in all_col_ids}
        detected_cycles: List[List[str]] = []

        def dfs_find_cycles(u: str, path: List[str]):
            visited_color[u] = 1
            for v in sorted(col_deps.get(u, set())):
                if v not in visited_color:
                    continue
                if visited_color[v] == 1:
                    try:
                        start_idx = path.index(v)
                        cycle = path[start_idx:] + [v]
                    except ValueError:
                        cycle = path + [v]
                    # Avoid duplicated cyclic permutations
                    canonical_cycle = tuple(cycle[:-1])
                    if not any(set(canonical_cycle) == set(c[:-1]) for c in detected_cycles):
                        detected_cycles.append(cycle)
                elif visited_color[v] == 0:
                    dfs_find_cycles(v, path + [v])
            visited_color[u] = 2

        for col_id in all_col_ids:
            if visited_color[col_id] == 0:
                dfs_find_cycles(col_id, [col_id])

        for cycle in detected_cycles:
            cycle_str = " -> ".join(cycle)
            primary_col = cycle[0]
            col_obj = all_collections.get(primary_col)
            line_no = col_obj.line_number if col_obj else 1
            col_no = col_obj.column_number if col_obj else 1
            _, _, snippet = _locate_line_in_text(raw_text, primary_col)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or cycle_str,
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f'Collection: "{primary_col}"',
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )

            f = Finding(
                rule_id="SC_CIRCULAR_DEPENDENCY",
                severity=Severity.CRITICAL,
                category="RELEASE_TRANSPORT",
                title=f"Circular Dependency Detected: {cycle_str}",
                description=(
                    f"Software collections exhibit a mutual circular dependency: {cycle_str}. "
                    "Circular dependencies prevent automated sequential import during SAP S/4HANA Cloud release deployment."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Break the circular dependency by: (1) Merging interdependent items into a single software collection, "
                    "or (2) Moving foundational prerequisite objects (e.g. underlying custom fields or CDS views) into a base collection."
                ),
                evidence=[ev],
                technical_details={"cycle": cycle, "cycles": detected_cycles, "code": "SC_CIRCULAR_DEPENDENCY"},
                affected_objects=list(set(cycle)),
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 2: Detect Missing Prerequisites (SC_MISSING_PREREQUISITE)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        known_collections = set(all_col_ids).union(manifest.target_system_collections)
        known_items = set(all_items.keys()).union(manifest.target_system_items)

        missing_col_prereqs: Set[Tuple[str, str]] = set()

        # Check collection-level prerequisites
        for src_col_id, prereqs in col_deps.items():
            for prereq in prereqs:
                if prereq not in known_collections:
                    missing_col_prereqs.add((src_col_id, prereq))

        for src_col_id, missing_prereq in sorted(missing_col_prereqs):
            col_obj = all_collections.get(src_col_id)
            line_no = col_obj.line_number if col_obj else 1
            col_no = col_obj.column_number if col_obj else 1
            _, _, snippet = _locate_line_in_text(raw_text, missing_prereq)

            ev = EvidenceEngine.create_evidence(
                artifact_path=artifact_path,
                content=raw_text or missing_prereq,
                line_number=line_no,
                column_number=col_no,
                snippet=snippet or f'Prerequisite "{missing_prereq}" missing for "{src_col_id}"',
                provenance=ConfidenceClass.VERIFIED,
                source_type=TrustLevel.CUSTOMER_EVIDENCE,
            )

            f = Finding(
                rule_id="SC_MISSING_PREREQUISITE",
                severity=Severity.BLOCKER,
                category="RELEASE_TRANSPORT",
                title=f"Missing Prerequisite Software Collection: {missing_prereq}",
                description=(
                    f"Software collection '{src_col_id}' requires prerequisite collection '{missing_prereq}', "
                    "which is neither present in the export batch nor installed in the target system."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    f"Include software collection '{missing_prereq}' in the export package, or verify and import it "
                    f"into the target tenant prior to importing '{src_col_id}'."
                ),
                evidence=[ev],
                technical_details={"source_collection": src_col_id, "missing_prerequisite": missing_prereq},
                affected_objects=[src_col_id, missing_prereq],
            )
            findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 3: Detect Draft-Status Items in Export (SC_DRAFT_ITEM_INCLUDED)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        draft_items_count = 0
        for col in manifest.collections:
            for item in col.items:
                if item.status.upper() in ("DRAFT", "IN_WORK", "UNPUBLISHED"):
                    draft_items_count += 1
                    _, _, snippet = _locate_line_in_text(raw_text, item.id)

                    ev = EvidenceEngine.create_evidence(
                        artifact_path=artifact_path,
                        content=raw_text or item.id,
                        line_number=item.line_number,
                        column_number=item.column_number,
                        snippet=snippet or f'Item: "{item.id}" (status: {item.status})',
                        provenance=ConfidenceClass.VERIFIED,
                        source_type=TrustLevel.CUSTOMER_EVIDENCE,
                    )

                    f = Finding(
                        rule_id="SC_DRAFT_ITEM_INCLUDED",
                        severity=Severity.MAJOR,
                        category="RELEASE_TRANSPORT",
                        title=f"Draft Extensibility Item Included in Collection: {item.id}",
                        description=(
                            f"Extensibility item '{item.id}' (type: {item.type.value}) in software collection '{col.id}' "
                            f"is in '{item.status}' status. Exporting unverified draft items causes transport failures or deploys broken runtime logic."
                        ),
                        confidence=ConfidenceClass.VERIFIED,
                        confidence_score=1.0,
                        remediation=(
                            f"Open the SAP Fiori app 'Custom Fields' or 'Custom Logic', verify the syntax, "
                            f"and click 'Publish' for item '{item.id}' before exporting the software collection."
                        ),
                        evidence=[ev],
                        technical_details={"collection_id": col.id, "item_id": item.id, "item_type": item.type.value, "status": item.status},
                        affected_objects=[item.id, col.id],
                    )
                    findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 4: Detect Dangling Field & Broken UUID References (SC_DANGLING_FIELD_REFERENCE)
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        dangling_refs_count = 0
        for col in manifest.collections:
            for item in col.items:
                # App Variants, CDS Views, and Form Templates referencing missing fields
                for dep in item.dependencies:
                    dep_clean = dep.split(":", 1)[1] if ":" in dep else dep
                    dep_clean = dep_clean.strip()

                    # Ignore standard SAP CDS views / BAPIs / tables
                    if any(dep_clean.startswith(p) for p in SAP_STANDARD_PREFIXES):
                        continue

                    is_uuid = _is_probable_uuid(dep_clean)
                    is_custom_field = dep_clean.startswith(("YY1_", "ZZ1_"))
                    is_known = dep_clean in known_items

                    is_deleted = False
                    if is_known and dep_clean in all_items:
                        if all_items[dep_clean].status.upper() in ("DELETED", "OBSOLETE"):
                            is_deleted = True

                    if is_deleted or (is_uuid and not is_known) or (is_custom_field and not is_known):
                        dangling_refs_count += 1
                        _, _, snippet = _locate_line_in_text(raw_text, dep_clean)

                        # Per engines_spec.md §11.8: UNKNOWN confidence for unresolved UUIDs, VERIFIED for explicit manifests
                        conf = ConfidenceClass.UNKNOWN if is_uuid else ConfidenceClass.VERIFIED
                        conf_score = 0.30 if is_uuid else 1.0

                        ev = EvidenceEngine.create_evidence(
                            artifact_path=artifact_path,
                            content=raw_text or dep_clean,
                            line_number=item.line_number,
                            column_number=item.column_number,
                            snippet=snippet or f'Dependency: "{dep_clean}"',
                            provenance=conf,
                            source_type=TrustLevel.CUSTOMER_EVIDENCE,
                        )

                        reason = "Item is marked DELETED" if is_deleted else ("Unresolved UUID identifier" if is_uuid else "Custom field not found in export scope or target system")
                        f = Finding(
                            rule_id="SC_DANGLING_FIELD_REFERENCE",
                            severity=Severity.CRITICAL,
                            category="RELEASE_TRANSPORT",
                            title=f"Dangling Field Reference '{dep_clean}' in {item.id}",
                            description=(
                                f"Extensibility item '{item.id}' (type: {item.type.value}) in collection '{col.id}' "
                                f"references field '{dep_clean}', which is invalid: {reason}."
                            ),
                            confidence=conf,
                            confidence_score=conf_score,
                            remediation=(
                                f"Remove the reference to '{dep_clean}' from '{item.id}', or restore and publish the "
                                "custom field before exporting the software collection."
                            ),
                            evidence=[ev],
                            technical_details={"collection_id": col.id, "consumer_item": item.id, "referenced_field": dep_clean, "reason": reason},
                            affected_objects=[item.id, dep_clean],
                        )
                        findings.append(ConfidenceClassifier.classify(f))

        # ----------------------------------------------------------------------
        # Rule 5: Calculate Optimal Deterministic Import Sequence
        # ----------------------------------------------------------------------
        rules_evaluated += 1
        recommended_sequence: List[str] = []

        if not detected_cycles:
            in_degree: Dict[str, int] = {c: 0 for c in all_col_ids}
            dependents: Dict[str, List[str]] = {c: [] for c in all_col_ids}

            for c in all_col_ids:
                local_prereqs = [p for p in col_deps.get(c, set()) if p in in_degree]
                in_degree[c] = len(local_prereqs)
                for p in local_prereqs:
                    dependents[p].append(c)

            ready_queue = [c for c in all_col_ids if in_degree[c] == 0]
            ready_queue.sort()

            while ready_queue:
                curr = ready_queue.pop(0)
                recommended_sequence.append(curr)
                for dep in sorted(dependents.get(curr, [])):
                    in_degree[dep] -= 1
                    if in_degree[dep] == 0:
                        ready_queue.append(dep)
                        ready_queue.sort()

            if len(recommended_sequence) != len(all_col_ids):
                recommended_sequence = []

        elapsed_ms = int((time.perf_counter() - start_time) * 1000)

        # Construct AnalysisMetrics with both snake_case and camelCase keys for full compatibility
        metrics = AnalysisMetrics(
            execution_time_ms=elapsed_ms,
            rules_evaluated=rules_evaluated,
            artifacts_scanned=1,
            additional_metrics={
                "total_collections": len(all_col_ids),
                "total_items": total_items_count,
                "circular_dependencies_count": len(detected_cycles),
                "recommended_sequence": recommended_sequence,
                "totalCollections": len(all_col_ids),
                "totalItems": total_items_count,
                "circularDependenciesCount": len(detected_cycles),
                "recommendedSequence": recommended_sequence,
                "draft_items_count": draft_items_count,
                "missing_prerequisites_count": len(missing_col_prereqs),
                "dangling_references_count": dangling_refs_count,
                "engine": "software_collection_guard",
            },
        )

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=AnalysisStatus.COMPLETED,
            findings=findings,
            metrics=metrics,
        )
