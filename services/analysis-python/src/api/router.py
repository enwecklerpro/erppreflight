from fastapi import APIRouter
from src.api.health import router as health_router
from src.api.analyze import router as analyze_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(analyze_router)
