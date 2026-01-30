"""
Dependency management API routes.

Provides endpoints for:
- Checking dependency status
- Installing dependencies
- WebSocket for real-time installation progress
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from ..deps import (
    DependencyChecker,
    DependencyInfo,
    DependencyInstaller,
    DependencyMatrix,
    DependencyStatus,
    InstallProgress,
    InstallState,
)
from ..platform.base import detect_platform, PlatformDetector

logger = logging.getLogger(__name__)
router = APIRouter()


# =============================================================================
# Models
# =============================================================================

class DependencyStatusModel(BaseModel):
    """Status of a single dependency."""
    
    name: str
    status: str  # installed, outdated, missing, check_failed, optional_missing, pending_cluster
    required_version: str
    category: str = "cli_tool"  # cli_tool or cluster_component
    installed_version: Optional[str] = None
    message: str
    install_cmd: str
    requires_sudo: bool
    optional: bool
    order: int
    description: str
    docs_url: str
    requires_cluster: bool = False


class DependencyStatusResponse(BaseModel):
    """Response for dependency status check."""
    
    platform: str
    platform_description: str
    cluster_available: bool
    cli_tools_satisfied: bool
    cluster_components_satisfied: bool
    all_satisfied: bool
    cli_tools: List[DependencyStatusModel]
    cluster_components: List[DependencyStatusModel]
    # For backward compatibility
    dependencies: List[DependencyStatusModel]
    missing_count: int
    outdated_count: int


class InstallRequest(BaseModel):
    """Request to install dependencies."""
    
    platform: Optional[str] = None  # Auto-detect if not provided
    dependencies: Optional[List[str]] = None  # Install all if not provided
    skip_optional: bool = False


class InstallResponse(BaseModel):
    """Response for installation request."""
    
    success: bool
    installed: List[str]
    failed: List[str]
    skipped: List[str]
    errors: Dict[str, str]


class InstallProgressModel(BaseModel):
    """Progress update for WebSocket streaming."""
    
    dependency: str
    state: str
    message: str
    output: str = ""
    progress_percent: Optional[float] = None


# =============================================================================
# Helpers
# =============================================================================

def _get_current_platform() -> str:
    """Detect the current platform name."""
    adapter = PlatformDetector.detect()
    if adapter:
        return adapter.platform_name
    
    # Fallback based on basic detection
    info = detect_platform()
    if info.get("is_macos") and info.get("is_apple_silicon"):
        return "mac_m_series"
    elif info.get("is_wsl"):
        return "wsl2_cuda12"
    elif info.get("is_linux"):
        return "linux_nvidia_rtx"
    
    return "unknown"


def _info_to_model(info: DependencyInfo) -> DependencyStatusModel:
    """Convert DependencyInfo to Pydantic model."""
    return DependencyStatusModel(
        name=info.name,
        status=info.status.value,
        required_version=info.required_version,
        category=info.category,
        installed_version=info.installed_version,
        message=info.message,
        install_cmd=info.install_cmd,
        requires_sudo=info.requires_sudo,
        optional=info.optional,
        order=info.order,
        description=info.description,
        docs_url=info.docs_url,
        requires_cluster=info.requires_cluster,
    )


# =============================================================================
# Endpoints
# =============================================================================

@router.get("/status", response_model=DependencyStatusResponse)
async def check_dependencies(platform: Optional[str] = None):
    """
    Check status of all dependencies for a platform.
    
    If platform is not specified, auto-detects current platform.
    
    Returns:
        Status of each dependency and overall summary, separated by category
    """
    platform_name = platform or _get_current_platform()
    
    matrix = DependencyMatrix()
    checker = DependencyChecker(matrix)
    
    platform_deps = matrix.get_platform(platform_name)
    if not platform_deps:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown platform: {platform_name}. Available: {matrix.get_all_platforms()}",
        )
    
    # Check cluster availability
    cluster_available = await checker.check_cluster_available()
    
    # Check CLI tools
    cli_infos = await checker.check_cli_tools(platform_name)
    
    # Check cluster components
    cluster_infos = await checker.check_cluster_components(platform_name)
    
    # All infos combined
    all_infos = cli_infos + cluster_infos
    
    # Count issues
    missing = sum(1 for i in all_infos if i.status == DependencyStatus.MISSING)
    outdated = sum(1 for i in all_infos if i.status == DependencyStatus.OUTDATED)
    
    # Check if CLI tools are satisfied (user can proceed to next step)
    cli_tools_satisfied = all(
        i.status in (DependencyStatus.INSTALLED, DependencyStatus.OPTIONAL_MISSING)
        for i in cli_infos
    )
    
    # Check if cluster components are satisfied (or pending cluster)
    cluster_components_satisfied = all(
        i.status in (
            DependencyStatus.INSTALLED, 
            DependencyStatus.OPTIONAL_MISSING,
            DependencyStatus.PENDING_CLUSTER
        )
        for i in cluster_infos
    )
    
    # All required deps satisfied?
    all_satisfied = cli_tools_satisfied and cluster_components_satisfied
    
    return DependencyStatusResponse(
        platform=platform_name,
        platform_description=platform_deps.description,
        cluster_available=cluster_available,
        cli_tools_satisfied=cli_tools_satisfied,
        cluster_components_satisfied=cluster_components_satisfied,
        all_satisfied=all_satisfied,
        cli_tools=[_info_to_model(i) for i in cli_infos],
        cluster_components=[_info_to_model(i) for i in cluster_infos],
        dependencies=[_info_to_model(i) for i in all_infos],
        missing_count=missing,
        outdated_count=outdated,
    )


@router.get("/status/{dep_name}")
async def check_single_dependency(
    dep_name: str,
    platform: Optional[str] = None,
):
    """Check status of a single dependency."""
    platform_name = platform or _get_current_platform()
    
    checker = DependencyChecker()
    info = await checker.check_one(platform_name, dep_name)
    
    if not info:
        raise HTTPException(
            status_code=404,
            detail=f"Dependency '{dep_name}' not found for platform '{platform_name}'",
        )
    
    return _info_to_model(info)


@router.post("/install", response_model=InstallResponse)
async def install_dependencies(request: InstallRequest):
    """
    Install dependencies (non-streaming).
    
    For real-time progress, use the WebSocket endpoint instead.
    """
    platform_name = request.platform or _get_current_platform()
    
    installer = DependencyInstaller()
    
    result = {
        "success": True,
        "installed": [],
        "failed": [],
        "skipped": [],
        "errors": {},
    }
    
    if request.dependencies:
        # Install specific dependencies
        for dep_name in request.dependencies:
            async for progress in installer.install_one(platform_name, dep_name):
                if progress.state == InstallState.SUCCESS:
                    result["installed"].append(progress.dependency)
                elif progress.state == InstallState.FAILED:
                    result["failed"].append(progress.dependency)
                    result["errors"][progress.dependency] = progress.message
                    result["success"] = False
    else:
        # Install all
        async for progress in installer.install_all(
            platform_name,
            skip_optional=request.skip_optional,
        ):
            if progress.dependency == "__summary__":
                result["success"] = progress.state == InstallState.SUCCESS
            elif progress.state == InstallState.SUCCESS:
                result["installed"].append(progress.dependency)
            elif progress.state == InstallState.FAILED:
                result["failed"].append(progress.dependency)
                result["errors"][progress.dependency] = progress.message
            elif progress.state == InstallState.SKIPPED:
                result["skipped"].append(progress.dependency)
    
    return InstallResponse(**result)


@router.post("/install/{dep_name}")
async def install_single_dependency(
    dep_name: str,
    platform: Optional[str] = None,
):
    """Install a single dependency."""
    platform_name = platform or _get_current_platform()
    
    installer = DependencyInstaller()
    
    last_progress = None
    async for progress in installer.install_one(platform_name, dep_name):
        last_progress = progress
    
    if not last_progress:
        raise HTTPException(status_code=500, detail="No progress received")
    
    return {
        "success": last_progress.state == InstallState.SUCCESS,
        "dependency": last_progress.dependency,
        "message": last_progress.message,
    }


@router.websocket("/ws/install")
async def websocket_install(websocket: WebSocket):
    """
    WebSocket endpoint for real-time installation progress.
    
    Protocol:
    1. Client connects and sends: {"action": "start", "platform": "...", "dependencies": [...]}
    2. Server streams: {"type": "progress", "data": {...}}
    3. Server sends final: {"type": "complete", "data": {...}}
    
    Client can send {"action": "cancel"} to abort installation.
    """
    await websocket.accept()
    
    installer = None
    install_task = None
    
    try:
        # Wait for start message
        msg = await websocket.receive_json()
        
        if msg.get("action") != "start":
            await websocket.send_json({
                "type": "error",
                "message": "Expected 'start' action",
            })
            return
        
        platform_name = msg.get("platform") or _get_current_platform()
        deps = msg.get("dependencies")  # None = all
        skip_optional = msg.get("skip_optional", False)
        
        # Create installer
        installer = DependencyInstaller()
        
        # Set up progress streaming
        async def stream_progress():
            installed = []
            failed = []
            skipped = []
            
            try:
                if deps:
                    for dep_name in deps:
                        async for progress in installer.install_one(platform_name, dep_name):
                            await websocket.send_json({
                                "type": "progress",
                                "data": progress.to_dict(),
                            })
                            
                            if progress.state == InstallState.SUCCESS:
                                installed.append(progress.dependency)
                            elif progress.state == InstallState.FAILED:
                                failed.append(progress.dependency)
                else:
                    async for progress in installer.install_all(
                        platform_name,
                        skip_optional=skip_optional,
                    ):
                        await websocket.send_json({
                            "type": "progress",
                            "data": progress.to_dict(),
                        })
                        
                        if progress.dependency != "__summary__":
                            if progress.state == InstallState.SUCCESS:
                                installed.append(progress.dependency)
                            elif progress.state == InstallState.FAILED:
                                failed.append(progress.dependency)
                            elif progress.state == InstallState.SKIPPED:
                                skipped.append(progress.dependency)
                
                # Send completion
                await websocket.send_json({
                    "type": "complete",
                    "data": {
                        "success": len(failed) == 0,
                        "installed": installed,
                        "failed": failed,
                        "skipped": skipped,
                    },
                })
                
            except asyncio.CancelledError:
                logger.info("Installation cancelled")
                raise
        
        # Start installation in background
        install_task = asyncio.create_task(stream_progress())
        
        # Listen for cancel messages
        while True:
            try:
                msg = await asyncio.wait_for(
                    websocket.receive_json(),
                    timeout=0.5,
                )
                
                if msg.get("action") == "cancel":
                    logger.info("Cancel requested by client")
                    if installer:
                        installer.cancel()
                    break
                    
            except asyncio.TimeoutError:
                # Check if install is done
                if install_task.done():
                    break
                continue
        
        # Wait for install task to finish
        if install_task and not install_task.done():
            install_task.cancel()
            try:
                await install_task
            except asyncio.CancelledError:
                pass
                
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        if installer:
            installer.cancel()
        if install_task:
            install_task.cancel()
            
    except Exception as e:
        logger.exception("WebSocket error")
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e),
            })
        except:
            pass


@router.get("/platforms")
async def list_platforms():
    """List all available platforms."""
    matrix = DependencyMatrix()
    
    platforms = []
    for name in matrix.get_all_platforms():
        platform_deps = matrix.get_platform(name)
        if platform_deps:
            platforms.append({
                "name": name,
                "description": platform_deps.description,
                "cli_tools_count": len(platform_deps.cli_tools),
                "cluster_components_count": len(platform_deps.cluster_components),
                "dependency_count": len(platform_deps.dependencies),
            })
    
    return {"platforms": platforms}


@router.get("/current-platform")
async def get_current_platform():
    """Get the detected current platform."""
    platform_name = _get_current_platform()
    
    matrix = DependencyMatrix()
    platform_deps = matrix.get_platform(platform_name)
    
    return {
        "platform": platform_name,
        "description": platform_deps.description if platform_deps else "Unknown platform",
        "is_supported": platform_deps is not None,
    }
