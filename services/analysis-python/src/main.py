from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from src.config import get_settings
from src.api.router import api_router
from src.api.middleware import CorrelationIdMiddleware, PayloadSizeLimitMiddleware
import src.engines  # noqa: F401 — triggers auto-registration of all 19 engines


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
    # Base64 inflates binary artifacts by 4/3; allow for it plus JSON envelope overhead.
    app.add_middleware(
        PayloadSizeLimitMiddleware,
        max_bytes=int(settings.MAX_PAYLOAD_SIZE_MB * 1024 * 1024 * 4 / 3) + 64 * 1024,
    )
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
