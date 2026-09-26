from fastapi import APIRouter
from src.api.health import router as health_router
from src.api.analyze import router as analyze_router
from src.api.contracts import router as contracts_router
from src.api.tools import router as tools_router
from src.api.selftest import router as selftest_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(analyze_router)
api_router.include_router(contracts_router)
api_router.include_router(tools_router)
api_router.include_router(selftest_router)
