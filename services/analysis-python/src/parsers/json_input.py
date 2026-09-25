"""
ERP Preflight — strict JSON input helpers for engines.

Malformed payloads must never be silently replaced by ``{}`` (which would let an engine emit a
verdict about data it never saw). These helpers raise EngineInputError, which the EngineRunner
turns into a single ``<PREFIX>_PARSE_ERROR`` / ``<PREFIX>_INVALID_INPUT`` finding with status FAILED.
"""

from __future__ import annotations

import json
from typing import Any, Dict

from src.core.exceptions import EngineInputError


def parse_json_payload(text: str, rule_prefix: str) -> Any:
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise EngineInputError(
            f"{rule_prefix}_PARSE_ERROR",
            f"Malformed JSON payload at line {exc.lineno}, column {exc.colno}: {exc.msg}.",
            line_number=exc.lineno,
            column_number=exc.colno,
        ) from exc
    except RecursionError as exc:
        raise EngineInputError(
            f"{rule_prefix}_PARSE_ERROR", "JSON payload nesting exceeds the supported depth."
        ) from exc


def parse_json_object(text: str, rule_prefix: str) -> Dict[str, Any]:
    data = parse_json_payload(text, rule_prefix)
    if not isinstance(data, dict):
        raise EngineInputError(
            f"{rule_prefix}_INVALID_INPUT",
            f"Expected a JSON object at the top level of the payload, got {type(data).__name__}.",
        )
    return data


def require_list_of_objects(value: Any, field: str, rule_prefix: str) -> list:
    """Returns value when it is a list of objects (dicts); raises INVALID_INPUT otherwise. None -> []."""
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(item, dict) for item in value):
        raise EngineInputError(
            f"{rule_prefix}_INVALID_INPUT",
            f"Field '{field}' must be a list of objects.",
        )
    return value
