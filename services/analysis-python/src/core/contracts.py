"""
ERP Preflight — engine contracts: declared rule catalog + explicit input contract.

Every engine declares, in ONE place:

* ``finding_codes`` — the complete rule inventory (code, title, default severity, remediation).
  The runner rejects/flags any emitted finding whose ``rule_id`` is not declared, fills an empty
  remediation from the catalog, and the ``/api/v1/engines`` catalog endpoint derives rule counts
  from it (AGENTS.md Axiom 2 #5, #13, #14).
* ``input_contract`` — the accepted artifact formats plus a Pydantic model for structured
  (JSON / configuration) payloads. :func:`validate_request_input` enforces it before the engine's
  rule evaluation runs, so empty, garbage, malformed or structurally unrelated payloads end as
  ``<PREFIX>_INSUFFICIENT_INPUT`` / ``<PREFIX>_PARSE_ERROR`` / ``<PREFIX>_INVALID_INPUT``
  (UNKNOWN confidence, status FAILED) and never as a verdict (Axiom 2 #2, #3).
"""

from __future__ import annotations

import csv
import io
import json
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, ClassVar, Dict, Iterable, List, Optional, Tuple, Type

from pydantic import BaseModel, ConfigDict, ValidationError, model_validator
from pydantic_core import PydanticCustomError

from src.core.exceptions import EngineInputError, SecurityViolationError
from src.models.enums import Severity
from src.parsers.json_input import MAX_JSON_DEPTH, parse_json_payload
from src.parsers.safe_xml import MAX_XML_DEPTH, SafeXmlParser
from src.parsers.safe_zip import ArchiveSecurityError, inspect_archive

# ---------------------------------------------------------------------------
# Rule catalog
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RuleSpec:
    code: str
    title: str
    severity: Severity
    remediation: str
    category: str = ""

    def as_dict(self) -> Dict[str, Any]:
        return {
            "code": self.code,
            "title": self.title,
            "defaultSeverity": self.severity.value,
            "category": self.category,
            "remediation": self.remediation,
        }


def rule_catalog(*specs: RuleSpec) -> Dict[str, RuleSpec]:
    catalog: Dict[str, RuleSpec] = {}
    for spec in specs:
        if spec.code in catalog:
            raise ValueError(f"Duplicate finding code declared: {spec.code}")
        catalog[spec.code] = spec
    return catalog


INPUT_RULE_SUFFIXES = (
    "INSUFFICIENT_INPUT",
    "PARSE_ERROR",
    "INVALID_INPUT",
    "PAYLOAD_TOO_LARGE",
    "ARCHIVE_REJECTED",
)


def standard_input_rules(prefix: str, engine_name: str, formats_doc: str) -> Dict[str, RuleSpec]:
    """Runner-generated input-validation codes every engine can emit."""
    resupply = (
        f"No verdict was produced. Re-export the artifact in one of the formats accepted by {engine_name} "
        f"({formats_doc}) and re-run the analysis."
    )
    return rule_catalog(
        RuleSpec(
            f"{prefix}_INSUFFICIENT_INPUT", "Required input missing", Severity.INFO,
            "Supply every input the engine's contract marks as required (see the engine catalog entry). "
            + resupply, "INPUT_VALIDATION",
        ),
        RuleSpec(
            f"{prefix}_PARSE_ERROR", "Artifact could not be parsed", Severity.MAJOR,
            "Fix the syntax error at the reported line/column (or re-export the file unmodified from SAP). "
            + resupply, "INPUT_VALIDATION",
        ),
        RuleSpec(
            f"{prefix}_INVALID_INPUT", "Artifact does not match the engine input contract", Severity.MAJOR,
            "Provide the artifact type documented for this engine; unrelated or structurally invalid documents "
            "are rejected. " + resupply, "INPUT_VALIDATION",
        ),
        RuleSpec(
            f"{prefix}_PAYLOAD_TOO_LARGE", "Artifact exceeds the size limit", Severity.MAJOR,
            "Split the export (e.g. per package, company code or date range) so each upload stays under the "
            "service payload limit. " + resupply, "INPUT_VALIDATION",
        ),
        RuleSpec(
            f"{prefix}_ARCHIVE_REJECTED", "Archive rejected by ingestion safety limits", Severity.MAJOR,
            "The archive exceeded the 100:1 expansion ratio, 500 MB total size, entry-count or 2-level nesting "
            "limit, or contained path traversal / encrypted members. Upload a flat, unencrypted archive of the "
            "export files. " + resupply, "INPUT_VALIDATION",
        ),
    )


# ---------------------------------------------------------------------------
# Input contract
# ---------------------------------------------------------------------------


class InputFormat(str, Enum):
    JSON = "JSON"
    XML = "XML"
    CSV = "CSV"
    ABAP = "ABAP"
    TEXT = "TEXT"
    ZIP = "ZIP"
    XLSX = "XLSX"


def insufficient(message: str) -> PydanticCustomError:
    """Raise from a contract model validator when required data is absent (-> *_INSUFFICIENT_INPUT)."""
    return PydanticCustomError("insufficient_input", message)


def _nonempty(value: Any) -> bool:
    return not (value is None or value == "" or value == [] or value == {})


class ContractModel(BaseModel):
    """Base for per-engine structured-input contracts.

    ``signal_fields``: at least one of these must be present and non-empty, otherwise the payload is
    reported as ``<PREFIX>_INSUFFICIENT_INPUT`` (an unrelated JSON document never yields a verdict).
    Unknown keys are tolerated (SAP exports carry many columns) but typed fields are validated."""

    model_config = ConfigDict(extra="allow", populate_by_name=True)
    signal_fields: ClassVar[Tuple[str, ...]] = ()
    signal_message: ClassVar[str] = ""

    @model_validator(mode="after")
    def _require_signal(self) -> "ContractModel":
        if not self.signal_fields:
            return self
        extra = self.model_extra or {}
        for name in self.signal_fields:
            if _nonempty(getattr(self, name, None)) or _nonempty(extra.get(name)):
                return self
        raise insufficient(
            self.signal_message
            or f"None of the required inputs ({', '.join(self.signal_fields)}) were supplied."
        )


# (text) -> None when acceptable, otherwise an error message. May raise EngineInputError directly.
TextCheck = Callable[[str], Optional[str]]
XmlCheck = Callable[[Any], Optional[str]]


@dataclass
class InputContract:
    formats: Tuple[InputFormat, ...]
    summary: str
    required: Tuple[str, ...] = ()
    json_model: Optional[Type[BaseModel]] = None
    # When a top-level JSON array is accepted, it is validated as {json_array_field: [...]}.
    json_array_field: Optional[str] = None
    # CSV: at least one of these (normalised, case-insensitive) header columns must be present.
    csv_signal_columns: Tuple[str, ...] = ()
    xml_check: Optional[XmlCheck] = None
    # Called for payloads sniffed as TEXT/ABAP (and CSV when the engine has no csv_signal_columns).
    text_check: Optional[TextCheck] = None
    # Allow request.configuration (non-option keys) to carry the structured input instead of raw_content.
    configuration_payload: bool = True
    notes: Tuple[str, ...] = ()

    def describe(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "acceptedFormats": [f.value for f in self.formats],
            "summary": self.summary,
            "required": list(self.required),
            "notes": list(self.notes),
        }
        if self.json_model is not None:
            schema = self.json_model.model_json_schema()
            out["jsonSchema"] = {
                "title": schema.get("title"),
                "properties": sorted((schema.get("properties") or {}).keys()),
                "required": sorted(schema.get("required") or []),
            }
        if self.csv_signal_columns:
            out["csvColumnsAnyOf"] = list(self.csv_signal_columns)
        if self.json_array_field:
            out["jsonTopLevelArrayAs"] = self.json_array_field
        return out


# Execution options that are never analysable data (mirrors runner.OPTION_CONFIG_KEYS).
OPTION_KEYS = frozenset({
    "deterministicOnly", "deterministic_only",
    "allowAiAssistance", "allow_ai_assistance",
    "is_ai_generated", "ai_generated",
    "strictValidation", "strict_validation",
    "maxFindings", "max_findings",
    "targetRelease", "target_release",
    "artifact_path", "file_name",
    "evaluation_date", "snapshot_date",
})


def normalize_header(name: str) -> str:
    return "".join(ch for ch in str(name).strip().lower() if ch.isalnum())


def sniff_format(text: str) -> InputFormat:
    s = text.lstrip("﻿ \t\r\n")
    if s[:1] in ("{", "["):
        return InputFormat.JSON
    if s[:1] == "<":
        return InputFormat.XML
    lines = [ln for ln in s.splitlines() if ln.strip()][:6]
    if len(lines) >= 2:
        for delim in (",", ";", "\t", "|"):
            counts = [ln.count(delim) for ln in lines]
            if counts[0] >= 1 and all(c >= 1 for c in counts):
                return InputFormat.CSV
    return InputFormat.TEXT


def _validation_failure(prefix: str, exc: ValidationError, where: str) -> EngineInputError:
    errors = exc.errors(include_url=False, include_input=False, include_context=False)
    insufficient_errors = [e for e in errors if e.get("type") == "insufficient_input"]
    if insufficient_errors:
        return EngineInputError(
            f"{prefix}_INSUFFICIENT_INPUT",
            "; ".join(str(e.get("msg")) for e in insufficient_errors[:5]),
            details={"inputLocation": where},
        )
    parts = []
    for e in errors[:5]:
        loc = ".".join(str(p) for p in e.get("loc", ()) if p != "__root__") or "(root)"
        parts.append(f"{loc}: {e.get('msg')}")
    return EngineInputError(
        f"{prefix}_INVALID_INPUT",
        f"{where} does not match the input contract — " + "; ".join(parts),
        details={"inputLocation": where, "violations": parts},
    )


def _validate_json(contract: InputContract, prefix: str, data: Any, where: str) -> None:
    if contract.json_model is None:
        return
    if isinstance(data, list):
        if not contract.json_array_field:
            raise EngineInputError(
                f"{prefix}_INVALID_INPUT",
                f"{where}: a top-level JSON array is not accepted by this engine; expected a JSON object.",
            )
        data = {contract.json_array_field: data}
    if not isinstance(data, dict):
        raise EngineInputError(
            f"{prefix}_INVALID_INPUT", f"{where}: expected a JSON object, got a scalar value."
        )
    try:
        contract.json_model.model_validate(data)
    except ValidationError as exc:
        raise _validation_failure(prefix, exc, where) from None


def _validate_csv(contract: InputContract, prefix: str, text: str, where: str) -> None:
    if not contract.csv_signal_columns:
        return
    first = next((ln for ln in text.splitlines() if ln.strip()), "")
    try:
        dialect = csv.Sniffer().sniff(first, delimiters=",;\t|")
        delim = dialect.delimiter
    except csv.Error:
        delim = ","
    header = next(csv.reader(io.StringIO(first), delimiter=delim), [])
    cols = {normalize_header(h) for h in header}
    wanted = {normalize_header(c) for c in contract.csv_signal_columns}
    if not cols & wanted:
        raise EngineInputError(
            f"{prefix}_INVALID_INPUT",
            f"{where}: CSV header does not contain any of the required columns "
            f"({', '.join(contract.csv_signal_columns)}).",
        )
    data_rows = [ln for ln in text.splitlines()[1:] if ln.strip()]
    if not data_rows:
        raise EngineInputError(f"{prefix}_INSUFFICIENT_INPUT", f"{where}: CSV contains a header but no data rows.")


def _check_text_payload(
    contract: InputContract, prefix: str, text: str, where: str, fmt: InputFormat
) -> None:
    accepted = set(contract.formats)
    if fmt == InputFormat.JSON:
        if InputFormat.JSON not in accepted:
            raise EngineInputError(
                f"{prefix}_INVALID_INPUT",
                f"{where}: JSON documents are not accepted by this engine "
                f"(accepted: {', '.join(f.value for f in contract.formats)}).",
            )
        data = parse_json_payload(text, prefix)
        _validate_json(contract, prefix, data, where)
        return
    if fmt == InputFormat.XML:
        if InputFormat.XML not in accepted:
            raise EngineInputError(
                f"{prefix}_INVALID_INPUT",
                f"{where}: XML documents are not accepted by this engine "
                f"(accepted: {', '.join(f.value for f in contract.formats)}).",
            )
        try:
            root = SafeXmlParser.parse_string(text)
        except SecurityViolationError:
            raise EngineInputError(
                f"{prefix}_INVALID_INPUT",
                f"{where}: Malicious XML rejected (Entities/DTD forbidden) — DTDs, entity declarations and external references are not allowed.",
            ) from None
        except ValueError as exc:
            raise EngineInputError(f"{prefix}_PARSE_ERROR", f"{where}: {exc}") from None
        if contract.xml_check is not None:
            problem = contract.xml_check(root)
            if problem:
                raise EngineInputError(f"{prefix}_INVALID_INPUT", f"{where}: {problem}")
        return
    formats_doc = " / ".join(f.value for f in contract.formats)
    if fmt == InputFormat.CSV and InputFormat.CSV in accepted:
        if contract.csv_signal_columns:
            _validate_csv(contract, prefix, text, where)
            return
        if contract.text_check is None:
            return
    elif not ({InputFormat.TEXT, InputFormat.ABAP} & accepted):
        raise EngineInputError(
            f"{prefix}_PARSE_ERROR", f"{where}: payload is not a well-formed {formats_doc} document."
        )
    if contract.text_check is None:
        raise EngineInputError(
            f"{prefix}_PARSE_ERROR", f"{where}: payload is not a well-formed {formats_doc} document."
        )
    problem = contract.text_check(text)
    if problem:
        raise EngineInputError(f"{prefix}_INVALID_INPUT", f"{where}: {problem}")


def _check_binary_payload(contract: InputContract, prefix: str, data: bytes, where: str) -> None:
    if data[:4] == b"PK\x03\x04" and ({InputFormat.ZIP, InputFormat.XLSX} & set(contract.formats)):
        try:
            inspect_archive(data)
        except ArchiveSecurityError as exc:
            raise EngineInputError(f"{prefix}_ARCHIVE_REJECTED", f"{where}: {exc}") from None
        return
    raise EngineInputError(
        f"{prefix}_INVALID_INPUT",
        f"{where}: binary payload is not a supported archive "
        f"(accepted: {', '.join(f.value for f in contract.formats)}).",
    )


def iter_inline_payloads(request) -> Iterable[Tuple[str, Optional[str], Optional[bytes]]]:
    raw_bytes = request.get_raw_bytes()
    if raw_bytes is not None and raw_bytes.strip():
        yield "raw_content", request.raw_content, raw_bytes
    for idx, art in enumerate(request.artifacts):
        data = art.get_raw_bytes()
        if data is not None and data.strip():
            yield f"artifacts[{idx}] ({art.file_name})", art.raw_content, data


def structured_configuration(configuration: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(configuration, dict):
        return {}
    return {
        k: v for k, v in configuration.items()
        if k not in OPTION_KEYS and not (v is None or v == "" or v == [] or v == {})
    }


def validate_request_input(engine, request) -> None:
    """Enforces the engine's declared input contract. Raises EngineInputError on any violation."""
    contract: Optional[InputContract] = getattr(engine, "input_contract", None)
    if contract is None:
        return
    prefix = engine.get_rule_prefix()
    seen_payload = False
    for where, text, data in iter_inline_payloads(request):
        seen_payload = True
        if text is None:
            _check_binary_payload(contract, prefix, data or b"", where)
            continue
        if not text.strip():
            continue
        _check_text_payload(contract, prefix, text, where, sniff_format(text))
    if not seen_payload:
        cfg = structured_configuration(request.configuration)
        if not cfg:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "No raw_content, artifacts, or structured configuration data were supplied. Required: "
                + ("; ".join(contract.required) or contract.summary),
            )
        if not contract.configuration_payload or contract.json_model is None:
            raise EngineInputError(
                f"{prefix}_INSUFFICIENT_INPUT",
                "This engine requires an inline artifact; structured configuration alone is not analysable. "
                "Required: " + ("; ".join(contract.required) or contract.summary),
            )
        _validate_json(contract, prefix, cfg, "configuration")


__all__ = [
    "RuleSpec",
    "rule_catalog",
    "standard_input_rules",
    "InputFormat",
    "InputContract",
    "insufficient",
    "ContractModel",
    "sniff_format",
    "normalize_header",
    "validate_request_input",
    "structured_configuration",
    "INPUT_RULE_SUFFIXES",
    "MAX_JSON_DEPTH",
    "MAX_XML_DEPTH",
]
