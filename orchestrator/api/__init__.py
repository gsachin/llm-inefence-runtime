# FastAPI backend for the MLOps Orchestration UI
# Provides REST endpoints and WebSocket for real-time progress

from .main import create_app, app

__all__ = [
    "create_app",
    "app",
]
