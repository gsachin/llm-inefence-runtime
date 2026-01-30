"""
Platform detection and feasibility API routes.

Provides endpoints for:
- Detecting current platform
- Probing hardware capabilities
- Getting feasibility assessment for profiles
- Getting K8s engine recommendations
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..platform import MacAdapter, WSL2Adapter, LinuxGPUAdapter, PlatformDetector
from ..platform.base import detect_platform

logger = logging.getLogger(__name__)
router = APIRouter()

# Register platform adapters
PlatformDetector.register_adapter(MacAdapter())
PlatformDetector.register_adapter(WSL2Adapter())
PlatformDetector.register_adapter(LinuxGPUAdapter())


class PlatformInfo(BaseModel):
    platform_name: str
    system: str
    machine: str
    is_supported: bool


class HardwareProbe(BaseModel):
    arch: str
    platform: str
    ram_gb: float
    disk_free_gb: float
    gpu_type: Optional[str] = None
    gpu_count: int = 0
    vram_gb: float = 0
    cuda_available: bool = False
    metal_support: bool = False
    extra: Dict[str, Any] = {}


class FeasibilityResponse(BaseModel):
    status: str  # supported, warning, unsupported
    actions: List[Dict[str, Any]]
    recommended_profiles: List[str]
    environment_config: Dict[str, Any]
    hardware: Dict[str, Any]


class K8sEngineRecommendation(BaseModel):
    recommended: str
    alternatives: List[str]
    install_cmd: str
    reason: str


@router.get("/detect", response_model=PlatformInfo)
async def detect_current_platform():
    """
    Detect the current platform.

    Returns platform identifier and basic system info.
    """
    basic_info = detect_platform()
    adapter = PlatformDetector.detect()

    if adapter:
        platform_name = adapter.platform_name
        is_supported = True
    else:
        platform_name = "unknown"
        is_supported = False

    return PlatformInfo(
        platform_name=platform_name,
        system=basic_info["system"],
        machine=basic_info["machine"],
        is_supported=is_supported,
    )


@router.get("/hardware", response_model=HardwareProbe)
async def probe_hardware():
    """
    Probe hardware capabilities of the current platform.

    Returns CPU, memory, GPU, and disk information.
    """
    adapter = PlatformDetector.detect()

    if not adapter:
        raise HTTPException(
            status_code=400,
            detail="Platform not supported. Cannot probe hardware."
        )

    hw = adapter.probe_hardware()

    return HardwareProbe(
        arch=hw.get("arch", "unknown"),
        platform=hw.get("platform", "unknown"),
        ram_gb=hw.get("ram_gb", 0),
        disk_free_gb=hw.get("disk_free_gb", 0),
        gpu_type=hw.get("gpu_type"),
        gpu_count=hw.get("gpu_count", 0),
        vram_gb=hw.get("vram_gb", 0),
        cuda_available=hw.get("cuda_available", False),
        metal_support=hw.get("metal_support", False),
        extra={k: v for k, v in hw.items() if k not in [
            "arch", "platform", "ram_gb", "disk_free_gb",
            "gpu_type", "gpu_count", "vram_gb", "cuda_available", "metal_support"
        ]},
    )


@router.post("/feasibility", response_model=FeasibilityResponse)
async def get_feasibility(profile: Dict[str, Any]):
    """
    Get feasibility assessment for a deployment profile.

    Args:
        profile: The deployment profile to assess

    Returns:
        Feasibility status, required actions, and recommendations
    """
    adapter = PlatformDetector.detect()

    if not adapter:
        raise HTTPException(
            status_code=400,
            detail="Platform not supported. Cannot assess feasibility."
        )

    result = adapter.get_feasibility(profile)

    return FeasibilityResponse(
        status=result.get("status", "unknown"),
        actions=result.get("actions", []),
        recommended_profiles=result.get("recommended_profiles", []),
        environment_config=result.get("environment_config", {}),
        hardware=result.get("hardware", {}),
    )


@router.get("/k8s-engine", response_model=K8sEngineRecommendation)
async def get_k8s_engine_recommendation():
    """
    Get recommended Kubernetes engine for the current platform.
    """
    adapter = PlatformDetector.detect()

    if not adapter:
        raise HTTPException(
            status_code=400,
            detail="Platform not supported."
        )

    recommendation = adapter.get_k8s_engine_recommendation()

    return K8sEngineRecommendation(**recommendation)


@router.get("/cache-path")
async def get_optimal_cache_path():
    """
    Get the optimal model cache path for the current platform.
    """
    adapter = PlatformDetector.detect()

    if not adapter:
        raise HTTPException(
            status_code=400,
            detail="Platform not supported."
        )

    path = adapter.get_optimal_cache_path()

    return {"cache_path": path}


@router.get("/toolchain")
async def check_toolchain(runtime: str = "vllm_mps"):
    """
    Check toolchain status for the current platform.

    Args:
        runtime: Runtime to check (vllm_mps, mlx_lm)
    """
    adapter = PlatformDetector.detect()

    if not adapter:
        raise HTTPException(
            status_code=400,
            detail="Platform not supported."
        )

    # Only Mac adapter has toolchain check
    if hasattr(adapter, "check_toolchain"):
        return adapter.check_toolchain(runtime)

    # Linux GPU adapter has GPU stack check
    if hasattr(adapter, "check_gpu_container_stack"):
        return adapter.check_gpu_container_stack()

    return {"message": "No toolchain check available for this platform"}
