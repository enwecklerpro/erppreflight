from fastapi import APIRouter, HTTPException, status
from typing import List, Dict, Any
from src.models.request import AnalysisRequest
from src.models.response import AnalysisResponse
from src.models.enums import EngineType
from src.core.runner import EngineRunner
from src.core.registry import EngineRegistry
from src.core.exceptions import EngineNotFoundError

router = APIRouter(prefix="/api/v1", tags=["Analysis"])


@router.post("/analyze", response_model=AnalysisResponse)
async def analyze_artifact(request: AnalysisRequest) -> AnalysisResponse:
    """Dispatches analysis execution to registered preflight engine."""
    try:
        return await EngineRunner.execute(request)
    except EngineNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Analysis execution failed: {str(e)}"
        )


@router.get("/engines", response_model=List[Dict[str, Any]])
async def list_engines() -> List[Dict[str, Any]]:
    """Returns metadata for all 19 registered analysis engines."""
    return EngineRegistry.list_all()


@router.get("/engines/{engine_type}", response_model=Dict[str, Any])
async def get_engine_metadata(engine_type: EngineType) -> Dict[str, Any]:
    """Returns metadata for a specific engine."""
    try:
        engine = EngineRegistry.get(engine_type)
        return engine.get_metadata()
    except EngineNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Engine '{engine_type}' is not registered."
        )
