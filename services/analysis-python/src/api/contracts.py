"""
Contract matching — which engines' declared input contracts accept an artifact.

Used by the API's Full Project Preflight orchestrator and the Problem Router
(Part 05 §5.1 / §5.6) to map uploaded artifacts to engines *from each engine's
declared input contract* instead of a hand-maintained format table. The check
runs only :func:`validate_request_input` (format sniffing, JSON contract model,
CSV signal columns, XML / text checks). It never executes rule evaluation and
never produces findings, so it is deterministic and side-effect free.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from src.core.contracts import sniff_format, validate_request_input
from src.core.exceptions import EngineInputError
from src.core.registry import EngineRegistry
from src.models.enums import EngineType
from src.models.request import AnalysisRequest, RawContentEncoding

router = APIRouter(prefix="/api/v1", tags=["Contracts"])

# Contract matching is a routing aid: the caller sends a bounded prefix of the artifact.
MAX_MATCH_PAYLOAD_CHARS = 2 * 1024 * 1024
# Placeholder identifiers: contract validation never reads them, but the request model requires them.
_NIL = str(uuid.UUID(int=0))


class ContractMatchRequest(BaseModel):
    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    raw_content: str = Field(..., max_length=MAX_MATCH_PAYLOAD_CHARS)
    raw_content_encoding: RawContentEncoding = "utf-8"
    file_name: Optional[str] = Field(None, max_length=500)
    engine_types: Optional[List[EngineType]] = None


class EngineContractMatch(BaseModel):
    engine_type: str
    accepted: bool
    code: Optional[str] = None
    message: Optional[str] = None


class ContractMatchResponse(BaseModel):
    sniffed_format: Optional[str]
    matches: List[EngineContractMatch]


def match_contracts(payload: ContractMatchRequest) -> ContractMatchResponse:
    engines = payload.engine_types or [et for et in EngineType if EngineRegistry.is_registered(et)]
    matches: List[EngineContractMatch] = []
    sniffed: Optional[str] = None
    for et in engines:
        if not EngineRegistry.is_registered(et):
            continue
        engine = EngineRegistry.get(et)
        request = AnalysisRequest(
            job_id=_NIL,
            tenant_id=_NIL,
            project_id=_NIL,
            engine_type=et,
            raw_content=payload.raw_content,
            raw_content_encoding=payload.raw_content_encoding,
            configuration={"sourceFileName": payload.file_name} if payload.file_name else {},
        )
        if sniffed is None and request.raw_content is not None:
            sniffed = sniff_format(request.raw_content).value
        try:
            validate_request_input(engine, request)
            matches.append(EngineContractMatch(engine_type=et.value, accepted=True))
        except EngineInputError as exc:
            matches.append(
                EngineContractMatch(
                    engine_type=et.value,
                    accepted=False,
                    code=getattr(exc, "rule_id", None) or getattr(exc, "code", None),
                    message=str(exc)[:300],
                )
            )
        except Exception:  # noqa: BLE001 — a hostile payload must never break matching for other engines
            matches.append(EngineContractMatch(engine_type=et.value, accepted=False, code="CONTRACT_CHECK_ERROR"))
    return ContractMatchResponse(sniffed_format=sniffed, matches=matches)


@router.post("/contracts/match", response_model=ContractMatchResponse)
async def contracts_match(payload: ContractMatchRequest) -> Dict[str, Any]:
    """Returns, per engine, whether its declared input contract accepts the artifact."""
    return match_contracts(payload).model_dump()
