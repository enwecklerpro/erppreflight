from fastapi import APIRouter, Response, status
from src.models.health import LivenessResponse, ReadinessResponse
from src.core.registry import EngineRegistry

router = APIRouter(tags=["Health"])


@router.get("/health/liveness", response_model=LivenessResponse)
async def liveness_probe() -> LivenessResponse:
    """Liveness probe confirming the ASGI event loop is active."""
    return LivenessResponse(status="ok")


@router.get("/health/readiness", response_model=ReadinessResponse)
async def readiness_probe(response: Response) -> ReadinessResponse:
    """Readiness probe confirming engine registry is populated."""
    count = EngineRegistry.count()
    is_ready = count >= 19

    if not is_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        status_text = "not_ready"
    else:
        status_text = "ready"

    return ReadinessResponse(
        status=status_text,
        engines_registered=count,
        checks={
            "engines_registered": count,
            "required_engines": 19,
            "registry_ready": is_ready,
        }
    )
