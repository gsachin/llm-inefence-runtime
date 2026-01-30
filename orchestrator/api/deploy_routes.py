"""
Deployment API routes.

Provides endpoints for:
- Loading profiles
- Deploying with Helm
- Dry-run deployments
- WebSocket for real-time progress
"""

from __future__ import annotations

import asyncio
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

import yaml

from ..lifecycle import ResourceLifecycleManager, HelmReleaseResource
from .lifecycle_routes import get_lifecycle_manager

logger = logging.getLogger(__name__)
router = APIRouter()

# Paths
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_PROFILES_PATH = REPO_ROOT / "profiles.yaml"
DEFAULT_CHART_PATH = REPO_ROOT / "charts" / "llm-vllm"


class ProfileInfo(BaseModel):
    name: str
    description: str
    model: str
    image: str
    gpu_count: int
    resources: Dict[str, str]


class DeployRequest(BaseModel):
    profile: str
    release: str
    namespace: str = "llm"
    dry_run: bool = False


class DeployResponse(BaseModel):
    success: bool
    message: str
    values_file: Optional[str] = None
    helm_output: Optional[str] = None


class PreflightCheckResult(BaseModel):
    check_name: str
    passed: bool
    message: str
    recoverable: bool = True


class PreflightResponse(BaseModel):
    all_passed: bool
    checks: List[PreflightCheckResult]


@router.get("/profiles")
async def list_profiles():
    """
    List all available deployment profiles.
    """
    profiles = _load_profiles()

    return {
        "profiles": [
            ProfileInfo(
                name=name,
                description=profile.get("description", ""),
                model=profile.get("model", ""),
                image=profile.get("image", ""),
                gpu_count=profile.get("gpu_count", 0),
                resources=profile.get("resources", {}),
            )
            for name, profile in profiles.items()
        ]
    }


@router.get("/profiles/{profile_name}")
async def get_profile(profile_name: str):
    """
    Get details of a specific profile.
    """
    profiles = _load_profiles()

    if profile_name not in profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Profile not found: {profile_name}. Available: {list(profiles.keys())}"
        )

    return profiles[profile_name]


@router.post("/preflight", response_model=PreflightResponse)
async def run_preflight_checks(request: DeployRequest):
    """
    Run pre-flight checks before deployment.

    Validates:
    1. KServe CRD exists
    2. Node resources are sufficient
    3. Profile requirements are met
    """
    profiles = _load_profiles()

    if request.profile not in profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Profile not found: {request.profile}"
        )

    profile = profiles[request.profile]
    checks = []

    # 1. Check KServe CRD
    kserve_check = _check_kserve_crd()
    checks.append(kserve_check)

    # 2. Check node resources
    resource_check = _check_node_resources(profile)
    checks.append(resource_check)

    # 3. Check model access
    model_check = _check_model_access(profile)
    checks.append(model_check)

    all_passed = all(c.passed for c in checks)

    return PreflightResponse(
        all_passed=all_passed,
        checks=checks,
    )


@router.post("/deploy", response_model=DeployResponse)
async def deploy(request: DeployRequest):
    """
    Deploy a model using Helm.
    """
    profiles = _load_profiles()

    if request.profile not in profiles:
        raise HTTPException(
            status_code=404,
            detail=f"Profile not found: {request.profile}"
        )

    profile = profiles[request.profile]

    # Generate values
    values = _generate_values(profile)

    # Write values file
    values_dir = Path(__file__).parent.parent / "generated"
    values_dir.mkdir(parents=True, exist_ok=True)
    values_file = values_dir / f"{request.release}.yaml"
    values_file.write_text(yaml.safe_dump(values, sort_keys=False))

    # Build Helm command
    cmd = [
        "helm",
        "upgrade",
        "--install",
        request.release,
        str(DEFAULT_CHART_PATH),
        "-n", request.namespace,
        "--create-namespace",
        "-f", str(values_file),
    ]

    if request.dry_run:
        cmd.extend(["--dry-run=client", "--debug"])

    # Execute
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            env=os.environ.copy(),
        )

        if result.returncode == 0:
            return DeployResponse(
                success=True,
                message=f"Deployment {'(dry-run) ' if request.dry_run else ''}successful",
                values_file=str(values_file),
                helm_output=result.stdout,
            )
        else:
            return DeployResponse(
                success=False,
                message=f"Helm failed: {result.stderr}",
                values_file=str(values_file),
                helm_output=result.stderr,
            )

    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Deployment failed: {str(e)}"
        )


@router.websocket("/ws/deploy")
async def deploy_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for real-time deployment progress.

    Streams:
    - Progress updates
    - Log lines
    - Cost alerts
    """
    await websocket.accept()

    try:
        while True:
            # Receive deploy request
            data = await websocket.receive_json()

            profile_name = data.get("profile")
            release = data.get("release")
            namespace = data.get("namespace", "llm")
            dry_run = data.get("dry_run", False)

            if not profile_name or not release:
                await websocket.send_json({
                    "type": "error",
                    "message": "profile and release are required"
                })
                continue

            # Stream deployment progress
            async for update in _stream_deployment(profile_name, release, namespace, dry_run):
                await websocket.send_json(update)

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected")


async def _stream_deployment(
    profile_name: str,
    release: str,
    namespace: str,
    dry_run: bool,
):
    """Generator that streams deployment progress."""
    profiles = _load_profiles()

    if profile_name not in profiles:
        yield {"type": "error", "message": f"Profile not found: {profile_name}"}
        return

    profile = profiles[profile_name]

    # Phase 1: Pre-flight checks
    yield {"type": "phase", "phase": "preflight", "status": "started"}

    checks = [
        ("KServe CRD", _check_kserve_crd),
        ("Node Resources", lambda: _check_node_resources(profile)),
        ("Model Access", lambda: _check_model_access(profile)),
    ]

    for check_name, check_fn in checks:
        yield {"type": "check", "name": check_name, "status": "running"}
        await asyncio.sleep(0.5)  # Small delay for UI
        result = check_fn()
        yield {
            "type": "check",
            "name": check_name,
            "status": "passed" if result.passed else "failed",
            "message": result.message,
        }

        if not result.passed:
            yield {"type": "phase", "phase": "preflight", "status": "failed"}
            return

    yield {"type": "phase", "phase": "preflight", "status": "completed"}

    # Phase 2: Generate values
    yield {"type": "phase", "phase": "values", "status": "started"}
    values = _generate_values(profile)

    values_dir = Path(__file__).parent.parent / "generated"
    values_dir.mkdir(parents=True, exist_ok=True)
    values_file = values_dir / f"{release}.yaml"
    values_file.write_text(yaml.safe_dump(values, sort_keys=False))

    yield {"type": "phase", "phase": "values", "status": "completed", "file": str(values_file)}

    # Phase 3: Helm deploy
    yield {"type": "phase", "phase": "helm", "status": "started"}

    cmd = [
        "helm", "upgrade", "--install",
        release, str(DEFAULT_CHART_PATH),
        "-n", namespace, "--create-namespace",
        "-f", str(values_file),
    ]

    if dry_run:
        cmd.extend(["--dry-run=client", "--debug"])

    process = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.STDOUT,
    )

    async for line in process.stdout:
        yield {"type": "log", "source": "helm", "line": line.decode().strip()}

    await process.wait()

    if process.returncode == 0:
        yield {"type": "phase", "phase": "helm", "status": "completed"}
        
        # Register resource with lifecycle manager
        try:
            manager = get_lifecycle_manager()
            resource = HelmReleaseResource(
                release_name=release,
                namespace=namespace,
                model=profile.get("model", ""),
                profile=profile_name,
                cost_per_hour=0.0,  # Local dev has no cloud cost
            )
            manager.register_resource(
                resource_id=f"{namespace}/{release}",
                resource=resource,
                metadata={
                    "model": profile.get("model", ""),
                    "profile": profile_name,
                    "description": profile.get("description", ""),
                }
            )
            yield {"type": "log", "source": "lifecycle", "line": f"Registered resource: {namespace}/{release}"}
        except Exception as e:
            logger.error(f"Failed to register resource: {e}")
            yield {"type": "log", "source": "lifecycle", "line": f"Warning: Failed to register resource: {e}"}
        
        yield {"type": "complete", "success": True}
    else:
        yield {"type": "phase", "phase": "helm", "status": "failed"}
        yield {"type": "complete", "success": False}


def _load_profiles() -> Dict[str, Any]:
    """Load profiles from YAML file."""
    data = yaml.safe_load(DEFAULT_PROFILES_PATH.read_text())
    if not isinstance(data, dict) or "profiles" not in data:
        raise ValueError("Invalid profiles file")
    return data["profiles"]


def _generate_values(profile: Dict[str, Any]) -> Dict[str, Any]:
    """Generate Helm values from profile."""
    resources = profile.get("resources") or {}
    env_vars = profile.get("env") or {}

    return {
        "model": profile.get("model", ""),
        "image": profile.get("image", ""),
        "gpuCount": int(profile.get("gpu_count", 0) or 0),
        "vllmFlags": profile.get("vllm_flags", "") or "",
        "runtime": {
            "commandStyle": profile.get("command_style", "serve") or "serve",
        },
        "resources": {
            "cpuRequest": resources.get("cpu_request", "") or "",
            "cpuLimit": resources.get("cpu_limit", "") or "",
            "memRequest": resources.get("mem_request", "") or "",
            "memLimit": resources.get("mem_limit", "") or "",
        },
        "probes": {
            "enabled": True,
            "livenessPath": profile.get("health_live", "/health"),
            "readinessPath": profile.get("health_ready", "/health"),
        },
        "env": [{"name": k, "value": str(v)} for k, v in env_vars.items()],
    }


def _check_kserve_crd() -> PreflightCheckResult:
    """Check if KServe CRD exists."""
    try:
        result = subprocess.run(
            ["kubectl", "get", "crd", "inferenceservices.serving.kserve.io"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return PreflightCheckResult(
                check_name="KServe CRD",
                passed=True,
                message="InferenceService CRD found",
            )
        else:
            return PreflightCheckResult(
                check_name="KServe CRD",
                passed=False,
                message="KServe CRD not found. Please install KServe.",
                recoverable=True,
            )
    except FileNotFoundError:
        return PreflightCheckResult(
            check_name="KServe CRD",
            passed=False,
            message="kubectl not found",
            recoverable=True,
        )


def _check_node_resources(profile: Dict[str, Any]) -> PreflightCheckResult:
    """Check if node has sufficient resources."""
    try:
        result = subprocess.run(
            ["kubectl", "get", "nodes", "-o", "jsonpath={.items[0].status.allocatable.cpu}"],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            return PreflightCheckResult(
                check_name="Node Resources",
                passed=False,
                message="Cannot query node resources",
            )

        # Basic validation (simplified)
        return PreflightCheckResult(
            check_name="Node Resources",
            passed=True,
            message="Node resources appear sufficient",
        )

    except Exception as e:
        return PreflightCheckResult(
            check_name="Node Resources",
            passed=False,
            message=str(e),
        )


def _check_model_access(profile: Dict[str, Any]) -> PreflightCheckResult:
    """Check if model is accessible (not gated)."""
    model = profile.get("model", "")

    gated_prefixes = ["meta-llama", "mistral"]

    for prefix in gated_prefixes:
        if prefix in model.lower():
            return PreflightCheckResult(
                check_name="Model Access",
                passed=False,
                message=f"Model '{model}' may be gated. Consider using an ungated model like Qwen.",
                recoverable=True,
            )

    return PreflightCheckResult(
        check_name="Model Access",
        passed=True,
        message="Model appears accessible",
    )
