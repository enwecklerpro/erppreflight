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
from src.core.contracts import (
    ContractModel, InputContract, InputFormat, RuleSpec, insufficient, rule_catalog,
)
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
from src.core.exceptions import EngineInputError, SecurityViolationError
from src.parsers.json_input import MAX_JSON_DEPTH, json_nesting_depth
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
    pointer: Optional[str] = None


class NormalizedEntity(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    properties: Dict[str, NormalizedProperty] = Field(default_factory=dict)
    keys: List[str] = Field(default_factory=list)
    navigation_properties: List[str] = Field(default_factory=list)
    line_number: Optional[int] = None
    column_number: Optional[int] = None
    pointer: Optional[str] = None


class NormalizedParameter(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str
    in_location: str = "query"  # query, path, header, body, formData
    required: bool = False
    type: str = "string"
    format: Optional[str] = None
    schema_ref: Optional[str] = None
    enums: List[str] = Field(default_factory=list)
    line_number: Optional[int] = None
    column_number: Optional[int] = None
    pointer: Optional[str] = None


class NormalizedResponse(BaseModel):
    """One documented response of an operation: its body schema reduced to top-level properties."""

    model_config = ConfigDict(extra="ignore")

    status: str
    schema_ref: Optional[str] = None  # component / definition name when the body schema is a $ref
    properties: Dict[str, str] = Field(default_factory=dict)  # property name -> type
    property_pointers: Dict[str, str] = Field(default_factory=dict)
    pointer: Optional[str] = None


class NormalizedOperation(BaseModel):
    model_config = ConfigDict(extra="ignore")

    method: str
    operation_id: Optional[str] = None
    parameters: Dict[str, NormalizedParameter] = Field(default_factory=dict)
    request_body_schema: Optional[str] = None
    request_body_required: bool = False
    responses: Dict[str, str] = Field(default_factory=dict)
    response_shapes: Dict[str, NormalizedResponse] = Field(default_factory=dict)
    # Security requirement alternatives ("scheme" or "scheme:scope" per requirement); None = inherits global.
    security: Optional[List[List[str]]] = None
    deprecated: bool = False
    line_number: Optional[int] = None
    column_number: Optional[int] = None
    pointer: Optional[str] = None


class NormalizedEndpoint(BaseModel):
    model_config = ConfigDict(extra="ignore")

    path: str
    operations: Dict[str, NormalizedOperation] = Field(default_factory=dict)
    line_number: Optional[int] = None
    column_number: Optional[int] = None
    pointer: Optional[str] = None


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
    # OpenAPI security: scheme name -> canonical definition; global requirement alternatives.
    security_schemes: Dict[str, Dict[str, Any]] = Field(default_factory=dict)
    global_security: List[List[str]] = Field(default_factory=list)
    role: str = ""  # "baseline" | "candidate"
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


def _ptr(token: str) -> str:
    """RFC 6901 reference-token escaping."""
    return str(token).replace("~", "~0").replace("/", "~1")


def _resolve_local_ref(doc: Dict[str, Any], ref: Any, depth: int = 0) -> Any:
    """Resolves a local '#/…' $ref (bounded depth, no remote references)."""
    if not isinstance(ref, str) or not ref.startswith("#/") or depth > 8:
        return None
    node: Any = doc
    for token in ref[2:].split("/"):
        token = token.replace("~1", "/").replace("~0", "~")
        if not isinstance(node, dict) or token not in node:
            return None
        node = node[token]
    if isinstance(node, dict) and "$ref" in node:
        return _resolve_local_ref(doc, node["$ref"], depth + 1)
    return node


def _ref_name(ref: Any) -> Optional[str]:
    if isinstance(ref, str) and ref.startswith("#/"):
        return ref.rsplit("/", 1)[-1].replace("~1", "/").replace("~0", "~")
    return None


def _response_shape(status: str, resp: Any, doc: Dict[str, Any], pointer: str, is_swagger_2: bool) -> "NormalizedResponse":
    """Top-level body properties of one response (object, or array items), following local $refs."""
    shape = NormalizedResponse(status=status, pointer=pointer)
    if not isinstance(resp, dict):
        return shape
    if "$ref" in resp:
        resp = _resolve_local_ref(doc, resp["$ref"]) or {}
    body: Any = None
    body_ptr = pointer
    if is_swagger_2:
        body = resp.get("schema")
        body_ptr = f"{pointer}/schema"
    else:
        content = resp.get("content")
        if isinstance(content, dict) and content:
            media = "application/json" if "application/json" in content else sorted(content)[0]
            media_obj = content.get(media)
            if isinstance(media_obj, dict):
                body = media_obj.get("schema")
                body_ptr = f"{pointer}/content/{_ptr(media)}/schema"
    if not isinstance(body, dict):
        return shape
    if body.get("type") == "array" and isinstance(body.get("items"), dict):
        body = body["items"]
        body_ptr = f"{body_ptr}/items"
    if "$ref" in body:
        shape.schema_ref = _ref_name(body["$ref"])
        ref = str(body["$ref"])
        body_ptr = ref[1:] if ref.startswith("#") else body_ptr
        body = _resolve_local_ref(doc, body["$ref"]) or {}
    props = body.get("properties") if isinstance(body, dict) else None
    if isinstance(props, dict):
        for name, definition in props.items():
            ptype = definition.get("type", "object" if "$ref" in definition else "string") if isinstance(definition, dict) else "string"
            shape.properties[str(name)] = str(ptype)
            shape.property_pointers[str(name)] = f"{body_ptr}/properties/{_ptr(str(name))}"
    return shape


def _security_requirements(value: Any) -> List[List[str]]:
    """Security requirement alternatives as sorted 'scheme' / 'scheme:scope' lists (deterministic)."""
    out: List[List[str]] = []
    if not isinstance(value, list):
        return out
    for requirement in value:
        if not isinstance(requirement, dict):
            continue
        items: List[str] = []
        for scheme, scopes in requirement.items():
            items.append(str(scheme))
            if isinstance(scopes, list):
                items.extend(f"{scheme}:{scope}" for scope in scopes)
        out.append(sorted(items))
    return sorted(out)


def _canonical_security_scheme(definition: Dict[str, Any], pointer: str) -> Dict[str, Any]:
    flows = definition.get("flows") if isinstance(definition.get("flows"), dict) else {}
    canonical: Dict[str, Any] = {
        "type": str(definition.get("type", "")),
        "scheme": str(definition.get("scheme", "")).lower(),
        "in": str(definition.get("in", "")),
        "name": str(definition.get("name", "")),
        "flow": str(definition.get("flow", "")),
        "flows": sorted(str(f) for f in flows),
        "tokenUrl": str(definition.get("tokenUrl", "")),
        "pointer": pointer,
    }
    return canonical


def _count_categories(findings: List["Finding"]) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for f in findings:
        if "BREAKING" in f.rule_id and "NON_BREAKING" not in f.rule_id:
            cat = str(f.technical_details.get("changeCategory") or f.rule_id)
            out[cat] = out.get(cat, 0) + 1
    return dict(sorted(out.items()))


def _security_tightened(base: List[List[str]], cand: List[List[str]]) -> bool:
    """True when a consumer that satisfied the baseline requirement may fail the candidate one: the API became
    protected, or a baseline alternative (scheme + scopes) is no longer accepted."""
    if base == cand:
        return False
    if not base:
        return bool(cand)
    if not cand:
        return False  # became public: not breaking for authenticated consumers
    cand_set = {tuple(a) for a in cand}
    return any(tuple(a) not in cand_set for a in base)


_CHANGE_CATEGORIES: Dict[str, str] = {
    "API_BREAKING_ENDPOINT_REMOVED": "api-path-removed",
    "API_BREAKING_OPERATION_REMOVED": "api-operation-removed",
    "API_BREAKING_ENTITYSET_REMOVED": "edmx-entity-set-removed",
    "API_BREAKING_MAX_LENGTH_DECREASED": "max-length-decreased",
    "API_BREAKING_PARAM_REMOVED": "request-parameter-removed",
    "API_BREAKING_PARAM_RENAMED": "request-parameter-renamed",
    "API_BREAKING_RESPONSE_PROPERTY_REMOVED": "response-property-removed",
    "API_BREAKING_NAVIGATION_REMOVED": "edmx-navigation-property-removed",
    "API_BREAKING_KEY_CHANGED": "edmx-entity-key-changed",
    "API_DEPRECATION_WARNING": "deprecated",
    "API_NON_BREAKING_ENDPOINT_ADDED": "api-path-added",
    "API_NON_BREAKING_OPERATION_ADDED": "api-operation-added",
    "API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED": "optional-property-added",
    "API_NON_BREAKING_ENUM_EXPANDED": "enum-value-added",
    "API_NON_BREAKING_MAX_LENGTH_INCREASED": "max-length-increased",
}


def _change_category(rule_id: str, d: Dict[str, Any], spec: Optional["NormalizedApiSchema"]) -> str:
    """Stable, oasdiff-style change category id for a finding (technical_details.changeCategory)."""
    odata = bool(spec is not None and spec.schema_type.startswith("ODATA"))
    param = "parameter" in d
    if rule_id in _CHANGE_CATEGORIES:
        return _CHANGE_CATEGORIES[rule_id]
    if rule_id == "API_BREAKING_ENTITY_REMOVED":
        return "edmx-entity-type-removed" if odata else "api-schema-removed"
    if rule_id == "API_BREAKING_FIELD_REMOVED":
        return "edmx-property-removed" if odata else "schema-property-removed"
    if rule_id == "API_BREAKING_TYPE_CHANGED":
        return "request-parameter-type-changed" if param else "property-type-changed"
    if rule_id == "API_BREAKING_FORMAT_CHANGED":
        return "request-parameter-format-changed" if param else "property-format-changed"
    if rule_id == "API_BREAKING_ENUM_RESTRICTED":
        return "request-parameter-enum-value-removed" if param else "enum-value-removed"
    if rule_id == "API_BREAKING_REQUIRED_PARAM_ADDED":
        return "request-parameter-became-required" if d.get("changeKind") == "BECAME_REQUIRED" else "new-required-request-parameter"
    if rule_id == "API_BREAKING_REQUIRED_PROPERTY_ADDED":
        kind = d.get("changeKind")
        if kind == "BODY_BECAME_REQUIRED":
            return "request-body-became-required"
        if kind == "BECAME_NON_NULLABLE":
            return "property-became-non-nullable"
        return "new-required-property"
    if rule_id == "API_BREAKING_RESPONSE_STATUS_REMOVED":
        return "response-success-status-removed" if d.get("successStatus") else "response-non-success-status-removed"
    if rule_id == "API_BREAKING_SECURITY_CHANGED":
        return str(d.get("securityChange") or "security-changed")
    return rule_id.lower().replace("_", "-")


def _element_pointer(spec: "NormalizedApiSchema", d: Dict[str, Any]) -> Optional[str]:
    """RFC 6901 JSON pointer (OpenAPI) or XPath-style locator (EDMX) of the element a finding is about."""
    if spec.schema_type.startswith("ODATA"):
        ent = d.get("entity")
        if d.get("entitySet"):
            return f"//EntitySet[@Name='{d['entitySet']}']"
        if ent and d.get("navigationProperty"):
            return f"//EntityType[@Name='{ent}']/NavigationProperty[@Name='{d['navigationProperty']}']"
        if ent and d.get("keyChange"):
            return f"//EntityType[@Name='{ent}']/Key"
        if ent and d.get("property") and d.get("property") != "*":
            return f"//EntityType[@Name='{ent}']/Property[@Name='{d['property']}']"
        if ent:
            return f"//EntityType[@Name='{ent}']"
        if d.get("enum"):
            return f"//EnumType[@Name='{d['enum']}']"
        ep = spec.endpoints.get(d.get("endpoint") or "")
        return ep.pointer if ep else None
    ep_path = d.get("endpoint")
    if ep_path:
        ep = spec.endpoints.get(ep_path)
        base = ep.pointer if ep and ep.pointer else f"/paths/{_ptr(ep_path)}"
        method = d.get("method")
        if not method:
            return base
        op = ep.operations.get(method) if ep else None
        if op is None:
            return f"{base}/{str(method).lower()}"
        op_ptr = op.pointer or f"{base}/{str(method).lower()}"
        param = op.parameters.get(d.get("parameter") or "")
        if param is not None and param.pointer:
            return param.pointer
        status = d.get("status")
        if status:
            shape = op.response_shapes.get(status)
            if shape is not None and d.get("responseProperty"):
                return shape.property_pointers.get(d["responseProperty"]) or shape.pointer
            return shape.pointer if shape is not None else f"{op_ptr}/responses/{_ptr(status)}"
        if d.get("security"):
            return f"{op_ptr}/security"
        if d.get("changeKind") == "BODY_BECAME_REQUIRED":
            return f"{op_ptr}/requestBody"
        return op_ptr
    ent = spec.entities.get(d.get("entity") or "")
    if ent is not None:
        prop = ent.properties.get(d.get("property") or "")
        if prop is not None and prop.pointer:
            return prop.pointer
        return ent.pointer
    if d.get("globalSecurity"):
        return "/security"
    return None


# =============================================================================
# Engine Implementation
# =============================================================================


# ==== ENGINE CONTRACT (rule catalog + input contract) ====
def _api(code: str, title: str, sev: Severity, remediation: str) -> RuleSpec:
    return RuleSpec(code, title, sev, remediation, "API Compatibility")


RULES = rule_catalog(
    _api("API_BREAKING_ENDPOINT_REMOVED", "Endpoint removed", Severity.CRITICAL,
         "Restore the path or publish a new major API version; migrate every consumer in the integration "
         "registry before retiring the old path."),
    _api("API_BREAKING_OPERATION_REMOVED", "Operation removed", Severity.CRITICAL,
         "Keep the HTTP operation (deprecate first) or version the API; update consumers before removal."),
    _api("API_BREAKING_ENTITYSET_REMOVED", "OData entity set removed", Severity.CRITICAL,
         "Re-expose the entity set in the service definition / binding or version the OData service."),
    _api("API_BREAKING_ENTITY_REMOVED", "OData entity type removed", Severity.CRITICAL,
         "Restore the entity type or introduce a new service version; adapt consumer mappings."),
    _api("API_BREAKING_FIELD_REMOVED", "Property / field removed", Severity.CRITICAL,
         "Keep the property (mark deprecated) until all consumers stop reading it, or version the API."),
    _api("API_BREAKING_TYPE_CHANGED", "Incompatible type change", Severity.CRITICAL,
         "Revert to the previous type or add a new property with the new type; incompatible conversions break "
         "deserialisation in consumers."),
    _api("API_BREAKING_REQUIRED_PARAM_ADDED", "New required parameter", Severity.MAJOR,
         "Make the new parameter optional with a server-side default, or version the operation."),
    _api("API_BREAKING_REQUIRED_PROPERTY_ADDED", "New required property", Severity.MAJOR,
         "Make the property optional (nullable / default value) so existing payloads remain valid."),
    _api("API_BREAKING_ENUM_RESTRICTED", "Enum values removed", Severity.MAJOR,
         "Keep the removed enum values accepted (map them server-side) or version the API."),
    _api("API_BREAKING_MAX_LENGTH_DECREASED", "Maximum length decreased", Severity.MAJOR,
         "Keep the previous MaxLength; shorter limits reject existing consumer data."),
    _api("API_DEPRECATION_WARNING", "Element marked deprecated", Severity.MINOR,
         "Plan consumer migration to the successor before the announced removal date."),
    _api("API_NON_BREAKING_ENDPOINT_ADDED", "Endpoint added", Severity.INFO,
         "No action for existing consumers; document the new endpoint."),
    _api("API_NON_BREAKING_OPERATION_ADDED", "Operation added", Severity.INFO,
         "No action for existing consumers; document the new operation."),
    _api("API_NON_BREAKING_OPTIONAL_PROPERTY_ADDED", "Optional property added", Severity.INFO,
         "No action; consumers must tolerate unknown properties (tolerant reader)."),
    _api("API_NON_BREAKING_ENUM_EXPANDED", "Enum values added", Severity.INFO,
         "Verify consumers handle unknown enum values gracefully."),
    _api("API_NON_BREAKING_MAX_LENGTH_INCREASED", "Maximum length increased", Severity.INFO,
         "Check that consumers storing the value have sufficient field length."),
    # oasdiff-level categories (request / response / security / OData structure)
    _api("API_BREAKING_PARAM_REMOVED", "Request parameter removed", Severity.MAJOR,
         "Keep accepting the parameter (ignore it server-side) until every consumer stopped sending it, or version "
         "the operation; path parameters change the URL template."),
    _api("API_BREAKING_PARAM_RENAMED", "Required request parameter renamed", Severity.MAJOR,
         "Accept the old parameter name as an alias (or keep both) and deprecate it before removal; consumers "
         "still send the previous name."),
    _api("API_BREAKING_FORMAT_CHANGED", "Type format changed", Severity.MAJOR,
         "Keep the previous format (e.g. date vs date-time, int32 vs int64) or introduce a new parameter / "
         "property; consumers serialise and validate against the old format."),
    _api("API_BREAKING_RESPONSE_PROPERTY_REMOVED", "Response property removed", Severity.MAJOR,
         "Keep returning the property (mark it deprecated) until consumers no longer read it, or version the "
         "response."),
    _api("API_BREAKING_RESPONSE_STATUS_REMOVED", "Response status code removed", Severity.MAJOR,
         "Keep the documented status code or version the operation; consumers branch on the success status."),
    _api("API_BREAKING_SECURITY_CHANGED", "Security scheme or requirement changed", Severity.CRITICAL,
         "Keep the previous authentication scheme / scopes available in parallel, update the Communication "
         "Arrangement / OAuth clients of every consumer before switching, then retire the old scheme."),
    _api("API_BREAKING_NAVIGATION_REMOVED", "OData navigation property removed", Severity.MAJOR,
         "Restore the navigation property (association) or version the service; consumers using $expand or "
         "navigation paths fail."),
    _api("API_BREAKING_KEY_CHANGED", "OData entity key changed", Severity.CRITICAL,
         "Keep the entity key stable; a key change breaks every key-based read/update URL. Introduce a new "
         "entity type / service version instead."),
)


class ApiChangeInput(ContractModel):
    """A bundle {'baseline', 'candidate', 'integrations'} or one OpenAPI document / integration registry."""
    signal_fields = ("baseline", "candidate", "openapi", "swagger", "paths", "integrations")
    signal_message = (
        "API Change Guard requires a baseline AND a candidate specification ('baseline' / 'candidate' keys, or "
        "artifacts named *baseline* / *candidate*)."
    )


def _api_xml_check(root: Any) -> Optional[str]:
    local = root.tag.split("}")[-1] if "}" in root.tag else root.tag
    if local in ("Edmx", "DataServices", "Schema", "definitions"):
        return None
    return f"XML root <{local[:60]}> is not an OData EDMX (or WSDL) document."


def _api_text_check(text: str) -> Optional[str]:
    head = text.lstrip()[:4000]
    if re.search(r"^(openapi|swagger)\s*:", head, re.M):
        return None
    return "text payload is not an OpenAPI / Swagger YAML document (no 'openapi:' or 'swagger:' key)."


INPUT_CONTRACT = InputContract(
    formats=(InputFormat.JSON, InputFormat.XML, InputFormat.TEXT),
    summary=(
        "Two API specifications of the same service — baseline (current) and candidate (target release): "
        "OpenAPI 2/3 (JSON or YAML) or OData EDMX V2/V4 XML — supplied as {'baseline': …, 'candidate': …} in "
        "raw_content / configuration or as artifacts named *baseline* / *candidate*; optional 'integrations' "
        "registry for consumer impact."
    ),
    required=("baseline specification", "candidate specification"),
    json_model=ApiChangeInput,
    xml_check=_api_xml_check,
    text_check=_api_text_check,
)


# ==== END ENGINE CONTRACT ====


@register_engine
class ApiChangeEngine(BaseEngine):
    """
    API Change Guard Engine (Feature 27).
    Parses and diffs OpenAPI 2.0/3.0 and OData EDMX V2/V4 schemas.
    Cross-references breaking changes with Project Integration Registry.
    """

    engine_type = EngineType.API_CHANGE_GUARD
    rule_prefix = "API"
    finding_codes = RULES
    input_contract = INPUT_CONTRACT
    name = "API Change Guard"
    description = "OData, SOAP, RFC compatibility and deprecation impact scanner"
    version = "2.1.0"
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

        baseline_schema, candidate_schema, integrations, provenance = parse_result
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
            "baselineArtifact": baseline_schema.artifact_path,
            "candidateArtifact": candidate_schema.artifact_path,
            "candidateSha256": candidate_schema.artifact_hash,
            "breakingByCategory": _count_categories(classified_findings),
            **provenance,
        }
        additional_metrics.setdefault("baselineSha256", baseline_schema.artifact_hash)

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
    ) -> Tuple[NormalizedApiSchema, NormalizedApiSchema, List[ClientIntegration], Dict[str, Any]] | Finding:
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

        # D. Check attached artifacts. Roles are explicit: an artifact is the baseline / candidate only when
        #    its file name says so (no positional guessing — swapping them would invert every verdict).
        unassigned: List[str] = []
        if not baseline_raw or not candidate_raw or request.artifacts:
            for art in request.artifacts:
                art_content = art.raw_content or ""
                if not art_content:
                    continue
                file_lower = (art.file_name or "").lower()
                if "baseline" in file_lower and not baseline_raw:
                    baseline_raw = art_content
                    baseline_path = art.file_name
                elif "candidate" in file_lower and not candidate_raw:
                    candidate_raw = art_content
                    candidate_path = art.file_name
                elif "baseline" in file_lower or "candidate" in file_lower:
                    continue
                elif "integration" not in file_lower:
                    unassigned.append(art.file_name)
                elif "integration" in file_lower:
                    try:
                        p = json.loads(art_content)
                        items = p if isinstance(p, list) else p.get("integrations", [])
                        for item in items:
                            integrations.append(ClientIntegration.model_validate(item))
                    except Exception:
                        pass

        # E. Stored project baseline (sent by the API from the api_baselines registry). An explicitly selected
        #    baseline always wins; the project's ACTIVE baseline is used when the input carries no baseline itself.
        baseline_source = "INPUT" if baseline_raw is not None else None
        stored_meta: Dict[str, Any] = {}
        stored = request.configuration.get("stored_baseline")
        if isinstance(stored, dict) and isinstance(stored.get("content"), str) and stored["content"].strip():
            expected = str(stored.get("sha256") or "").lower()
            actual = EvidenceEngine.compute_sha256(stored["content"])
            if expected and expected != actual:
                raise EngineInputError(
                    f"{self.rule_prefix}_INVALID_INPUT",
                    f"Stored API baseline '{stored.get('name')}' failed its integrity check (expected SHA-256 "
                    f"{expected}, got {actual}); the baseline object was modified after it was registered.",
                    details={"baselineId": stored.get("id")},
                )
            if stored.get("explicit") or baseline_raw is None:
                baseline_raw = stored["content"]
                baseline_path = f"api-baseline:{stored.get('name') or 'baseline'}@{stored.get('version') or 'unversioned'}"
                baseline_source = "STORED_BASELINE"
                stored_meta = {
                    "baselineId": stored.get("id"),
                    "baselineName": stored.get("name"),
                    "baselineVersionLabel": stored.get("version"),
                    "baselineSha256": actual,
                    "baselineSelection": "EXPLICIT" if stored.get("explicit") else "ACTIVE",
                }

        # F. A standalone specification in raw_content is the candidate when the baseline comes from elsewhere
        #    (stored baseline or configuration).
        if candidate_raw is None and baseline_raw is not None and request.raw_content and request.raw_content.strip():
            if self._is_standalone_spec(request.raw_content):
                candidate_raw = request.raw_content
                candidate_path = str(
                    request.configuration.get("sourceFileName") or request.artifact_s3_key or "candidate_spec"
                )

        # Both specifications are mandatory inputs (explicit contract): no verdict without them.
        missing = [name for name, val in (("baseline", baseline_raw), ("candidate", candidate_raw)) if val is None]
        if missing:
            hint = (
                f" Unassigned artifacts: {', '.join(sorted(unassigned))} — name them '*baseline*' / '*candidate*'."
                if unassigned else ""
            )
            raise EngineInputError(
                f"{self.rule_prefix}_INSUFFICIENT_INPUT",
                "API Change Guard requires BOTH a baseline and a candidate API specification "
                f"(missing: {', '.join(missing)}). Supply them as JSON keys 'baseline' / 'candidate' "
                "(raw_content bundle or configuration) or as artifacts whose file names contain 'baseline' / "
                "'candidate' (OpenAPI 2/3 JSON/YAML or OData EDMX XML)." + hint,
                details={"missing": missing},
            )

        # Normalize raw inputs to string representations
        base_str = baseline_raw if isinstance(baseline_raw, str) else json.dumps(baseline_raw, indent=2)
        cand_str = candidate_raw if isinstance(candidate_raw, str) else json.dumps(candidate_raw, indent=2)

        # Parse both specifications; syntax / format errors are input errors, never verdicts.
        baseline_schema = self._parse_spec_or_raise(base_str, baseline_path, "baseline")
        candidate_schema = self._parse_spec_or_raise(cand_str, candidate_path, "candidate")
        baseline_schema.role = "baseline"
        candidate_schema.role = "candidate"
        provenance = {"baselineSource": baseline_source or "INPUT", **stored_meta}
        if not (
            baseline_schema.endpoints or baseline_schema.entity_sets or baseline_schema.entities
            or baseline_schema.operations_standalone
        ):
            raise EngineInputError(
                f"{self.rule_prefix}_INVALID_INPUT",
                f"Baseline specification ({baseline_path}) defines no paths/operations, entity types or entity "
                "sets; there is no API surface to compare.",
            )

        return baseline_schema, candidate_schema, integrations, provenance

    def _is_standalone_spec(self, text: str) -> bool:
        """True for one OpenAPI / Swagger (JSON or YAML) or OData EDMX document (not a baseline/candidate bundle)."""
        clean = text.strip()
        if clean.startswith("<"):
            return "Edmx" in clean[:4000] or "edmx" in clean[:4000]
        try:
            parsed = self._try_parse_json_or_yaml(clean)
        except ValueError:
            return False
        return isinstance(parsed, dict) and "baseline" not in parsed and "candidate" not in parsed and any(
            k in parsed for k in ("openapi", "swagger", "paths")
        )

    def _parse_spec_or_raise(self, text: str, path: str, role: str) -> "NormalizedApiSchema":
        try:
            return self._parse_api_schema(text, path)
        except EngineInputError:
            raise
        except SecurityViolationError:
            raise EngineInputError(
                f"{self.rule_prefix}_INVALID_INPUT",
                f"The {role} specification ({path}) was rejected: Malicious XML (Entities/DTD forbidden).",
            ) from None
        except (ValueError, KeyError, TypeError, AttributeError, RecursionError) as exc:
            reason = str(exc) if isinstance(exc, ValueError) and len(str(exc)) < 300 else "unrecognised structure"
            raise EngineInputError(
                f"{self.rule_prefix}_PARSE_ERROR",
                f"The {role} specification ({path}) is not a valid OpenAPI 2/3 JSON/YAML or OData EDMX document: "
                f"{reason}",
                details={"specification": role},
            ) from None

    def _try_parse_json_or_yaml(self, text: str) -> Optional[Dict[str, Any]]:
        """Safely attempts to parse text as JSON, falling back to safe YAML."""
        if not text:
            return None
        clean = text.strip()
        if clean.startswith("{") or clean.startswith("["):
            if json_nesting_depth(clean) > MAX_JSON_DEPTH:
                raise ValueError(f"JSON nesting exceeds the supported depth of {MAX_JSON_DEPTH} levels.")
            try:
                return json.loads(clean)
            except (ValueError, RecursionError):
                return None
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
            if not any(k in parsed_dict for k in ("openapi", "swagger", "paths")):
                raise ValueError("document has no 'openapi' / 'swagger' version or 'paths' section.")
            return self._parse_openapi(parsed_dict, clean, artifact_path, art_hash)

        raise ValueError("Unrecognized API specification format. Expected OData EDMX XML or OpenAPI JSON/YAML.")

    def _parse_odata_edmx(self, xml_text: str, artifact_path: str, artifact_hash: str) -> NormalizedApiSchema:
        """Parses OData EDMX V2 or V4 XML with exact line and column numbers."""
        root = SafeXmlParser.parse_string(xml_text)
        root_local = root.tag.split("}")[-1] if "}" in root.tag else root.tag
        if root_local not in ("Edmx", "DataServices", "Schema"):
            raise ValueError(f"XML root element <{root_local[:60]}> is not an OData EDMX document.")

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
                        pointer=f"//EntityType[@Name='{entity_name}']",
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
                                pointer=f"//EntityType[@Name='{entity_name}']/Property[@Name='{p_name}']",
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
                        pointer=f"//EntitySet[@Name='{set_name}']",
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
        """Parses OpenAPI 2.0 or 3.x with token line tracking and RFC 6901 JSON pointers for every element."""
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
        schemas_root = "/definitions" if is_swagger_2 else "/components/schemas"
        schemas_dict = (doc.get("definitions") or {}) if is_swagger_2 else ((doc.get("components") or {}).get("schemas") or {})
        if not isinstance(schemas_dict, dict):
            schemas_dict = {}

        # 0. Security schemes + global security requirement
        schemes_root = "/securityDefinitions" if is_swagger_2 else "/components/securitySchemes"
        schemes = (doc.get("securityDefinitions") or {}) if is_swagger_2 else ((doc.get("components") or {}).get("securitySchemes") or {})
        if isinstance(schemes, dict):
            for name, definition in schemes.items():
                if isinstance(definition, dict):
                    schema.security_schemes[str(name)] = _canonical_security_scheme(definition, f"{schemes_root}/{_ptr(str(name))}")
        schema.global_security = _security_requirements(doc.get("security"))

        # 1. Parse Paths and Operations
        paths = doc.get("paths") or {}
        for path_str, path_item in paths.items():
            if not isinstance(path_item, dict):
                continue
            p_line, p_col, _ = _locate_token_in_text(raw_text, path_str)
            path_ptr = f"/paths/{_ptr(path_str)}"
            endpoint = NormalizedEndpoint(path=path_str, line_number=p_line, column_number=p_col, pointer=path_ptr)

            # Common path-level parameters
            path_params: Dict[str, NormalizedParameter] = {}
            if "parameters" in path_item and isinstance(path_item["parameters"], list):
                for idx, p in enumerate(path_item["parameters"]):
                    if isinstance(p, dict):
                        norm_p = self._normalize_openapi_param(p, raw_text, p_line, f"{path_ptr}/parameters/{idx}", doc)
                        path_params[norm_p.name] = norm_p

            for method_str in ("get", "post", "put", "delete", "patch", "head", "options"):
                if method_str in path_item and isinstance(path_item[method_str], dict):
                    op_dict = path_item[method_str]
                    op_ptr = f"{path_ptr}/{method_str}"
                    op_line, op_col, _ = _locate_token_in_text(raw_text, method_str, start_line=p_line)
                    operation = NormalizedOperation(
                        method=method_str.upper(),
                        operation_id=op_dict.get("operationId"),
                        deprecated=bool(op_dict.get("deprecated")),
                        line_number=op_line,
                        column_number=op_col,
                        pointer=op_ptr,
                    )
                    # Inherit path params
                    operation.parameters.update(path_params)

                    # Operation parameters
                    if "parameters" in op_dict and isinstance(op_dict["parameters"], list):
                        for idx, p in enumerate(op_dict["parameters"]):
                            if isinstance(p, dict):
                                norm_p = self._normalize_openapi_param(p, raw_text, op_line, f"{op_ptr}/parameters/{idx}", doc)
                                operation.parameters[norm_p.name] = norm_p

                    # OpenAPI 3 requestBody
                    if "requestBody" in op_dict and isinstance(op_dict["requestBody"], dict):
                        rb = op_dict["requestBody"]
                        operation.request_body_required = bool(rb.get("required"))

                    # Responses (status codes and top-level body properties)
                    responses = op_dict.get("responses")
                    if isinstance(responses, dict):
                        for status_code, resp in responses.items():
                            status_key = str(status_code)
                            operation.responses[status_key] = str((resp or {}).get("description", "")) if isinstance(resp, dict) else ""
                            operation.response_shapes[status_key] = _response_shape(
                                status_key, resp, doc, f"{op_ptr}/responses/{_ptr(status_key)}", is_swagger_2
                            )

                    if "security" in op_dict:
                        operation.security = _security_requirements(op_dict.get("security"))

                    endpoint.operations[method_str.upper()] = operation

            schema.endpoints[path_str] = endpoint

        # 2. Parse Definitions (OpenAPI 2) or Components Schemas (OpenAPI 3)
        for entity_name, entity_def in schemas_dict.items():
            if not isinstance(entity_def, dict):
                continue
            e_line, e_col, _ = _locate_token_in_text(raw_text, entity_name)
            e_ptr = f"{schemas_root}/{_ptr(entity_name)}"
            entity = NormalizedEntity(name=entity_name, line_number=e_line, column_number=e_col, pointer=e_ptr)

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
                    pointer=f"{e_ptr}/properties/{_ptr(prop_name)}",
                )
                entity.properties[prop_name] = prop

            schema.entities[entity_name] = entity

        return schema

    def _normalize_openapi_param(
        self,
        p: Dict[str, Any],
        raw_text: str,
        start_line: int,
        pointer: Optional[str] = None,
        doc: Optional[Dict[str, Any]] = None,
    ) -> NormalizedParameter:
        if "$ref" in p and doc is not None:
            resolved = _resolve_local_ref(doc, p.get("$ref"))
            if isinstance(resolved, dict):
                pointer = str(p.get("$ref"))[1:] if str(p.get("$ref")).startswith("#") else pointer
                p = resolved
        p_name = p.get("name", "")
        p_in = p.get("in", "query")
        p_req = bool(p.get("required", p_in == "path"))
        p_line, p_col, _ = _locate_token_in_text(raw_text, p_name, start_line=start_line)
        p_schema = p.get("schema") if isinstance(p.get("schema"), dict) else {}
        p_type = p.get("type") or p_schema.get("type", "string")
        p_format = p.get("format") or p_schema.get("format")
        raw_enum = p.get("enum") if isinstance(p.get("enum"), list) else p_schema.get("enum")
        return NormalizedParameter(
            name=p_name,
            in_location=p_in,
            required=p_req,
            type=p_type,
            format=p_format,
            enums=[str(e) for e in raw_enum] if isinstance(raw_enum, list) else [],
            line_number=p_line,
            column_number=p_col,
            pointer=pointer,
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
                    raw_text=baseline.raw_text, spec=baseline,
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
                    raw_text=candidate.raw_text, spec=candidate,
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
                    raw_text=baseline.raw_text, spec=baseline,
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
                    raw_text=baseline.raw_text, spec=baseline,
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
                            raw_text=candidate.raw_text, spec=candidate,
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
                            raw_text=candidate.raw_text, spec=candidate,
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

        # ---------------------------------------------------------------------
        # Rule 5: Security schemes & global security requirement (OpenAPI)
        # ---------------------------------------------------------------------
        rules_evaluated += 1
        sec_findings = self._diff_security(baseline, candidate)
        findings.extend(sec_findings)
        breaking_count += len(sec_findings)

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
                    raw_text=baseline.raw_text, spec=baseline,
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
                        raw_text=candidate.raw_text, spec=candidate,
                        line_number=cand_op.line_number,
                        column_number=cand_op.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{method} {ep_path}"] + affected,
                        technical_details={"endpoint": ep_path, "method": method, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

                # Removed / renamed request parameters (oasdiff: request-parameter-removed / -renamed)
                renamed_targets: Set[str] = set()
                added_required = [
                    n for n, cp in cand_op.parameters.items() if n not in base_op.parameters and cp.required
                ]
                for param_name, base_param in base_op.parameters.items():
                    if param_name in cand_op.parameters:
                        continue
                    evals += 1
                    affected = self._cross_reference_operation(ep_path, method, integrations)
                    rename_to = None
                    if base_param.required:
                        rename_to = next(
                            (
                                n for n in added_required
                                if n not in renamed_targets
                                and cand_op.parameters[n].in_location == base_param.in_location
                                and cand_op.parameters[n].type == base_param.type
                            ),
                            None,
                        )
                    if rename_to is not None:
                        renamed_targets.add(rename_to)
                        breaking_count += 1
                        new_param = cand_op.parameters[rename_to]
                        findings.append(self._build_finding(
                            rule_id="API_BREAKING_PARAM_RENAMED",
                            severity=Severity.CRITICAL if affected else Severity.MAJOR,
                            category="API Breaking Change",
                            title=f"Breaking Change: Required Parameter '{param_name}' Renamed to '{rename_to}' on '{method} {ep_path}'",
                            description=(
                                f"Required {base_param.in_location} parameter '{param_name}' ({base_param.type}) no longer exists "
                                f"and a new required {new_param.in_location} parameter '{rename_to}' of the same type was added. "
                                "Consumers still sending the old name fail validation (HTTP 400)."
                            ),
                            remediation=f"Accept '{param_name}' as an alias of '{rename_to}' until every consumer is migrated.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text, spec=candidate,
                            line_number=new_param.line_number,
                            column_number=new_param.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{method} {ep_path}:{param_name}", f"{method} {ep_path}:{rename_to}"] + affected,
                            technical_details={
                                "endpoint": ep_path, "method": method, "parameter": rename_to,
                                "previousName": param_name, "location": base_param.in_location,
                                "baselinePointer": base_param.pointer, "affectedIntegrations": affected,
                            },
                            is_derived=bool(affected),
                        ))
                        continue
                    blocking = base_param.required or base_param.in_location == "path"
                    if blocking:
                        breaking_count += 1
                    findings.append(self._build_finding(
                        rule_id="API_BREAKING_PARAM_REMOVED",
                        severity=(Severity.CRITICAL if affected else Severity.MAJOR) if blocking else Severity.MINOR,
                        category="API Breaking Change",
                        title=f"Breaking Change: {'Required ' if base_param.required else ''}Parameter '{param_name}' Removed from '{method} {ep_path}'",
                        description=(
                            f"{'Required' if base_param.required else 'Optional'} {base_param.in_location} parameter '{param_name}' "
                            f"of '{method} {ep_path}' was removed. Consumers that send it are rejected by strict validation "
                            "or silently lose its effect."
                        ),
                        remediation=f"Keep accepting '{param_name}' (ignored server-side) until consumers stop sending it, or version the operation.",
                        artifact_path=baseline.artifact_path,
                        raw_text=baseline.raw_text, spec=baseline,
                        line_number=base_param.line_number,
                        column_number=base_param.column_number,
                        artifact_hash=baseline.artifact_hash,
                        affected_objects=[f"{method} {ep_path}:{param_name}"] + affected,
                        technical_details={
                            "endpoint": ep_path, "method": method, "parameter": param_name,
                            "required": base_param.required, "location": base_param.in_location,
                            "affectedIntegrations": affected,
                        },
                        is_derived=bool(affected),
                    ))

                # Check parameters: required additions and type mutations
                for param_name, cand_param in cand_op.parameters.items():
                    evals += 1
                    base_param = base_op.parameters.get(param_name)
                    if param_name in renamed_targets:
                        continue

                    # Format change on an otherwise compatible parameter (oasdiff: request-parameter-format-changed)
                    if (
                        base_param is not None
                        and base_param.type == cand_param.type
                        and (base_param.format or None) != (cand_param.format or None)
                    ):
                        breaking_count += 1
                        affected = self._cross_reference_operation(ep_path, method, integrations)
                        findings.append(self._build_finding(
                            rule_id="API_BREAKING_FORMAT_CHANGED",
                            severity=Severity.CRITICAL if affected else Severity.MAJOR,
                            category="API Breaking Change",
                            title=f"Breaking Change: Format of Parameter '{param_name}' Changed on '{method} {ep_path}'",
                            description=(
                                f"Parameter '{param_name}' ({cand_param.type}) changed format from "
                                f"'{base_param.format or 'none'}' to '{cand_param.format or 'none'}'."
                            ),
                            remediation=f"Keep format '{base_param.format or 'none'}' for '{param_name}' or add a new parameter.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text, spec=candidate,
                            line_number=cand_param.line_number,
                            column_number=cand_param.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{method} {ep_path}:{param_name}"] + affected,
                            technical_details={
                                "endpoint": ep_path, "method": method, "parameter": param_name,
                                "baselineFormat": base_param.format, "candidateFormat": cand_param.format,
                                "affectedIntegrations": affected,
                            },
                            is_derived=bool(affected),
                        ))

                    # Enum values removed from a parameter (oasdiff: request-parameter-enum-value-removed)
                    if base_param is not None and base_param.enums and cand_param.enums:
                        removed_values = sorted(set(base_param.enums) - set(cand_param.enums))
                        if removed_values:
                            breaking_count += 1
                            affected = self._cross_reference_operation(ep_path, method, integrations)
                            findings.append(self._build_finding(
                                rule_id="API_BREAKING_ENUM_RESTRICTED",
                                severity=Severity.CRITICAL if affected else Severity.MAJOR,
                                category="API Breaking Change",
                                title=f"Breaking Change: Enum Values Removed from Parameter '{param_name}' on '{method} {ep_path}'",
                                description=f"Parameter '{param_name}' no longer accepts {removed_values}.",
                                remediation="Keep accepting the removed values (map them server-side) or version the operation.",
                                artifact_path=candidate.artifact_path,
                                raw_text=candidate.raw_text, spec=candidate,
                                line_number=cand_param.line_number,
                                column_number=cand_param.column_number,
                                artifact_hash=candidate.artifact_hash,
                                affected_objects=[f"{method} {ep_path}:{param_name}"] + affected,
                                technical_details={
                                    "endpoint": ep_path, "method": method, "parameter": param_name,
                                    "removedEnums": removed_values, "affectedIntegrations": affected,
                                },
                                is_derived=bool(affected),
                            ))

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
                            raw_text=candidate.raw_text, spec=candidate,
                            line_number=cand_param.line_number,
                            column_number=cand_param.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{method} {ep_path}:{param_name}"] + affected,
                            technical_details={
                                "endpoint": ep_path,
                                "method": method,
                                "parameter": param_name,
                                "affectedIntegrations": affected,
                                "changeKind": "ADDED" if base_param is None else "BECAME_REQUIRED",
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
                            raw_text=candidate.raw_text, spec=candidate,
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
                        raw_text=candidate.raw_text, spec=candidate,
                        line_number=cand_op.line_number,
                        column_number=cand_op.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{method} {ep_path}"] + affected,
                        technical_details={"endpoint": ep_path, "method": method, "affectedIntegrations": affected, "changeKind": "BODY_BECAME_REQUIRED"},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

                resp_findings, resp_breaking = self._diff_responses(
                    ep_path, method, base_op, cand_op, baseline, candidate, integrations
                )
                findings.extend(resp_findings)
                breaking_count += resp_breaking
                evals += len(base_op.response_shapes)

                if base_op.security is not None or cand_op.security is not None:
                    evals += 1
                    base_sec = base_op.security if base_op.security is not None else baseline.global_security
                    cand_sec = cand_op.security if cand_op.security is not None else candidate.global_security
                    if _security_tightened(base_sec, cand_sec):
                        breaking_count += 1
                        affected = self._cross_reference_operation(ep_path, method, integrations)
                        findings.append(self._build_finding(
                            rule_id="API_BREAKING_SECURITY_CHANGED",
                            severity=Severity.BLOCKER if affected else Severity.CRITICAL,
                            category="API Security Change",
                            title=f"Breaking Change: Security Requirement Changed on '{method} {ep_path}'",
                            description=(
                                f"The accepted authentication of '{method} {ep_path}' changed from {base_sec or 'none (public)'} "
                                f"to {cand_sec or 'none (public)'}; consumers authenticated with a removed alternative are rejected (HTTP 401/403)."
                            ),
                            remediation="Keep the previous scheme / scopes as an accepted alternative until every consumer switched.",
                            artifact_path=candidate.artifact_path,
                            raw_text=candidate.raw_text, spec=candidate,
                            line_number=cand_op.line_number,
                            column_number=cand_op.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{method} {ep_path}"] + affected,
                            technical_details={
                                "endpoint": ep_path, "method": method, "security": True,
                                "baselineSecurity": base_sec, "candidateSecurity": cand_sec,
                                "securityChange": "operation-security-changed", "affectedIntegrations": affected,
                            },
                            is_derived=bool(affected),
                        ))

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
                        raw_text=candidate.raw_text, spec=candidate,
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
                    raw_text=baseline.raw_text, spec=baseline,
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
                        raw_text=candidate.raw_text, spec=candidate,
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
                        raw_text=candidate.raw_text, spec=candidate,
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
                            raw_text=candidate.raw_text, spec=candidate,
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
                        raw_text=candidate.raw_text, spec=candidate,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={"entity": entity_name, "property": prop_name, "affectedIntegrations": affected, "changeKind": "BECAME_NON_NULLABLE"},
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
                            raw_text=candidate.raw_text, spec=candidate,
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
                        raw_text=candidate.raw_text, spec=candidate,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={"entity": entity_name, "property": prop_name, "affectedIntegrations": affected},
                        is_derived=bool(affected),
                    )
                    findings.append(finding)

        # OData navigation properties removed (edmx-navigation-property-removed)
        for nav_name in base_entity.navigation_properties:
            evals += 1
            if nav_name in cand_entity.navigation_properties:
                continue
            breaking_count += 1
            affected = self._cross_reference_field(entity_name, nav_name, integrations)
            line_no, col_no, _ = _locate_token_in_text(baseline.raw_text, nav_name, start_line=base_entity.line_number or 1)
            findings.append(self._build_finding(
                rule_id="API_BREAKING_NAVIGATION_REMOVED",
                severity=Severity.CRITICAL if affected else Severity.MAJOR,
                category="OData Breaking Change",
                title=f"Breaking Change: Navigation Property '{nav_name}' Removed from '{entity_name}'",
                description=(
                    f"Navigation property '{nav_name}' of entity type '{entity_name}' was removed; $expand={nav_name} and "
                    "navigation URLs of consumers fail."
                ),
                remediation=f"Restore navigation property '{nav_name}' or publish a new service version.",
                artifact_path=baseline.artifact_path,
                raw_text=baseline.raw_text, spec=baseline,
                line_number=line_no or base_entity.line_number,
                column_number=col_no or base_entity.column_number,
                artifact_hash=baseline.artifact_hash,
                affected_objects=[f"{entity_name}.{nav_name}"] + affected,
                technical_details={"entity": entity_name, "navigationProperty": nav_name, "affectedIntegrations": affected},
                is_derived=bool(affected),
            ))

        # OData entity key changed (edmx-entity-key-changed)
        evals += 1
        if base_entity.keys and cand_entity.keys and base_entity.keys != cand_entity.keys:
            breaking_count += 1
            affected = self._cross_reference_field(entity_name, "*", integrations)
            line_no, col_no, _ = _locate_token_in_text(candidate.raw_text, "Key", start_line=cand_entity.line_number or 1)
            findings.append(self._build_finding(
                rule_id="API_BREAKING_KEY_CHANGED",
                severity=Severity.BLOCKER if affected else Severity.CRITICAL,
                category="OData Breaking Change",
                title=f"Breaking Change: Key of Entity Type '{entity_name}' Changed",
                description=(
                    f"The key of '{entity_name}' changed from {base_entity.keys} to {cand_entity.keys}; every key-based "
                    "read / update / delete URL of consumers addresses a different (or no) entity."
                ),
                remediation="Keep the entity key stable; introduce a new entity type or service version instead.",
                artifact_path=candidate.artifact_path,
                raw_text=candidate.raw_text, spec=candidate,
                line_number=line_no or cand_entity.line_number,
                column_number=col_no or cand_entity.column_number,
                artifact_hash=candidate.artifact_hash,
                affected_objects=[entity_name] + affected,
                technical_details={
                    "entity": entity_name, "keyChange": True, "baselineKeys": base_entity.keys,
                    "candidateKeys": cand_entity.keys, "affectedIntegrations": affected,
                },
                is_derived=bool(affected),
            ))

        # Format changes on schema properties (property-format-changed)
        for prop_name, base_prop in base_entity.properties.items():
            cand_prop = cand_entity.properties.get(prop_name)
            if (
                cand_prop is None
                or base_prop.type != cand_prop.type
                or (base_prop.format or None) == (cand_prop.format or None)
            ):
                continue
            breaking_count += 1
            affected = self._cross_reference_field(entity_name, prop_name, integrations)
            findings.append(self._build_finding(
                rule_id="API_BREAKING_FORMAT_CHANGED",
                severity=Severity.CRITICAL if affected else Severity.MAJOR,
                category="API Breaking Change",
                title=f"Breaking Change: Format of '{entity_name}.{prop_name}' Changed",
                description=(
                    f"Property '{prop_name}' ({cand_prop.type}) changed format from '{base_prop.format or 'none'}' to "
                    f"'{cand_prop.format or 'none'}'."
                ),
                remediation=f"Keep format '{base_prop.format or 'none'}' or add a new property with the new format.",
                artifact_path=candidate.artifact_path,
                raw_text=candidate.raw_text, spec=candidate,
                line_number=cand_prop.line_number,
                column_number=cand_prop.column_number,
                artifact_hash=candidate.artifact_hash,
                affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                technical_details={
                    "entity": entity_name, "property": prop_name, "baselineFormat": base_prop.format,
                    "candidateFormat": cand_prop.format, "affectedIntegrations": affected,
                },
                is_derived=bool(affected),
            ))

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
                        raw_text=candidate.raw_text, spec=candidate,
                        line_number=cand_prop.line_number,
                        column_number=cand_prop.column_number,
                        artifact_hash=candidate.artifact_hash,
                        affected_objects=[f"{entity_name}.{prop_name}"] + affected,
                        technical_details={"entity": entity_name, "property": prop_name, "affectedIntegrations": affected, "changeKind": "ADDED"},
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
                            raw_text=candidate.raw_text, spec=candidate,
                            line_number=cand_prop.line_number,
                            column_number=cand_prop.column_number,
                            artifact_hash=candidate.artifact_hash,
                            affected_objects=[f"{entity_name}.{prop_name}"],
                            technical_details={"entity": entity_name, "property": prop_name},
                        )
                    )

        return findings, evals, breaking_count, non_breaking_count

    # -------------------------------------------------------------------------
    # Sub-Diff: Responses (status codes, body properties) and security
    # -------------------------------------------------------------------------

    def _diff_responses(
        self,
        ep_path: str,
        method: str,
        base_op: NormalizedOperation,
        cand_op: NormalizedOperation,
        baseline: NormalizedApiSchema,
        candidate: NormalizedApiSchema,
        integrations: List[ClientIntegration],
    ) -> Tuple[List[Finding], int]:
        findings: List[Finding] = []
        breaking = 0
        affected = self._cross_reference_operation(ep_path, method, integrations)
        for status_code in sorted(base_op.response_shapes):
            base_shape = base_op.response_shapes[status_code]
            cand_shape = cand_op.response_shapes.get(status_code)
            if cand_shape is None:
                success = status_code.startswith("2")
                if success:
                    breaking += 1
                line_no, col_no, _ = _locate_token_in_text(baseline.raw_text, status_code, start_line=base_op.line_number or 1)
                findings.append(self._build_finding(
                    rule_id="API_BREAKING_RESPONSE_STATUS_REMOVED",
                    severity=(Severity.CRITICAL if affected else Severity.MAJOR) if success else Severity.MINOR,
                    category="API Breaking Change",
                    title=f"Breaking Change: Response Status {status_code} Removed from '{method} {ep_path}'",
                    description=(
                        f"'{method} {ep_path}' no longer documents response status {status_code}."
                        + (" Consumers expecting this success status mis-handle the response." if success else "")
                    ),
                    remediation=f"Keep returning status {status_code} or version the operation.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text, spec=baseline,
                    line_number=line_no or base_op.line_number,
                    column_number=col_no or base_op.column_number,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[f"{method} {ep_path} {status_code}"] + affected,
                    technical_details={
                        "endpoint": ep_path, "method": method, "status": status_code, "successStatus": success,
                        "affectedIntegrations": affected,
                    },
                    is_derived=bool(affected),
                ))
                continue
            # Property removal through a shared, still-existing component is reported once, on the component.
            if (
                base_shape.schema_ref
                and base_shape.schema_ref == cand_shape.schema_ref
                and base_shape.schema_ref in baseline.entities
                and base_shape.schema_ref in candidate.entities
            ):
                continue
            for prop_name in sorted(set(base_shape.properties) - set(cand_shape.properties)):
                breaking += 1
                line_no, col_no, _ = _locate_token_in_text(baseline.raw_text, prop_name, start_line=base_op.line_number or 1)
                findings.append(self._build_finding(
                    rule_id="API_BREAKING_RESPONSE_PROPERTY_REMOVED",
                    severity=Severity.CRITICAL if affected else Severity.MAJOR,
                    category="API Breaking Change",
                    title=f"Breaking Change: Response Property '{prop_name}' Removed ({method} {ep_path} {status_code})",
                    description=(
                        f"The {status_code} response of '{method} {ep_path}' no longer contains property '{prop_name}' "
                        f"({base_shape.properties[prop_name]}); consumers reading it get undefined / null."
                    ),
                    remediation=f"Keep returning '{prop_name}' (deprecated) until consumers stopped reading it.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text, spec=baseline,
                    line_number=line_no or base_op.line_number,
                    column_number=col_no or base_op.column_number,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[f"{method} {ep_path} {status_code}:{prop_name}"] + affected,
                    technical_details={
                        "endpoint": ep_path, "method": method, "status": status_code, "responseProperty": prop_name,
                        "affectedIntegrations": affected,
                    },
                    is_derived=bool(affected),
                ))
        return findings, breaking

    def _diff_security(self, baseline: NormalizedApiSchema, candidate: NormalizedApiSchema) -> List[Finding]:
        findings: List[Finding] = []
        for name in sorted(baseline.security_schemes):
            base_def = baseline.security_schemes[name]
            cand_def = candidate.security_schemes.get(name)
            if cand_def is None:
                line_no, col_no, _ = _locate_token_in_text(baseline.raw_text, name)
                findings.append(self._build_finding(
                    rule_id="API_BREAKING_SECURITY_CHANGED",
                    severity=Severity.CRITICAL,
                    category="API Security Change",
                    title=f"Breaking Change: Security Scheme '{name}' Removed",
                    description=f"Security scheme '{name}' ({base_def.get('type')}) is no longer defined; consumers using it cannot authenticate.",
                    remediation=f"Keep scheme '{name}' available in parallel until every consumer switched.",
                    artifact_path=baseline.artifact_path,
                    raw_text=baseline.raw_text, spec=baseline,
                    line_number=line_no or 1,
                    column_number=col_no or 1,
                    artifact_hash=baseline.artifact_hash,
                    affected_objects=[name],
                    technical_details={"securityScheme": name, "securityChange": "security-scheme-removed"},
                    pointer=base_def.get("pointer"),
                ))
                continue
            strip = lambda d: {k: v for k, v in d.items() if k != "pointer"}  # noqa: E731
            if strip(base_def) != strip(cand_def):
                changed = sorted(k for k in strip(base_def) if base_def.get(k) != cand_def.get(k))
                line_no, col_no, _ = _locate_token_in_text(candidate.raw_text, name)
                findings.append(self._build_finding(
                    rule_id="API_BREAKING_SECURITY_CHANGED",
                    severity=Severity.CRITICAL,
                    category="API Security Change",
                    title=f"Breaking Change: Security Scheme '{name}' Changed",
                    description=f"Security scheme '{name}' changed ({', '.join(changed)}): {strip(base_def)} -> {strip(cand_def)}.",
                    remediation=f"Introduce the new definition under a new scheme name and keep '{name}' until consumers migrated.",
                    artifact_path=candidate.artifact_path,
                    raw_text=candidate.raw_text, spec=candidate,
                    line_number=line_no or 1,
                    column_number=col_no or 1,
                    artifact_hash=candidate.artifact_hash,
                    affected_objects=[name],
                    technical_details={
                        "securityScheme": name, "securityChange": "security-scheme-changed", "changedAttributes": changed,
                    },
                    pointer=cand_def.get("pointer"),
                ))
        if _security_tightened(baseline.global_security, candidate.global_security):
            line_no, col_no, _ = _locate_token_in_text(candidate.raw_text, "security")
            findings.append(self._build_finding(
                rule_id="API_BREAKING_SECURITY_CHANGED",
                severity=Severity.CRITICAL,
                category="API Security Change",
                title="Breaking Change: Global Security Requirement Changed",
                description=(
                    f"The API-wide security requirement changed from {baseline.global_security or 'none (public)'} to "
                    f"{candidate.global_security or 'none (public)'}; every operation without its own requirement is affected."
                ),
                remediation="Keep the previous requirement as an accepted alternative until every consumer switched.",
                artifact_path=candidate.artifact_path,
                raw_text=candidate.raw_text, spec=candidate,
                line_number=line_no or 1,
                column_number=col_no or 1,
                artifact_hash=candidate.artifact_hash,
                affected_objects=["security"],
                technical_details={
                    "globalSecurity": True, "securityChange": "global-security-changed",
                    "baselineSecurity": baseline.global_security, "candidateSecurity": candidate.global_security,
                },
                pointer="/security",
            ))
        return findings

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
        spec: Optional[NormalizedApiSchema] = None,
        pointer: Optional[str] = None,
        change_category: Optional[str] = None,
    ) -> Finding:
        snippet = _extract_context_snippet(raw_text, line_number)
        provenance = ConfidenceClass.RULE_DERIVED if is_derived else ConfidenceClass.VERIFIED
        trust_score = 0.85 if is_derived else 1.0

        details = dict(technical_details)
        resolved_pointer = pointer or (_element_pointer(spec, details) if spec is not None else None)
        if resolved_pointer:
            details["jsonPointer" if spec is None or spec.schema_type.startswith("OPENAPI") else "xmlPath"] = resolved_pointer
        details["changeCategory"] = change_category or _change_category(rule_id, details, spec)
        if spec is not None and spec.role:
            details["specRole"] = spec.role
        details["specSha256"] = artifact_hash

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
            technical_details=details,
            affected_objects=affected_objects,
        )
