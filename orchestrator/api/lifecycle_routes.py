"""
Resource lifecycle management API routes.

Provides endpoints for:
- Listing tracked resources
- Getting cost breakdown
- Destroying individual resources
- Global kill switch (destroy all)
"""

from __future__ import annotations

import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..lifecycle import ResourceLifecycleManager
from ..lifecycle import discover_helm_releases, HelmReleaseResource
from ..core.interfaces import ResourceState

logger = logging.getLogger(__name__)
router = APIRouter()


# Response models
class ResourceInfo(BaseModel):
    resource_id: str
    resource_type: str
    state: str
    provision_id: Optional[str]
    cost_per_hour: float
    metadata: Dict = {}


class ResourceListResponse(BaseModel):
    resources: List[ResourceInfo]
    total_cost_per_hour: float
    has_active_resources: bool


class CostBreakdownResponse(BaseModel):
    total_cost_per_hour: float
    breakdown: Dict[str, float]
    estimated_daily_cost: float
    estimated_monthly_cost: float


class DestroyResponse(BaseModel):
    success: bool
    destroyed: List[str]
    failed: List[str]
    savings_per_hour: float


# Singleton lifecycle manager
_lifecycle_manager: Optional[ResourceLifecycleManager] = None


def get_lifecycle_manager() -> ResourceLifecycleManager:
    """Get or create the lifecycle manager instance."""
    global _lifecycle_manager
    if _lifecycle_manager is None:
        _lifecycle_manager = ResourceLifecycleManager()
    return _lifecycle_manager


@router.get("/resources", response_model=ResourceListResponse)
async def list_resources(state: Optional[str] = None):
    """
    List all tracked resources.

    Args:
        state: Optional state filter (pending, active, failed, etc.)
    """
    manager = get_lifecycle_manager()

    state_filter = None
    if state:
        try:
            state_filter = ResourceState(state)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid state: {state}. Valid states: {[s.value for s in ResourceState]}"
            )

    resources_data = manager.list_resources(state_filter)

    resources = [
        ResourceInfo(
            resource_id=rid,
            resource_type=info.get("type", "unknown"),
            state=info.get("state", "unknown"),
            provision_id=info.get("provision_id"),
            cost_per_hour=info.get("cost_per_hour", 0),
            metadata={k: v for k, v in info.items() if k not in ["type", "state", "provision_id", "cost_per_hour"]},
        )
        for rid, info in resources_data.items()
    ]

    return ResourceListResponse(
        resources=resources,
        total_cost_per_hour=manager.get_total_cost_per_hour(),
        has_active_resources=manager.has_active_resources(),
    )


@router.get("/cost", response_model=CostBreakdownResponse)
async def get_cost_breakdown():
    """
    Get current cost breakdown across all resources.

    Returns hourly, daily, and monthly estimates.
    """
    manager = get_lifecycle_manager()

    hourly = manager.get_total_cost_per_hour()
    breakdown = manager.get_cost_breakdown()

    return CostBreakdownResponse(
        total_cost_per_hour=hourly,
        breakdown=breakdown,
        estimated_daily_cost=hourly * 24,
        estimated_monthly_cost=hourly * 24 * 30,
    )


@router.delete("/resources/{resource_id}")
async def destroy_resource(resource_id: str):
    """
    Destroy a single tracked resource.

    Args:
        resource_id: The resource to destroy
    """
    manager = get_lifecycle_manager()

    resource = manager.get_resource(resource_id)
    if not resource:
        raise HTTPException(
            status_code=404,
            detail=f"Resource not found: {resource_id}"
        )

    cost_before = resource.get_cost_per_hour()
    success = manager.destroy_resource(resource_id)

    if success:
        logger.info(f"Destroyed resource: {resource_id}")
        return {
            "success": True,
            "resource_id": resource_id,
            "savings_per_hour": cost_before,
        }
    else:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to destroy resource: {resource_id}"
        )


@router.post("/destroy-all", response_model=DestroyResponse)
async def destroy_all_resources():
    """
    Global kill switch - destroy all tracked resources.

    Use this to prevent runaway cloud costs.
    """
    manager = get_lifecycle_manager()

    cost_before = manager.get_total_cost_per_hour()
    results = manager.destroy_all()

    destroyed = [rid for rid, success in results.items() if success]
    failed = [rid for rid, success in results.items() if not success]

    logger.warning(f"Global kill switch: destroyed {len(destroyed)}, failed {len(failed)}")

    return DestroyResponse(
        success=len(failed) == 0,
        destroyed=destroyed,
        failed=failed,
        savings_per_hour=cost_before,
    )


@router.get("/orphaned")
async def get_orphaned_resources():
    """
    Get resources that need reconciliation.

    These are resources that were active when the app last closed
    but don't have corresponding resource objects.
    """
    manager = get_lifecycle_manager()

    orphaned = manager.get_orphaned_metadata()

    return {
        "orphaned_count": len(orphaned),
        "resources": [
            {
                "resource_id": rid,
                "type": meta.get("type"),
                "provision_id": meta.get("provision_id"),
            }
            for rid, meta in orphaned.items()
        ],
    }


@router.post("/orphaned/{resource_id}/clear")
async def clear_orphaned_resource(resource_id: str):
    """
    Mark an orphaned resource as reconciled (no longer needs attention).

    Use this after manually cleaning up the resource in the cloud console.
    """
    manager = get_lifecycle_manager()

    orphaned = manager.get_orphaned_metadata()
    if resource_id not in orphaned:
        raise HTTPException(
            status_code=404,
            detail=f"Orphaned resource not found: {resource_id}"
        )

    manager.clear_orphaned_metadata(resource_id)
    logger.info(f"Cleared orphaned metadata: {resource_id}")

    return {"success": True, "resource_id": resource_id}


class SyncResponse(BaseModel):
    discovered: int
    registered: int
    already_tracked: int
    releases: List[str]


@router.post("/sync", response_model=SyncResponse)
async def sync_resources(namespace: str = "llm"):
    """
    Discover existing Helm releases and register them with the lifecycle manager.
    
    This is useful when resources exist from previous sessions or manual deployments.
    
    Args:
        namespace: Kubernetes namespace to scan for releases (default: llm)
    """
    manager = get_lifecycle_manager()
    
    # Discover helm releases in the namespace
    releases = discover_helm_releases(namespace)
    
    registered = 0
    already_tracked = 0
    release_names = []
    
    for release in releases:
        resource_id = f"{namespace}/{release.release_name}"
        release_names.append(resource_id)
        
        if manager.get_resource(resource_id):
            already_tracked += 1
            continue
        
        # Register the discovered release
        manager.register_resource(
            resource_id=resource_id,
            resource=release,
            metadata={
                "discovered": True,
                "namespace": namespace,
            }
        )
        registered += 1
        logger.info(f"Discovered and registered: {resource_id}")
    
    return SyncResponse(
        discovered=len(releases),
        registered=registered,
        already_tracked=already_tracked,
        releases=release_names,
    )
