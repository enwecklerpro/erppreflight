from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from src.config import get_settings
from src.api.router import api_router
from src.api.middleware import CorrelationIdMiddleware
import src.engines  # Triggers auto-registration of all 19 engines


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: ensure engines are loaded
    yield
    # Shutdown logic if any


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="ERP Preflight Analysis Engine",
        description="Deterministic analysis, rule evaluation, and provenance engine for SAP Preflight SaaS",
        version=settings.SERVICE_VERSION,
        lifespan=lifespan,
    )

    # Middleware
    app.add_middleware(CorrelationIdMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.CORS_ORIGINS,
        allow_credentials=settings.CORS_ALLOW_CREDENTIALS,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Mount routes
    app.include_router(api_router)

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host="0.0.0.0", port=8000, reload=True)
