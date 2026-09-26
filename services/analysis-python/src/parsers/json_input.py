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

# Maximum container nesting accepted in JSON artifacts. SAP exports are shallow (< 20 levels);
# deeper documents are rejected before json.loads so hostile nesting cannot exhaust the stack.
MAX_JSON_DEPTH = 64


def json_nesting_depth(text: str, limit: int = MAX_JSON_DEPTH) -> int:
    """Returns the maximum array/object nesting depth (string-aware, O(n)); stops early past ``limit``."""
    depth = 0
    max_depth = 0
    in_string = False
    escaped = False
    for ch in text:
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue
        if ch == '"':
            in_string = True
        elif ch in "[{":
            depth += 1
            if depth > max_depth:
                max_depth = depth
                if max_depth > limit:
                    return max_depth
        elif ch in "]}":
            depth -= 1
    return max_depth


def parse_json_payload(text: str, rule_prefix: str, max_depth: int = MAX_JSON_DEPTH) -> Any:
    if json_nesting_depth(text, max_depth) > max_depth:
        raise EngineInputError(
            f"{rule_prefix}_PARSE_ERROR",
            f"JSON payload nesting exceeds the supported depth of {max_depth} levels.",
        )
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
    except ValueError as exc:  # e.g. integer literals beyond the interpreter's digit limit
        raise EngineInputError(
            f"{rule_prefix}_PARSE_ERROR", "JSON payload contains a value that cannot be represented."
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
