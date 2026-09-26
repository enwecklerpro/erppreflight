import logging
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, status

from src.core.exceptions import EngineNotFoundError
from src.core.registry import EngineRegistry
from src.core.runner import EngineRunner
from src.models.enums import EngineType
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse

router = APIRouter(prefix="/api/v1", tags=["Analysis"])
logger = logging.getLogger("erppreflight.analysis.api")


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_artifact(request: AnalysisRequest) -> AnalysisResponse:
    """Dispatches analysis execution to registered preflight engine."""
    try:
        return await EngineRunner.execute(request)
    except EngineNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception:  # noqa: BLE001 — log internally, never leak exception text to callers
        logger.exception("analysis execution failed for job %s", request.job_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Analysis execution failed due to an internal error.",
        )


def _catalog_summary(entries: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "engines": len(entries),
        "totalRules": sum(e["rule_count"] for e in entries),
        "operational": sum(1 for e in entries if e["health"]["status"] == "OPERATIONAL"),
    }


@router.get("/engines", response_model=List[Dict[str, Any]])
async def list_engines() -> List[Dict[str, Any]]:
    """Engine catalog for admin visibility (Axiom 2 #13): metadata, domain, version, supported formats,
    rule inventory (codes, count, severity, remediation) derived from each engine's declared rule catalog,
    input contract summary, knowledge sources and health."""
    return [EngineRegistry.get(et).get_catalog_entry() for et in EngineType if EngineRegistry.is_registered(et)]


@router.get("/engines-summary", response_model=Dict[str, Any])
async def engines_summary() -> Dict[str, Any]:
    entries = [EngineRegistry.get(et).get_catalog_entry() for et in EngineType if EngineRegistry.is_registered(et)]
    return _catalog_summary(entries)


@router.get("/engines/{engine_type}", response_model=Dict[str, Any])
async def get_engine_metadata(engine_type: EngineType) -> Dict[str, Any]:
    """Catalog entry for a specific engine."""
    try:
        return EngineRegistry.get(engine_type).get_catalog_entry()
    except EngineNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Engine '{engine_type.value}' is not registered.",
        )


@router.get("/engines/{engine_type}/health", response_model=Dict[str, Any])
async def get_engine_health(engine_type: EngineType) -> Dict[str, Any]:
    try:
        return EngineRegistry.get(engine_type).health()
    except EngineNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Engine '{engine_type.value}' is not registered.",
        )
