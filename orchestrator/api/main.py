"""
FastAPI application for the MLOps Orchestration Backend.

Provides:
- REST endpoints for platform detection, credentials, lifecycle management
- WebSocket for real-time progress streaming
- OpenAPI documentation
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .credential_routes import router as credential_router
from .lifecycle_routes import router as lifecycle_router
from .platform_routes import router as platform_router
from .deploy_routes import router as deploy_router
from .deps_routes import router as deps_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan handler for startup/shutdown."""
    logger.info("MLOps Orchestrator API starting up")

    # Initialize components
    # (In production, this would start the reconciliation scheduler, etc.)

    yield

    logger.info("MLOps Orchestrator API shutting down")


def create_app() -> FastAPI:
    """
    Create and configure the FastAPI application.

    Returns:
        Configured FastAPI instance
    """
    app = FastAPI(
        title="MLOps Orchestrator API",
        description=(
            "Backend API for the MLOps Setup Wizard and Deployment Engine. "
            "Provides platform detection, credential management, lifecycle tracking, "
            "and deployment orchestration."
        ),
        version="0.1.0",
        lifespan=lifespan,
    )

    # CORS middleware for UI
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Configure appropriately for production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Register routers
    app.include_router(platform_router, prefix="/api/v1/platform", tags=["Platform"])
    app.include_router(credential_router, prefix="/api/v1/credentials", tags=["Credentials"])
    app.include_router(lifecycle_router, prefix="/api/v1/lifecycle", tags=["Lifecycle"])
    app.include_router(deploy_router, prefix="/api/v1/deploy", tags=["Deployment"])
    app.include_router(deps_router, prefix="/api/v1/deps", tags=["Dependencies"])

    @app.get("/health")
    async def health_check() -> dict:
        """Health check endpoint."""
        return {"status": "healthy"}

    @app.get("/")
    async def root() -> dict:
        """Root endpoint with API info."""
        return {
            "name": "MLOps Orchestrator API",
            "version": "0.1.0",
            "docs": "/docs",
        }

    return app


# Create the default app instance
app = create_app()
