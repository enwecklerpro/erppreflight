"""
Rule self-test endpoints (spec 10.10 Rule Admin: "Publishing requires tests to pass").

* ``GET  /api/v1/rules/golden-coverage`` — golden fixture coverage per rule (gaps included);
* ``POST /api/v1/rules/{rule_code}/self-test`` — runs the rule's positive and negative golden cases
  through the production engine runner and returns a deterministic verdict + digest.

Both are read-only with respect to customer data and never alter engine output: the API persists the
verdict and gates publishing on it.
"""

from __future__ import annotations

import re
from typing import Any, Dict

from fastapi import APIRouter, HTTPException, status

from src.selftest.golden import UnknownRuleError, coverage_report, run_rule_self_test

router = APIRouter(prefix="/api/v1/rules", tags=["Rule Self-Test"])

RULE_CODE_RE = re.compile(r"^[A-Z0-9_]{3,120}$")


@router.get("/golden-coverage", response_model=Dict[str, Any])
async def golden_coverage() -> Dict[str, Any]:
    return coverage_report()


@router.post("/{rule_code}/self-test", response_model=Dict[str, Any])
async def rule_self_test(rule_code: str) -> Dict[str, Any]:
    if not RULE_CODE_RE.match(rule_code):
        raise HTTPException(status_code=422, detail="Invalid rule code format.")
    try:
        return await run_rule_self_test(rule_code)
    except UnknownRuleError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Rule '{rule_code}' is not declared by any engine.")
