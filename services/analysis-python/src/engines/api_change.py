"""
ERP Preflight — API Change Guard Engine (Feature 27)
Stateless deterministic API lifecycle & breaking change governance engine.
Compares OpenAPI 2.0/3.0 and OData EDMX V2/V4 schemas and cross-references
against the Project Integration Registry to detect breaking consumer impacts.

Governing Standard: AGENTS.md, Cardinal Axiom 2 (14 points), engine-authoring.md, sap-evidence.md
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional, Set, Tuple

import yaml
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
from src.models.evidence import Evidence
from src.models.finding import Finding
from src.models.request import AnalysisRequest
from src.models.response import AnalysisMetrics, AnalysisResponse
from src.parsers.safe_xml import SafeXmlParser
from src.platform.confidence import ConfidenceClassifier
from src.platform.evidence import EvidenceEngine


# =============================================================================
# Input & Registry Models
# =============================================================================


class ClientIntegration(BaseModel):
    model_config = ConfigDict(extra="ignore")

    integration_id: str = Field(..., description="Unique client system or middleware identifier")
    name: Optional[str] = Field(None, description="Human-readable integration name")
    system_type: Optional[str] = Field(None, description="Client system type e.g. SALESFORCE, SAP_BTP, MULESOFT")
    consumed_endpoints: List[str] = Field(default_factory=list, description="List of consumed API paths")
    consumed_entity_sets: List[str] = Field(default_factory=list, description="List of consumed OData entity sets")
    consumed_fields: Dict[str, List[str]] = Field(
        default_factory=dict,
        description="Mapping of Entity/Model or path to consumed field names e.g. {'PurchaseOrder': ['TaxJurisdictionCode']}",
    )
    consumed_operations: Dict[str, List[str]] = Field(
        default_factory=dict,
        description="Mapping of endpoint to HTTP operations e.g. {'/A_PurchaseOrder': ['GET', 'POST']}",
    )


class ApiChangeInputPayload(BaseModel):
    model_config = ConfigDict(extra="ignore")

    baseline: Any = Field(..., description="Baseline API specification (JSON/YAML/XML string or dict)")
    candidate: Any = Field(..., description="Candidate API specification (JSON/YAML/XML string or dict)")
    integrations: List[ClientIntegration] = Field(default_factory=list, description="Project Integration Registry")


# =============================================================================
# Intermediate Normalized API Models
# =============================================================================


class NormalizedProperty(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    type: str = "string"
    format: Optional[str] = None
    nullable: bool = True
    max_length: Optional[int] = None
    precision: Optional[int] = None
    scale: Optional[int] = None
    enums: List[str] = Field(default_factory=list)
    deprecated: bool = False
    line_number: Optional[int] = None
    column_number: Optional[int] = None


class NormalizedEntity(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    properties: Dict[str, NormalizedProperty] = Field(default_factory=dict)
    keys: List[str] = Field(default_factory=list)
    navigation_properties: List[str] = Field(default_factory=list)
    line_number: Optional[int] = None
    column_number: Optional[int] = None


class NormalizedParameter(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    in_location: str = "query"  # query, path, header, body, formData
    required: bool = False
    type: str = "string"
    format: Optional[str] = None
    schema_ref: Optional[str] = None
    line_number: Optional[int] = None
    column_number: Optional[int] = None


class NormalizedOperation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method: str
    operation_id: Optional[str] = None
    parameters: Dict[str, NormalizedParameter] = Field(default_factory=dict)
    request_body_schema: Optional[str] = None
    request_body_required: bool = False
    responses: Dict[str, str] = Field(default_factory=dict)
    deprecated: bool = False
    line_number: Optional[int] = None
    column_number: Optional[int] = None


class NormalizedEndpoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    path: str
    operations: Dict[str, NormalizedOperation] = Field(default_factory=dict)
    line_number: Optional[int] = None
    column_number: Optional[int] = None


class NormalizedApiSchema(BaseModel):
    model_config = ConfigDict(extra="ignore")

    schema_type: str = "OPENAPI_3"  # OPENAPI_2, OPENAPI_3, ODATA_EDMX_V2, ODATA_EDMX_V4
    title: str = ""
    version: str = ""
    endpoints: Dict[str, NormalizedEndpoint] = Field(default_factory=dict)
    entity_sets: Dict[str, str] = Field(default_factory=dict)  # entity_set_name -> entity_type_name
    entities: Dict[str, NormalizedEntity] = Field(default_factory=dict)
    enum_types: Dict[str, List[str]] = Field(default_factory=dict)
    operations_standalone: Dict[str, NormalizedOperation] = Field(default_factory=dict)
    raw_text: str = ""
    artifact_path: str = "spec"
    artifact_hash: str = ""


# =============================================================================
# Helper Utilities for Coordinate Location & Line Excerpts
# =============================================================================


def _locate_token_in_text(raw_text: str, token: str, start_line: int = 1) -> Tuple[Optional[int], Optional[int], str]:
    """Deterministically identifies the 1-indexed line, column, and snippet of a token."""
    if not raw_text or not token:
        return None, None, ""
    lines = raw_text.splitlines()
    start_idx = max(0, (start_line or 1) - 1)
    # 1. Exact quoted match e.g. "token": or 'token':
    exact_patterns = [f'"{token}"', f"'{token}'", f"{token}:", token]
    for pattern in exact_patterns:
        for idx in range(start_idx, len(lines)):
            line = lines[idx]
            pos = line.find(pattern)
            if pos != -1:
                return idx + 1, pos + 1, line.strip()
    return None, None, ""


def _extract_context_snippet(raw_text: str, line_number: int, radius: int = 2) -> str:
    """Extracts a snippet of source lines centered on line_number."""
    if not raw_text:
        return ""
    if not line_number:
        return ""
    lines = raw_text.splitlines()
    target_idx = max(0, line_number - 1)
    start = max(0, target_idx - radius)
    end = min(len(lines), target_idx + radius + 1)
    return "\n".join(lines[start:end])


# =============================================================================
# Engine Implementation
# =============================================================================


@register_engine
class ApiChangeEngine(BaseEngine):
    """
    API Change Guard Engine (Feature 27).
    Parses and diffs OpenAPI 2.0/3.0 and OData EDMX V2/V4 schemas.
    Cross-references breaking changes with Project Integration Registry.
    """

    engine_type = EngineType.API_CHANGE_GUARD
    rule_prefix = "API"
    name = "API Change Guard"
    description = "OData, SOAP, RFC compatibility and deprecation impact scanner"
    version = "2.0.0"
    supported_artifact_types = [
        ArtifactType.JSON,
        ArtifactType.EDMX,
        ArtifactType.XML,
        ArtifactType.TXT,
    ]

    # Incompatible primitive type conversions
    INCOMPATIBLE_TYPE_MAP: Dict[str, Set[str]] = {
        "string": {"integer", "number", "boolean", "array", "object"},
        "integer": {"boolean", "array", "object"},
        "boolean": {"integer", "number", "array", "object"},
        "number": {"string", "boolean", "array", "object"},
    }

    # OData EDM incompatible mappings
    EDM_INCOMPATIBLE_MAP: Dict[str, Set[str]] = {
        "Edm.String": {"Edm.Int32", "Edm.Int64", "Edm.Decimal", "Edm.Boolean", "Edm.DateTime"},
        "Edm.Int32": {"Edm.Boolean", "Edm.DateTime", "Edm.Guid"},
        "Edm.Int64": {"Edm.Int32", "Edm.Int16", "Edm.Byte"},  # Narrowing
        "Edm.Boolean": {"Edm.Int32", "Edm.Decimal", "Edm.DateTime"},
        "Edm.DateTime": {"Edm.Date", "Edm.TimeOfDay"},  # Loss of time/date precision
    }

    async def analyze(self, request: AnalysisRequest) -> AnalysisResponse:
        findings: List[Finding] = []
        rules_evaluated = 0

        # 1. Parse Input Specifications and Integration Registry
        parse_result = self._parse_request_inputs(request)
        if isinstance(parse_result, Finding):
            # Immediate diagnostic failure (e.g. missing baseline or syntax error)
            return AnalysisResponse(
                job_id=request.job_id,
                engine_type=self.engine_type,
                status=AnalysisStatus.FAILED if parse_result.severity == Severity.BLOCKER else AnalysisStatus.COMPLETED,
                findings=[parse_result],
                metrics=AnalysisMetrics(
                    rules_evaluated=1,
                    artifacts_scanned=max(1, len(request.artifacts)),
                    additional_metrics={"breakingChangesCount": 0, "nonBreakingChangesCount": 0},
                ),
            )

        baseline_schema, candidate_schema, integrations = parse_result
        artifacts_scanned = max(2, len(request.artifacts))

        # 2. Execute Deterministic Schema Diffing Pipeline
        diff_findings, evaluated_count, metrics_dict = self._diff_schemas(
            baseline=baseline_schema,
            candidate=candidate_schema,
            integrations=integrations,
        )
        findings.extend(diff_findings)
        rules_evaluated += evaluated_count

        # 3. Classify All Findings through ConfidenceClassifier
        classified_findings: List[Finding] = []
        for f in findings:
            classified = ConfidenceClassifier.classify(f)
            classified_findings.append(classified)

        # 4. Formulate Execution Metrics
        additional_metrics = {
            "schemaType": baseline_schema.schema_type,
            "breakingChangesCount": metrics_dict.get("breakingChangesCount", 0),
            "nonBreakingChangesCount": metrics_dict.get("nonBreakingChangesCount", 0),
            "affectedIntegrationsCount": len(metrics_dict.get("affectedIntegrations", set())),
            "affectedIntegrations": sorted(list(metrics_dict.get("affectedIntegrations", set()))),
            "endpointsAnalyzed": len(baseline_schema.endpoints),
            "entitySetsAnalyzed": len(baseline_schema.entity_sets),
            "baselineVersion": baseline_schema.version,
            "candidateVersion": candidate_schema.version,
        }

        status = AnalysisStatus.COMPLETED

        return AnalysisResponse(
            job_id=request.job_id,
            engine_type=self.engine_type,
            status=status,
            findings=classified_findings,
            metrics=AnalysisMetrics(
                rules_evaluated=max(rules_evaluated, 1),
                artifacts_scanned=artifacts_scanned,
                additional_metrics=additional_metrics,
            ),
        )

    # -------------------------------------------------------------------------
    # Input Ingestion & Dispatcher
    # -------------------------------------------------------------------------

    def _parse_request_inputs(
        self, request: AnalysisRequest
    ) -> Tuple[NormalizedApiSchema, NormalizedApiSchema, List[ClientIntegration]] | Finding:
        """
        Extracts baseline and candidate API specifications and the integration registry
        from bundled raw_content, configuration dictionaries, or attached artifacts.
        """
        baseline_raw: Any = None
        candidate_raw: Any = None
        integrations: List[ClientIntegration] = []

        baseline_path = "baseline_spec"
        candidate_path = "candidate_spec"

        # A. Check configuration for integrations
        if isinstance(request.configuration.get("integrations"), list):
            for item in request.configuration["integrations"]:
                try:
                    integrations.append(ClientIntegration.model_validate(item))
                except Exception:
                    pass

        # B. Check configuration for baseline / candidate
        if "baseline" in request.configuration:
            baseline_raw = request.configuration["baseline"]
        if "candidate" in request.configuration:
            candidate_raw = request.configuration["candidate"]

        # C. Check request.raw_content for bundled JSON/YAML payload
        if (not baseline_raw or not candidate_raw) and request.raw_content and request.raw_content.strip():
            raw_str = request.raw_content.strip()
            parsed_bundle = self._try_parse_json_or_yaml(raw_str)
            if isinstance(parsed_bundle, dict):
                if not baseline_raw and "baseline" in parsed_bundle:
                    baseline_raw = parsed_bundle["baseline"]
                if not candidate_raw and "candidate" in parsed_bundle:
                    candidate_raw = parsed_bundle["candidate"]
                if "integrations" in parsed_bundle and isinstance(parsed_bundle["integrations"], list):
                    for item in parsed_bundle["integrations"]:
                        try:
                            integrations.append(ClientIntegration.model_validate(item))
                        except Exception:
                            pass

        # D. Check attached artifacts
        if not baseline_raw or not candidate_raw:
            for art in request.artifacts:
                art_content = art.raw_content or ""
                if not art_content:
                    continue
                file_lower = (art.file_name or "").lower()
                if "baseline" in file_lower or (not baseline_raw and "candidate" not in file_lower):
                    baseline_raw = art_content
                    baseline_path = art.file_name
                elif "candidate" in file_lower or (baseline_raw and not candidate_raw):
                    candidate_raw = art_content
                    candidate_path = art.file_name
                elif "integration" in file_lower:
                    try:
                        p = json.loads(art_content)
                        items = p if isinstance(p, list) else p.get("integrations", [])
                        for item in items:
                            integrations.append(ClientIntegration.model_validate(item))
                    except Exception:
                        pass

        # Validate that baseline was provided
        if baseline_raw is None:
            return Finding(
                rule_id="API_BASELINE_MISSING",
                severity=Severity.BLOCKER,
                category="API Governance",
                title="Missing Baseline API Specification",
                description=(
                    "API Change Guard requires both a baseline API specification and a candidate "
                    "API specification to evaluate breaking changes. Baseline specification was not supplied."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation=(
                    "Provide the prior release API specification in the request payload or as an artifact "
                    "named 'baseline' (OpenAPI JSON/YAML or OData EDMX XML)."
                ),
                evidence=[
                    Evidence(
                        artifact_path="request_payload",
                        line_number=1,
                        snippet="AnalysisRequest received without baseline specification",
                        sha256=EvidenceEngine.compute_sha256(request.raw_content or ""),
                        provenance=ConfidenceClass.VERIFIED,
                        trust_score=1.0,
                    )
                ],
                technical_details={"error": "BASELINE_SPECIFICATION_NOT_PROVIDED"},
                affected_objects=["API_SPECIFICATION"],
            )

        # Validate that candidate was provided
        if candidate_raw is None:
            return Finding(
                rule_id="API_CANDIDATE_MISSING",
                severity=Severity.BLOCKER,
                category="API Governance",
                title="Missing Candidate API Specification",
                description=(
                    "API Change Guard requires a candidate API specification to compare against the baseline. "
                    "Candidate specification was not supplied."
                ),
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation="Provide the target release API specification under the 'candidate' attribute or artifact.",
                evidence=[
                    Evidence(
                        artifact_path="request_payload",
                        line_number=1,
                        snippet="AnalysisRequest received without candidate specification",
                        sha256=EvidenceEngine.compute_sha256(request.raw_content or ""),
                        provenance=ConfidenceClass.VERIFIED,
                        trust_score=1.0,
                    )
                ],
                technical_details={"error": "CANDIDATE_SPECIFICATION_NOT_PROVIDED"},
                affected_objects=["API_SPECIFICATION"],
            )

        # Normalize raw inputs to string representations
        base_str = baseline_raw if isinstance(baseline_raw, str) else json.dumps(baseline_raw, indent=2)
        cand_str = candidate_raw if isinstance(candidate_raw, str) else json.dumps(candidate_raw, indent=2)

        # Parse baseline schema
        try:
            baseline_schema = self._parse_api_schema(base_str, baseline_path)
        except Exception as e:
            return Finding(
                rule_id="API_SPEC_SYNTAX_ERROR",
                severity=Severity.BLOCKER,
                category="API Governance",
                title="Baseline API Specification Syntax Error",
                description=f"Failed to parse baseline API specification: {str(e)}",
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation="Ensure the baseline API specification is valid OpenAPI 2.0/3.0 JSON/YAML or well-formed OData EDMX XML.",
                evidence=[
                    Evidence(
                        artifact_path=baseline_path,
                        line_number=1,
                        snippet=base_str[:200],
                        sha256=EvidenceEngine.compute_sha256(base_str),
                        provenance=ConfidenceClass.VERIFIED,
                        trust_score=1.0,
                    )
                ],
                technical_details={"error": str(e), "specification": "baseline"},
                affected_objects=["BASELINE_SPECIFICATION"],
            )

        # Parse candidate schema
        try:
            candidate_schema = self._parse_api_schema(cand_str, candidate_path)
        except Exception as e:
            return Finding(
                rule_id="API_SPEC_SYNTAX_ERROR",
                severity=Severity.BLOCKER,
                category="API Governance",
                title="Candidate API Specification Syntax Error",
                description=f"Failed to parse candidate API specification: {str(e)}",
                confidence=ConfidenceClass.VERIFIED,
                confidence_score=1.0,
                remediation="Ensure the candidate API specification is valid OpenAPI 2.0/3.0 JSON/YAML or well-formed OData EDMX XML.",
                evidence=[
                    Evidence(
                        artifact_path=candidate_path,
                        line_number=1,
                        snippet=cand_str[:200],
                        sha256=EvidenceEngine.compute_sha256(cand_str),
                        provenance=ConfidenceClass.VERIFIED,
                        trust_score=1.0,
                    )
                ],
                technical_details={"error": str(e), "specification": "candidate"},
                affected_objects=["CANDIDATE_SPECIFICATION"],
            )

        return baseline_schema, candidate_schema, integrations

    def _try_parse_json_or_yaml(self, text: str) -> Optional[Dict[str, Any]]:
        """Safely attempts to parse text as JSON, falling back to safe YAML."""
        if not text:
            return None
        clean = text.strip()
        if clean.startswith("{") or clean.startswith("["):
            try:
                return json.loads(clean)
            except Exception:
                pass
        try:
            loaded = yaml.safe_load(clean)
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
        return None

    # -------------------------------------------------------------------------
    # Schema Parsers (OpenAPI & OData EDMX)
    # -------------------------------------------------------------------------

    def _parse_api_schema(self, raw_text: str, artifact_path: str) -> NormalizedApiSchema:
        """Dispatches raw API text to either OData EDMX or OpenAPI normalizers."""
        clean = raw_text.strip()
        art_hash = EvidenceEngine.compute_sha256(raw_text)

        # Detect OData EDMX (XML format)
        if clean.startswith("<") or "<edmx:Edmx" in clean or "<Edmx" in clean:
            return self._parse_odata_edmx(clean, artifact_path, art_hash)

        # Detect OpenAPI / Swagger (JSON or YAML format)
        parsed_dict = self._try_parse_json_or_yaml(clean)
        if isinstance(parsed_dict, dict):
            return self._parse_openapi(parsed_dict, clean, artifact_path, art_hash)

        raise ValueError("Unrecognized API specification format. Expected OData EDMX XML or OpenAPI JSON/YAML.")

    def _parse_odata_edmx(self, xml_text: str, artifact_path: str, artifact_hash: str) -> NormalizedApiSchema:
        """Parses OData EDMX V2 or V4 XML with exact line and column numbers."""
        root = SafeXmlParser.parse_string(xml_text)

        # Determine EDMX version
        version = root.attrib.get("Version", "1.0")
        is_v4 = version.startswith("4.") or "docs.oasis-open.org" in (root.tag or "")

        schema_type = "ODATA_EDMX_V4" if is_v4 else "ODATA_EDMX_V2"
        schema = NormalizedApiSchema(
            schema_type=schema_type,
            title="SAP OData Service Metadata",
            version=version,
            raw_text=xml_text,
            artifact_path=artifact_path,
            artifact_hash=artifact_hash,
        )

        # Recursively traverse elements ignoring XML namespaces
        for elem in root.iter():
            tag_local = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
            line_no = getattr(elem, "sourceline", 1)
            col_no = getattr(elem, "sourcecolumn", 1)

            # A. EntityType Definition
            if tag_local == "EntityType":
                entity_name = elem.attrib.get("Name", "")
                if entity_name:
                    entity = NormalizedEntity(
                        name=entity_name,
                        line_number=line_no,
                        column_number=col_no,
                    )

                    # Extract Keys
                    for child in elem:
                        c_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                        if c_tag == "Key":
                            for prop_ref in child:
                                pr_name = prop_ref.attrib.get("Name", "")
                                if pr_name:
                                    entity.keys.append(pr_name)

                        # Extract Properties
                        elif c_tag == "Property":
                            p_name = child.attrib.get("Name", "")
                            p_type = child.attrib.get("Type", "Edm.String")
                            p_nullable = child.attrib.get("Nullable", "true").lower() != "false"
                            p_len_str = child.attrib.get("MaxLength")
                            p_max_len = int(p_len_str) if p_len_str and p_len_str.isdigit() else None
                            p_line = getattr(child, "sourceline", line_no)
                            p_col = getattr(child, "sourcecolumn", col_no)

                            # Check SAP deprecation annotation
                            deprecated = (
                                any(k.endswith("label") and v.lower() == "deprecated" for k, v in child.attrib.items())
                                or any(k.endswith("deprecated") and v.lower() == "true" for k, v in child.attrib.items())
                            )

                            prop = NormalizedProperty(
                                name=p_name,
                                type=p_type,
                                nullable=p_nullable,
                                max_length=p_max_len,
                                deprecated=deprecated,
                                line_number=p_line,
                                column_number=p_col,
                            )
                            entity.properties[p_name] = prop

                        # Extract Navigation Properties
                        elif c_tag == "NavigationProperty":
                            nav_name = child.attrib.get("Name", "")
                            if nav_name:
                                entity.navigation_properties.append(nav_name)

                    schema.entities[entity_name] = entity

            # B. EntitySet in EntityContainer
            elif tag_local == "EntitySet":
                set_name = elem.attrib.get("Name", "")
                entity_type_ref = elem.attrib.get("EntityType", "")
                type_short = entity_type_ref.split(".")[-1] if entity_type_ref else ""
                if set_name:
                    schema.entity_sets[set_name] = type_short
                    # Also register as an endpoint URI
                    schema.endpoints[f"/{set_name}"] = NormalizedEndpoint(
                        path=f"/{set_name}",
                        line_number=line_no,
                        column_number=col_no,
                        operations={
                            "GET": NormalizedOperation(method="GET", line_number=line_no, column_number=col_no),
                            "POST": NormalizedOperation(method="POST", line_number=line_no, column_number=col_no),
                        },
                    )

            # C. EnumType Definition
            elif tag_local == "EnumType":
                enum_name = elem.attrib.get("Name", "")
                if enum_name:
                    members: List[str] = []
                    for child in elem:
                        c_tag = child.tag.split("}")[-1] if "}" in child.tag else child.tag
                        if c_tag == "Member":
                            m_name = child.attrib.get("Name", "")
                            if m_name:
                                members.append(m_name)
                    schema.enum_types[enum_name] = members

            # D. FunctionImport / ActionImport
            elif tag_local in ("FunctionImport", "ActionImport"):
                op_name = elem.attrib.get("Name", "")
                http_method = elem.attrib.get("HttpMethod", "POST").upper()
                if op_name:
                    schema.operations_standalone[op_name] = NormalizedOperation(
                        method=http_method,
                        operation_id=op_name,
                        line_number=line_no,
                        column_number=col_no,
                    )

        return schema

    def _parse_openapi(
        self, doc: Dict[str, Any], raw_text: str, artifact_path: str, artifact_hash: str
    ) -> NormalizedApiSchema:
        """Parses OpenAPI 2.0 or 3.0 dictionary with token line tracking."""
        is_swagger_2 = "swagger" in doc and str(doc["swagger"]).startswith("2")
        schema_type = "OPENAPI_2" if is_swagger_2 else "OPENAPI_3"
        info = doc.get("info") or {}

        schema = NormalizedApiSchema(
            schema_type=schema_type,
            title=str(info.get("title", "OpenAPI Specification")),
            version=str(info.get("version", "1.0.0")),
            raw_text=raw_text,
            artifact_path=artifact_path,
            artifact_hash=artifact_hash,
        )

        # 1. Parse Paths and Operations
        paths = doc.get("paths") or {}
        for path_str, path_item in paths.items():
            if not isinstance(path_item, dict):
                continue
            p_line, p_col, _ = _locate_token_in_text(raw_text, path_str)
            endpoint = NormalizedEndpoint(
                path=path_str,
                line_number=p_line,
                column_number=p_col,
            )

            # Common path-level parameters
            path_params: Dict[str, NormalizedParameter] = {}
            if "parameters" in path_item and isinstance(path_item["parameters"], list):
                for p in path_item["parameters"]:
                    norm_p = self._normalize_openapi_param(p, raw_text, p_line)
                    path_params[norm_p.name] = norm_p

            for method_str in ("get", "post", "put", "delete", "patch", "head", "options"):
                if method_str in path_item and isinstance(path_item[method_str], dict):
                    op_dict = path_item[method_str]
                    op_line, op_col, _ = _locate_token_in_text(raw_text, method_str, start_line=p_line)
                    operation = NormalizedOperation(
                        method=method_str.upper(),
                        operation_id=op_dict.get("operationId"),
                        deprecated=bool(op_dict.get("deprecated")),
                        line_number=op_line,
                        column_number=op_col,
                    )
                    # Inherit path params
                    operation.parameters.update(path_params)

                    # Operation parameters
                    if "parameters" in op_dict and isinstance(op_dict["parameters"], list):
                        for p in op_dict["parameters"]:
                            norm_p = self._normalize_openapi_param(p, raw_text, op_line)
                            operation.parameters[norm_p.name] = norm_p

                    # OpenAPI 3 requestBody
                    if "requestBody" in op_dict and isinstance(op_dict["requestBody"], dict):
                        rb = op_dict["requestBody"]
                        operation.request_body_required = bool(rb.get("required"))

                    endpoint.operations[method_str.upper()] = operation

            schema.endpoints[path_str] = endpoint

        # 2. Parse Definitions (OpenAPI 2) or Components Schemas (OpenAPI 3)
        schemas_dict = (doc.get("definitions") or {}) if is_swagger_2 else ((doc.get("components") or {}).get("schemas") or {})
        for entity_name, entity_def in schemas_dict.items():
            if not isinstance(entity_def, dict):
                continue
            e_line, e_col, _ = _locate_token_in_text(raw_text, entity_name)
            entity = NormalizedEntity(
                name=entity_name,
                line_number=e_line,
                column_number=e_col,
            )

            required_props = set(entity_def.get("required") or [])
            properties_dict = entity_def.get("properties") or {}

            for prop_name, prop_def in properties_dict.items():
                if not isinstance(prop_def, dict):
                    continue
                pr_line, pr_col, _ = _locate_token_in_text(raw_text, prop_name, start_line=e_line)
                p_type = prop_def.get("type", "string")
                p_format = prop_def.get("format")
                p_nullable = prop_def.get("nullable", prop_name not in required_props)
                p_max_len = prop_def.get("maxLength")
                p_enums = [str(e) for e in prop_def.get("enum", [])]
                p_deprecated = bool(prop_def.get("deprecated"))

                prop = NormalizedProperty(
                    name=prop_name,
                    type=p_type,
                    format=p_format,
                    nullable=p_nullable,
                    max_length=p_max_len,
                    enums=p_enums,
                    deprecated=p_deprecated,
                    line_number=pr_line,
                    column_number=pr_col,
                )
                entity.properties[prop_name] = prop

            schema.entities[entity_name] = entity

        return schema

    def _normalize_openapi_param(self, p: Dict[str, Any], raw_text: str, start_line: int) -> NormalizedParameter:
        p_name = p.get("name", "")
        p_in = p.get("in", "query")
        p_req = bool(p.get("required", p_in == "path"))
        p_line, p_col, _ = _locate_token_in_text(raw_text, p_name, start_line=start_line)
        p_type = p.get("type") or (p.get("schema") or {}).get("type", "string")
        p_format = p.get("format") or (p.get("schema") or {}).get("format")
        return NormalizedParameter(
            name=p_name,
            in_location=p_in,
            required=p_req,
            type=p_type,
            format=p_format,
            line_number=p_line,
            column_number=p_col,
        )

    # -------------------------------------------------------------------------
    # Deterministic Diff Engine
    # -------------------------------------------------------------------------

    def _diff_schemas(
        self,
        baseline: NormalizedApiSchema,
        candidate: NormalizedApiSchema,
        integrations: List[ClientIntegration],
    ) -> Tuple[List[Finding], int, Dict[str, Any]]:
        findings: List[Finding] = []
        rules_evaluated = 0
        breaking_count = 0
        non_breaking_count = 0
        all_affected_integrations: Set[str] = set()

        # ---------------------------------------------------------------------
        # Rule 1: Endpoint & EntitySet Removals (Breaking) & Additions (Non-Breaking)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for ep_path, base_ep in baseline.endpoints.items():
            if ep_path not in candidate.endpoints:
                # Endpoint removed
                breaking_count += 1
                affected = self._cross_reference_endpoint(ep_path, integrations)
                all_affected_integrations.update(affected)
                severity = Severity.BLOCKER if affected else Severity.CRITICAL
                finding = self._build_finding(
                    rule_id="API_BREAKING_ENDPOINT_REMOVED",
                    severity=severity,
                    category="API Breaking Change",
                    title=f"Breaking Change: Endpoint Removed '{ep_path}'",
                    description=(
                        f"API endpoint '{ep_path}' present in baseline was removed from the candidate specification. "
                        f"Clients making requests to this route will receive HTTP 404 Not Found."
                    ),
                    remediation=f"Restore endpoint '{ep_path}', deploy a backwards-compatible URL rewrite in API Gateway, or migrate clients to the replacement endpoint.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text,
                    line_number=base_ep.line_number,
                    column_number=base_ep.column_number,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[ep_path] + affected,
                    technical_details={"endpoint": ep_path, "affectedIntegrations": affected},
                    is_derived=bool(affected),
                )
                findings.append(finding)
            else:
                # Endpoint present in both: diff operations
                cand_ep = candidate.endpoints[ep_path]
                op_findings, op_evals, op_breaking, op_non_breaking = self._diff_operations(
                    ep_path=ep_path,
                    base_ep=base_ep,
                    cand_ep=cand_ep,
                    baseline=baseline,
                    candidate=candidate,
                    integrations=integrations,
                )
                findings.extend(op_findings)
                rules_evaluated += op_evals
                breaking_count += op_breaking
                non_breaking_count += op_non_breaking
                for f in op_findings:
                    all_affected_integrations.update(f.technical_details.get("affectedIntegrations", []))

        # Check for newly added endpoints in candidate
        for ep_path, cand_ep in candidate.endpoints.items():
            if ep_path not in baseline.endpoints:
                non_breaking_count += 1
                finding = self._build_finding(
                    rule_id="API_NON_BREAKING_ENDPOINT_ADDED",
                    severity=Severity.INFO,
                    category="API Evolution",
                    title=f"New API Endpoint Added '{ep_path}'",
                    description=f"New endpoint '{ep_path}' was added in candidate specification.",
                    remediation="Inform integration teams and update API client SDK documentation.",
                    artifact_path=candidate.artifact_path,
                    raw_text=candidate.raw_text,
                    line_number=cand_ep.line_number,
                    column_number=cand_ep.column_number,
                    artifact_hash=candidate.artifact_hash,
                    affected_objects=[ep_path],
                    technical_details={"endpoint": ep_path},
                )
                findings.append(finding)

        # ---------------------------------------------------------------------
        # Rule 2: OData EntitySet Removals (Breaking)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for es_name, entity_type in baseline.entity_sets.items():
            if es_name not in candidate.entity_sets:
                breaking_count += 1
                affected = self._cross_reference_entity_set(es_name, integrations)
                all_affected_integrations.update(affected)
                severity = Severity.BLOCKER if affected else Severity.CRITICAL
                line_no, col_no, _ = _locate_token_in_text(baseline.raw_text, es_name)
                finding = self._build_finding(
                    rule_id="API_BREAKING_ENTITYSET_REMOVED",
                    severity=severity,
                    category="OData Breaking Change",
                    title=f"Breaking Change: OData EntitySet Removed '{es_name}'",
                    description=(
                        f"OData EntitySet '{es_name}' (EntityType: '{entity_type}') was removed. "
                        "External integrations consuming this entity collection will fail."
                    ),
                    remediation=f"Restore EntitySet '{es_name}' or redirect client integrations to the successor CDS entity set.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text,
                    line_number=line_no,
                    column_number=col_no,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[es_name, entity_type] + affected,
                    technical_details={
                        "entitySet": es_name,
                        "entityType": entity_type,
                        "affectedIntegrations": affected,
                    },
                    is_derived=bool(affected),
                )
                findings.append(finding)

        # ---------------------------------------------------------------------
        # Rule 3: Entities & Properties Diff (Fields removed, type changed, etc.)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for entity_name, base_entity in baseline.entities.items():
            if entity_name not in candidate.entities:
                breaking_count += 1
                affected = self._cross_reference_field(entity_name, "*", integrations)
                all_affected_integrations.update(affected)
                finding = self._build_finding(
                    rule_id="API_BREAKING_ENTITY_REMOVED",
                    severity=Severity.BLOCKER if affected else Severity.CRITICAL,
                    category="Schema Breaking Change",
                    title=f"Breaking Change: Entity Schema Removed '{entity_name}'",
                    description=f"Entity model '{entity_name}' was removed from API schema definitions.",
                    remediation=f"Restore schema definition '{entity_name}' to maintain client payload compatibility.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text,
                    line_number=base_entity.line_number,
                    column_number=base_entity.column_number,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[entity_name] + affected,
                    technical_details={"entity": entity_name, "affectedIntegrations": affected},
                    is_derived=bool(affected),
                )
                findings.append(finding)
            else:
                cand_entity = candidate.entities[entity_name]
                prop_findings, prop_evals, p_break, p_non_break = self._diff_properties(
                    entity_name=entity_name,
                    base_entity=base_entity,
                    cand_entity=cand_entity,
                    baseline=baseline,
                    candidate=candidate,
                    integrations=integrations,
                )
                findings.extend(prop_findings)
                rules_evaluated += prop_evals
                breaking_count += p_break
                non_breaking_count += p_non_break
                for f in prop_findings:
                    all_affected_integrations.update(f.technical_details.get("affectedIntegrations", []))

        # ---------------------------------------------------------------------
        # Rule 4: Standalone Enum Types Diff
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        for enum_name, base_members in baseline.enum_types.items():
            if enum_name in candidate.enum_types:
                cand_members = set(candidate.enum_types[enum_name])
                base_set = set(base_members)
                removed_members = base_set - cand_members
                added_members = cand_members - base_set

                if removed_members:
                    breaking_count += 1
                    line_no, col_no, _ = _locate_token_in_text(candidate.raw_text, enum_name)
                    findings.append(
                        self._build_finding(
                            rule_id="API_BREAKING_ENUM_RESTRICTED",
                            severity=Severity.CRITICAL,
                            category="Schema Breaking Change",
                            title=f"Breaking Change: Enum Values Restricted in '{enum_name}'",
                            description=(
                                f"Enum '{enum_name}' restricted allowed values. "
                                f"Removed members: {sorted(list(removed_members))}."
                            ),
                            remediation="Restore removed enum values or ensure external systems no longer submit retired keys.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=line_no,
                            column_number=col_no,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[enum_name],
                            technical_details={
                                "enum": enum_name,
                                "removedMembers": sorted(list(removed_members)),
                            },
                        )
                    )
                if added_members and not removed_members:
                    non_breaking_count += 1
                    line_no, col_no, _ = _locate_token_in_text(candidate.raw_text, enum_name)
                    findings.append(
                        self._build_finding(
                            rule_id="API_NON_BREAKING_ENUM_EXPANDED",
                            severity=Severity.INFO,
                            category="API Evolution",
                            title=f"Enum Values Expanded in '{enum_name}'",
                            description=f"Enum '{enum_name}' added new members: {sorted(list(added_members))}.",
                            remediation="Update consumer SDKs to recognize new enum values.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=line_no,
                            column_number=col_no,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[enum_name],
                            technical_details={
                                "enum": enum_name,
                                "addedMembers": sorted(list(added_members)),
                            },
                        )
                    )

        metrics_summary = {
            "breakingChangesCount": breaking_count,
            "nonBreakingChangesCount": non_breaking_count,
            "affectedIntegrations": all_affected_integrations,
        }
        return findings, rules_evaluated, metrics_summary

    # -------------------------------------------------------------------------
    # Sub-Diff: Operations & Parameters
    # -------------------------------------------------------------------------

    def _diff_operations(
        self,
        ep_path: str,
        base_ep: NormalizedEndpoint,
        cand_ep: NormalizedEndpoint,
        baseline: NormalizedApiSchema,
        candidate: NormalizedApiSchema,
        integrations: List[ClientIntegration],
    ) -> Tuple[List[Finding], int, int, int]:
        findings: List[Finding] = []
        evals = 0
        breaking_count = 0
        non_breaking_count = 0

        # Check removed operations
        for method, base_op in base_ep.operations.items():
            evals += 1
            if method not in cand_ep.operations:
                breaking_count += 1
                affected = self._cross_reference_operation(ep_path, method, integrations)
                severity = Severity.BLOCKER if affected else Severity.CRITICAL
                finding = self._build_finding(
                    rule_id="API_BREAKING_OPERATION_REMOVED",
                    severity=severity,
                    category="API Breaking Change",
                    title=f"Breaking Change: Operation Removed '{method} {ep_path}'",
                    description=(
                        f"HTTP method '{method}' was removed from endpoint '{ep_path}'. "
                        "Clients calling this operation will receive HTTP 405 Method Not Allowed."
                    ),
                    remediation=f"Re-enable operation '{method}' on '{ep_path}' or migrate consumer workflows to supported methods.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text,
                    line_number=base_op.line_number,
                    column_number=base_op.column_number,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[f"{method} {ep_path}"] + affected,
                    technical_details={"endpoint": ep_path, "method": method, "affectedIntegrations": affected},
                    is_derived=bool(affected),
                )
                findings.append(finding)
            else:
                cand_op = cand_ep.operations[method]

                # Check Deprecation warning
                if not base_op.deprecated and cand_op.deprecated:
                    affected = self._cross_reference_operation(ep_path, method, integrations)
                    finding = self._build_finding(
                        rule_id="API_DEPRECATION_WARNING",
                        severity=Severity.MINOR if affected else Severity.INFO,
                        category="API Lifecycle",
                        title=f"Operation Deprecated '{method} {ep_path}'",
                        description=f"Operation '{method} {ep_path}' is marked as deprecated in the candidate specification.",
                        remediation="Plan migration to successor API routes prior to permanent retirement in future releases.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_op.line_number,
                        column_number=cand_op.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{method} {ep_path}"] + affected,
                        technical_details={"endpoint": ep_path, "method": method, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

                # Check parameters: required additions and type mutations
                for param_name, cand_param in cand_op.parameters.items():
                    evals += 1
                    base_param = base_op.parameters.get(param_name)

                    # A. Required parameter added or existing parameter made required
                    if cand_param.required and (base_param is None or not base_param.required):
                        breaking_count += 1
                        affected = self._cross_reference_operation(ep_path, method, integrations)
                        finding = self._build_finding(
                            rule_id="API_BREAKING_REQUIRED_PARAM_ADDED",
                            severity=Severity.CRITICAL if affected else Severity.MAJOR,
                            category="API Breaking Change",
                            title=f"Breaking Change: Required Parameter Added to '{method} {ep_path}'",
                            description=(
                                f"Required {cand_param.in_location} parameter '{param_name}' was added or made mandatory in '{method} {ep_path}'. "
                                "Existing clients sending requests without this parameter will fail validation (HTTP 400)."
                            ),
                            remediation=f"Make parameter '{param_name}' optional with default server values, or update client request payloads.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=cand_param.line_number,
                            column_number=cand_param.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{method} {ep_path}:{param_name}"] + affected,
                            technical_details={
                                "endpoint": ep_path,
                                "method": method,
                                "parameter": param_name,
                                "affectedIntegrations": affected,
                            },
                            is_derived=bool(affected),
                        )
                        findings.append(finding)

                    # B. Parameter Incompatible Type Mutation
                    elif base_param is not None and self._is_incompatible_type_change(base_param.type, cand_param.type):
                        breaking_count += 1
                        affected = self._cross_reference_operation(ep_path, method, integrations)
                        finding = self._build_finding(
                            rule_id="API_BREAKING_TYPE_CHANGED",
                            severity=Severity.CRITICAL if affected else Severity.MAJOR,
                            category="API Breaking Change",
                            title=f"Breaking Change: Incompatible Parameter Type on '{method} {ep_path}:{param_name}'",
                            description=(
                                f"Parameter '{param_name}' type altered from '{base_param.type}' to '{cand_param.type}'. "
                                "This incompatible parameter type mutation will trigger client request rejection or validation failure."
                            ),
                            remediation=f"Retain compatible type '{base_param.type}' for parameter '{param_name}'.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=cand_param.line_number,
                            column_number=cand_param.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{method} {ep_path}:{param_name}"] + affected,
                            technical_details={
                                "endpoint": ep_path,
                                "method": method,
                                "parameter": param_name,
                                "baselineType": base_param.type,
                                "candidateType": cand_param.type,
                                "affectedIntegrations": affected,
                            },
                            is_derived=bool(affected),
                        )
                        findings.append(finding)

                # Check request body required addition
                if not base_op.request_body_required and cand_op.request_body_required:
                    breaking_count += 1
                    affected = self._cross_reference_operation(ep_path, method, integrations)
                    finding = self._build_finding(
                        rule_id="API_BREAKING_REQUIRED_PROPERTY_ADDED",
                        severity=Severity.CRITICAL if affected else Severity.MAJOR,
                        category="API Breaking Change",
                        title=f"Breaking Change: Request Body Now Required for '{method} {ep_path}'",
                        description=f"Request body for '{method} {ep_path}' was previously optional and is now required.",
                        remediation="Allow empty or optional request bodies to preserve backwards compatibility.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_op.line_number,
                        column_number=cand_op.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{method} {ep_path}"] + affected,
                        technical_details={"endpoint": ep_path, "method": method, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

        # Check newly added operations on existing endpoint
        for method, cand_op in cand_ep.operations.items():
            if method not in base_ep.operations:
                non_breaking_count += 1
                findings.append(
                    self._build_finding(
                        rule_id="API_NON_BREAKING_OPERATION_ADDED",
                        severity=Severity.INFO,
                        category="API Evolution",
                        title=f"New Operation Added '{method} {ep_path}'",
                        description=f"Operation '{method}' was added to existing route '{ep_path}'.",
                        remediation="Document new operation in API portal.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_op.line_number,
                        column_number=cand_op.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{method} {ep_path}"],
                        technical_details={"endpoint": ep_path, "method": method},
                    )
                )

        return findings, evals, breaking_count, non_breaking_count

    # -------------------------------------------------------------------------
    # Sub-Diff: Properties / Fields
    # -------------------------------------------------------------------------

    def _diff_properties(
        self,
        entity_name: str,
        base_entity: NormalizedEntity,
        cand_entity: NormalizedEntity,
        baseline: NormalizedApiSchema,
        candidate: NormalizedApiSchema,
        integrations: List[ClientIntegration],
    ) -> Tuple[List[Finding], int, int, int]:
        findings: List[Finding] = []
        evals = 0
        breaking_count = 0
        non_breaking_count = 0

        # Check removed properties
        for prop_name, base_prop in base_entity.properties.items():
            evals += 1
            if prop_name not in cand_entity.properties:
                breaking_count += 1
                affected = self._cross_reference_field(entity_name, prop_name, integrations)
                severity = Severity.CRITICAL if affected else Severity.MAJOR
                finding = self._build_finding(
                    rule_id="API_BREAKING_FIELD_REMOVED",
                    severity=severity,
                    category="API Breaking Change",
                    title=f"Breaking Change: Property '{prop_name}' Removed from '{entity_name}'",
                    description=(
                        f"Property '{prop_name}' (type: {base_prop.type}) was removed from '{entity_name}'. "
                        "External applications expecting this field in API responses or request payloads will fail."
                    ),
                    remediation=f"Retain property '{prop_name}' in entity '{entity_name}' with Nullable/optional status until formal deprecation.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text,
                    line_number=base_prop.line_number,
                    column_number=base_prop.column_number,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                    technical_details={
                        "entity": entity_name,
                        "property": prop_name,
                        "affectedIntegrations": affected,
                        "baselineType": base_prop.type,
                    },
                    is_derived=bool(affected),
                )
                findings.append(finding)
            else:
                cand_prop = cand_entity.properties[prop_name]

                # Check Incompatible Type Mutation
                if self._is_incompatible_type_change(base_prop.type, cand_prop.type):
                    breaking_count += 1
                    affected = self._cross_reference_field(entity_name, prop_name, integrations)
                    finding = self._build_finding(
                        rule_id="API_BREAKING_TYPE_CHANGED",
                        severity=Severity.CRITICAL if affected else Severity.MAJOR,
                        category="API Breaking Change",
                        title=f"Breaking Change: Type Incompatibility on '{entity_name}.{prop_name}'",
                        description=(
                            f"Property '{prop_name}' type altered from '{base_prop.type}' to '{cand_prop.type}'. "
                            "This incompatible type mutation will trigger client deserialization failures."
                        ),
                        remediation=f"Maintain backwards-compatible type '{base_prop.type}' or expose a versioned V2 entity set.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={
                            "entity": entity_name,
                            "property": prop_name,
                            "baselineType": base_prop.type,
                            "candidateType": cand_prop.type,
                            "affectedIntegrations": affected,
                        },
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

                # Check Max Length Reduction
                if (
                    base_prop.max_length is not None
                    and cand_prop.max_length is not None
                    and cand_prop.max_length < base_prop.max_length
                ):
                    breaking_count += 1
                    affected = self._cross_reference_field(entity_name, prop_name, integrations)
                    finding = self._build_finding(
                        rule_id="API_BREAKING_MAX_LENGTH_DECREASED",
                        severity=Severity.CRITICAL if affected else Severity.MAJOR,
                        category="API Breaking Change",
                        title=f"Breaking Change: MaxLength Decreased on '{entity_name}.{prop_name}'",
                        description=(
                            f"Property '{prop_name}' MaxLength decreased from {base_prop.max_length} to {cand_prop.max_length}. "
                            "Clients transmitting values longer than the new limit will be rejected with HTTP 400."
                        ),
                        remediation=f"Restore MaxLength to >= {base_prop.max_length} or verify all upstream consumers stay within {cand_prop.max_length}.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={
                            "entity": entity_name,
                            "property": prop_name,
                            "baselineMaxLength": base_prop.max_length,
                            "candidateMaxLength": cand_prop.max_length,
                            "affectedIntegrations": affected,
                        },
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

                elif (
                    base_prop.max_length is not None
                    and cand_prop.max_length is not None
                    and cand_prop.max_length > base_prop.max_length
                ):
                    non_breaking_count += 1
                    findings.append(
                        self._build_finding(
                            rule_id="API_NON_BREAKING_MAX_LENGTH_INCREASED",
                            severity=Severity.INFO,
                            category="API Evolution",
                            title=f"MaxLength Expanded on '{entity_name}.{prop_name}'",
                            description=f"Property '{prop_name}' MaxLength increased from {base_prop.max_length} to {cand_prop.max_length}.",
                            remediation="Clients can safely transmit longer values.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=cand_prop.line_number,
                            column_number=cand_prop.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{entity_name}.{prop_name}"],
                            technical_details={"entity": entity_name, "property": prop_name},
                        )
                    )

                # Check Nullable -> Not Nullable (Required Added)
                if base_prop.nullable and not cand_prop.nullable:
                    breaking_count += 1
                    affected = self._cross_reference_field(entity_name, prop_name, integrations)
                    finding = self._build_finding(
                        rule_id="API_BREAKING_REQUIRED_PROPERTY_ADDED",
                        severity=Severity.CRITICAL if affected else Severity.MAJOR,
                        category="API Breaking Change",
                        title=f"Breaking Change: Field Made Mandatory on '{entity_name}.{prop_name}'",
                        description=(
                            f"Field '{prop_name}' in entity '{entity_name}' was converted from optional (nullable) to required (not null). "
                            "Clients omitting this field in POST/PUT/PATCH payloads will fail validation."
                        ),
                        remediation=f"Keep property '{prop_name}' nullable (Nullable=true) or define default values in database table.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={"entity": entity_name, "property": prop_name, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

                # Check Enum restriction
                if base_prop.enums and cand_prop.enums:
                    b_set = set(base_prop.enums)
                    c_set = set(cand_prop.enums)
                    removed_e = b_set - c_set
                    added_e = c_set - b_set
                    if removed_e:
                        breaking_count += 1
                        affected = self._cross_reference_field(entity_name, prop_name, integrations)
                        finding = self._build_finding(
                            rule_id="API_BREAKING_ENUM_RESTRICTED",
                            severity=Severity.CRITICAL if affected else Severity.MAJOR,
                            category="API Breaking Change",
                            title=f"Breaking Change: Allowed Enum Values Restricted on '{entity_name}.{prop_name}'",
                            description=(
                                f"Property '{prop_name}' restricted allowed enum values. "
                                f"Removed values: {sorted(list(removed_e))}."
                            ),
                            remediation="Restore removed enum values or update client payloads.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=cand_prop.line_number,
                            column_number=cand_prop.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                            technical_details={
                                "entity": entity_name,
                                "property": prop_name,
                                "removedEnums": sorted(list(removed_e)),
                                "affectedIntegrations": affected,
                            },
                            is_derived=bool(affected),
                        )
                        findings.append(finding)
                    if added_e and not removed_e:
                        non_breaking_count += 1

                # Check Deprecation
                if not base_prop.deprecated and cand_prop.deprecated:
                    affected = self._cross_reference_field(entity_name, prop_name, integrations)
                    finding = self._build_finding(
                        rule_id="API_DEPRECATION_WARNING",
                        severity=Severity.MINOR if affected else Severity.INFO,
                        category="API Lifecycle",
                        title=f"Property Deprecated on '{entity_name}.{prop_name}'",
                        description=f"Property '{prop_name}' in entity '{entity_name}' is marked as deprecated.",
                        remediation="Plan field replacement in client mappings before future major release.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={"entity": entity_name, "property": prop_name, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

        # Check newly added properties in candidate
        for prop_name, cand_prop in cand_entity.properties.items():
            if prop_name not in base_entity.properties:
                if not cand_prop.nullable:
                    # New REQUIRED property added to an existing entity is breaking!
                    breaking_count += 1
                    affected = self._cross_reference_field(entity_name, "*", integrations)
                    finding = self._build_finding(
                        rule_id="API_BREAKING_REQUIRED_PROPERTY_ADDED",
                        severity=Severity.CRITICAL if affected else Severity.MAJOR,
                        category="API Breaking Change",
                        title=f"Breaking Change: Mandatory Property Added '{entity_name}.{prop_name}'",
                        description=(
                            f"New mandatory property '{prop_name}' was added to entity '{entity_name}'. "
                            "Existing clients creating records without this property will fail request validation."
                        ),
                        remediation=f"Make newly added property '{prop_name}' optional or specify default server-side value.",
                        artifact_path=candidate.artifact_path,
                        raw_text=candidate.raw_text,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={"entity": entity_name, "property": prop_name, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)
                else:
                    # Optional property added: non-breaking
                    non_breaking_count += 1
                    findings.append(
                        self._build_finding(
                            rule_id="API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED",
                            severity=Severity.INFO,
                            category="API Evolution",
                            title=f"Optional Property Added '{entity_name}.{prop_name}'",
                            description=f"New optional field '{prop_name}' (type: {cand_prop.type}) was added to '{entity_name}'.",
                            remediation="Clients can optionally consume this field when ready.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text,
                            line_number=cand_prop.line_number,
                            column_number=cand_prop.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{entity_name}.{prop_name}"],
                            technical_details={"entity": entity_name, "property": prop_name},
                        )
                    )

        return findings, evals, breaking_count, non_breaking_count

    # -------------------------------------------------------------------------
    # Consumer Integration Registry Matching
    # -------------------------------------------------------------------------

    def _cross_reference_endpoint(self, endpoint_path: str, integrations: List[ClientIntegration]) -> List[str]:
        """Identifies registered integrations that consume a given endpoint path."""
        matched: List[str] = []
        clean_target = endpoint_path.strip().lower()
        base_route = re.sub(r"\([^)]*\)", "", clean_target).rstrip("/")

        for integ in integrations:
            for consumed in integ.consumed_endpoints:
                clean_c = consumed.strip().lower()
                c_base = re.sub(r"\([^)]*\)", "", clean_c).rstrip("/")
                if clean_target == clean_c or base_route == c_base:
                    matched.append(integ.integration_id)
                    break
        return sorted(list(set(matched)))

    def _cross_reference_entity_set(self, entity_set: str, integrations: List[ClientIntegration]) -> List[str]:
        """Identifies registered integrations that consume a given OData entity set."""
        matched: List[str] = []
        clean_es = entity_set.strip().lower()

        for integ in integrations:
            for consumed_es in integ.consumed_entity_sets:
                if clean_es == consumed_es.strip().lower():
                    matched.append(integ.integration_id)
                    break
            # Also check if consumed as an endpoint e.g. /EntitySet
            for ep in integ.consumed_endpoints:
                if ep.strip().strip("/").lower() == clean_es:
                    matched.append(integ.integration_id)
                    break
        return sorted(list(set(matched)))

    def _cross_reference_operation(
        self, endpoint_path: str, method: str, integrations: List[ClientIntegration]
    ) -> List[str]:
        """Identifies integrations consuming a specific HTTP operation on a route."""
        matched: List[str] = []
        clean_ep = endpoint_path.strip().lower()
        base_route = re.sub(r"\([^)]*\)", "", clean_ep).rstrip("/")

        for integ in integrations:
            # Direct operation mapping
            has_op_filter_for_route = False
            for op_ep, methods in integ.consumed_operations.items():
                c_base = re.sub(r"\([^)]*\)", "", op_ep.strip().lower()).rstrip("/")
                if clean_ep == op_ep.strip().lower() or base_route == c_base:
                    has_op_filter_for_route = True
                    if method.upper() in [m.upper() for m in methods]:
                        matched.append(integ.integration_id)
                        break
            # Fallback: if integration consumes endpoint without op restriction, it is impacted
            if (
                not has_op_filter_for_route
                and integ.integration_id not in matched
                and integ.integration_id in self._cross_reference_endpoint(endpoint_path, [integ])
            ):
                matched.append(integ.integration_id)

        return sorted(list(set(matched)))

    def _cross_reference_field(
        self, entity_name: str, field_name: str, integrations: List[ClientIntegration]
    ) -> List[str]:
        """Identifies registered integrations that consume a field within an entity."""
        matched: List[str] = []
        clean_entity = entity_name.strip().lower()
        clean_field = field_name.strip().lower()

        for integ in integrations:
            for reg_entity, fields in integ.consumed_fields.items():
                reg_clean = reg_entity.strip().lower()
                # Check entity name or endpoint match
                if clean_entity == reg_clean or reg_clean in (f"/{clean_entity}", clean_entity.removeprefix("a_")):
                    clean_field_list = [f.strip().lower() for f in fields]
                    if "*" in clean_field_list or clean_field in clean_field_list:
                        matched.append(integ.integration_id)
                        break
        return sorted(list(set(matched)))

    def _is_incompatible_type_change(self, base_type: str, cand_type: str) -> bool:
        """Determines if a data type change is backwards-incompatible."""
        if base_type == cand_type:
            return False

        # OpenAPI simple types check
        if base_type in self.INCOMPATIBLE_TYPE_MAP:
            if cand_type in self.INCOMPATIBLE_TYPE_MAP[base_type]:
                return True

        # OData EDM types check
        if base_type in self.EDM_INCOMPATIBLE_MAP:
            if cand_type in self.EDM_INCOMPATIBLE_MAP[base_type]:
                return True

        # Different types where one is string and other is numeric/boolean
        if "string" in base_type.lower() and ("int" in cand_type.lower() or "bool" in cand_type.lower()):
            return True
        if "int" in base_type.lower() and "string" in cand_type.lower():
            return True

        return False

    # -------------------------------------------------------------------------
    # Finding Builder with Cryptographic Evidence
    # -------------------------------------------------------------------------

    def _build_finding(
        self,
        rule_id: str,
        severity: Severity,
        category: str,
        title: str,
        description: str,
        remediation: str,
        artifact_path: str,
        raw_text: str,
        line_number: int,
        column_number: int,
        artifact_hash: str,
        affected_objects: List[str],
        technical_details: Dict[str, Any],
        is_derived: bool = False,
    ) -> Finding:
        snippet = _extract_context_snippet(raw_text, line_number)
        provenance = ConfidenceClass.RULE_DERIVED if is_derived else ConfidenceClass.VERIFIED
        trust_score = 0.85 if is_derived else 1.0

        ev = Evidence(
            artifact_path=artifact_path,
            line_number=line_number,
            column_number=column_number,
            snippet=snippet,
            sha256=artifact_hash,
            provenance=provenance,
            source_type=TrustLevel.CUSTOMER_EVIDENCE,
            trust_score=trust_score,
        )

        return Finding(
            rule_id=rule_id,
            severity=severity,
            category=category,
            title=title,
            description=description,
            confidence=provenance,
            confidence_score=trust_score,
            remediation=remediation,
            evidence=[ev],
            technical_details=technical_details,
            affected_objects=affected_objects,
        )
