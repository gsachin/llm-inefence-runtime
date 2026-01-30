"""
State Reconciler - Compares local state with cloud reality.

Solves the "Split-Brain" problem where local state diverges from cloud:
- User manually deletes resources via cloud console
- App crashes during provisioning
- Network issues during destroy

Uses cloud discovery to verify resource existence and state.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional, TYPE_CHECKING

from ..core.interfaces import ICloudDiscovery, ResourceState

if TYPE_CHECKING:
    from .manager import ResourceLifecycleManager

logger = logging.getLogger(__name__)


class ReconciliationResult(Enum):
    """Possible outcomes of reconciling a resource."""

    IN_SYNC = "in_sync"
    ORPHANED_LOCAL = "orphaned_local"  # Local says active, cloud says gone
    ORPHANED_CLOUD = "orphaned_cloud"  # Cloud has resource, local doesn't track
    STATE_MISMATCH = "state_mismatch"  # Both exist but states differ


class StateReconciler:
    """
    Reconciles local state with cloud reality.
    Follows Single Responsibility Principle.
    """

    def __init__(
        self,
        lifecycle_manager: "ResourceLifecycleManager",
        cloud_discovery: ICloudDiscovery,
    ):
        """
        Initialize the reconciler.

        Args:
            lifecycle_manager: Local resource state manager
            cloud_discovery: Cloud provider discovery interface
        """
        self.lifecycle = lifecycle_manager
        self.discovery = cloud_discovery
        self.reconciliation_log: List[Dict[str, Any]] = []

    async def full_reconciliation(self) -> Dict[str, ReconciliationResult]:
        """
        Compare local state with cloud state for all resources.

        Returns:
            Dict mapping resource_id to reconciliation result
        """
        results = {}

        # 1. Check locally tracked resources against cloud
        for resource_id, resource in self.lifecycle.resources.items():
            provision_id = resource.get_provision_id()

            if not provision_id:
                continue

            cloud_state = await self.discovery.get_resource_state(provision_id)
            local_state = resource.get_state()

            if cloud_state is None and local_state.value in ["active", "provisioning"]:
                # Cloud resource is gone, but local thinks it's active
                results[resource_id] = ReconciliationResult.ORPHANED_LOCAL
                self._log_discrepancy(
                    resource_id,
                    "ORPHANED_LOCAL",
                    f"Local={local_state.value}, Cloud=NOT_FOUND",
                )

            elif cloud_state and local_state == ResourceState.DESTROYED:
                # Cloud resource exists, but local thinks it's destroyed
                results[resource_id] = ReconciliationResult.STATE_MISMATCH
                self._log_discrepancy(
                    resource_id,
                    "STATE_MISMATCH",
                    f"Local={local_state.value}, Cloud={cloud_state}",
                )

            else:
                results[resource_id] = ReconciliationResult.IN_SYNC

        # 2. Check orphaned metadata (resources from previous sessions)
        for resource_id, meta in self.lifecycle.get_orphaned_metadata().items():
            provision_id = meta.get("provision_id")

            if not provision_id:
                continue

            cloud_state = await self.discovery.get_resource_state(provision_id)

            if cloud_state is None:
                # Resource was orphaned locally but no longer exists in cloud
                results[resource_id] = ReconciliationResult.ORPHANED_LOCAL
                self._log_discrepancy(
                    resource_id,
                    "ORPHANED_LOCAL",
                    "Orphaned metadata, Cloud=NOT_FOUND",
                )
            else:
                # Resource still exists in cloud!
                results[resource_id] = ReconciliationResult.ORPHANED_CLOUD
                self._log_discrepancy(
                    resource_id,
                    "ORPHANED_CLOUD",
                    f"Orphaned metadata, Cloud={cloud_state}",
                )

        # 3. Discover cloud resources not tracked locally
        for resource_type in ["eks_cluster", "ec2_instance", "k8s_cluster"]:
            try:
                cloud_resources = await self.discovery.list_resources(resource_type)
            except Exception as e:
                logger.warning(f"Failed to discover {resource_type}: {e}")
                continue

            for cloud_res in cloud_resources:
                provision_id = cloud_res.get("provision_id")

                if not provision_id:
                    continue

                # Check if we track this resource
                tracked = any(
                    r.get_provision_id() == provision_id
                    for r in self.lifecycle.resources.values()
                )

                # Also check orphaned metadata
                in_metadata = any(
                    meta.get("provision_id") == provision_id
                    for meta in self.lifecycle._resource_metadata.values()
                )

                if not tracked and not in_metadata:
                    results[provision_id] = ReconciliationResult.ORPHANED_CLOUD
                    self._log_discrepancy(
                        provision_id,
                        "ORPHANED_CLOUD",
                        "Cloud resource exists but not tracked locally",
                    )

        return results

    def _log_discrepancy(self, resource_id: str, result_type: str, detail: str) -> None:
        """Log a state discrepancy for audit trail."""
        entry = {
            "timestamp": datetime.utcnow().isoformat(),
            "resource_id": resource_id,
            "result": result_type,
            "detail": detail,
        }
        self.reconciliation_log.append(entry)
        logger.warning(f"Reconciliation discrepancy: {entry}")

    async def auto_fix(
        self,
        results: Dict[str, ReconciliationResult],
        destroy_orphaned_cloud: bool = False,
    ) -> Dict[str, str]:
        """
        Automatically fix discrepancies where safe.

        Args:
            results: Results from full_reconciliation()
            destroy_orphaned_cloud: If True, destroy orphaned cloud resources
                                    (DANGEROUS - defaults to False)

        Returns:
            Dict mapping resource_id to action taken
        """
        actions = {}

        for resource_id, result in results.items():

            if result == ReconciliationResult.ORPHANED_LOCAL:
                # Cloud is gone, clean up local state
                if resource_id in self.lifecycle.resources:
                    self.lifecycle.unregister_resource(resource_id)
                    actions[resource_id] = "Removed stale local entry"
                elif resource_id in self.lifecycle._resource_metadata:
                    self.lifecycle.clear_orphaned_metadata(resource_id)
                    actions[resource_id] = "Cleared orphaned metadata"

            elif result == ReconciliationResult.ORPHANED_CLOUD:
                if destroy_orphaned_cloud:
                    # DANGEROUS: Auto-destroy cloud resources
                    # This should only be used with explicit user confirmation
                    actions[resource_id] = "WOULD_DESTROY (not implemented for safety)"
                else:
                    # Safe default: Just notify
                    actions[resource_id] = "MANUAL_ACTION_REQUIRED: Orphaned cloud resource"

            elif result == ReconciliationResult.STATE_MISMATCH:
                # Sync local state to match cloud
                # This is complex and depends on the specific mismatch
                actions[resource_id] = "STATE_SYNC_REQUIRED"

        return actions

    def get_discrepancies(self, results: Dict[str, ReconciliationResult]) -> Dict[str, ReconciliationResult]:
        """Filter results to only discrepancies (not in-sync)."""
        return {
            k: v
            for k, v in results.items()
            if v != ReconciliationResult.IN_SYNC
        }

    def get_recent_logs(self, limit: int = 50) -> List[Dict[str, Any]]:
        """Get recent reconciliation log entries."""
        return self.reconciliation_log[-limit:]


class ReconciliationScheduler:
    """
    Runs reconciliation in the background on a schedule.
    Follows Single Responsibility Principle.
    """

    def __init__(
        self,
        reconciler: StateReconciler,
        interval_minutes: int = 5,
        on_discrepancy: Optional[Callable[[Dict[str, ReconciliationResult]], None]] = None,
    ):
        """
        Initialize the scheduler.

        Args:
            reconciler: The StateReconciler instance
            interval_minutes: How often to run reconciliation
            on_discrepancy: Callback when discrepancies are found
        """
        self.reconciler = reconciler
        self.interval = interval_minutes * 60
        self.on_discrepancy = on_discrepancy
        self._task: Optional[asyncio.Task] = None
        self._running = False

    async def start(self) -> None:
        """Start the background reconciliation loop."""
        if self._running:
            logger.warning("Reconciliation scheduler already running")
            return

        self._running = True
        self._task = asyncio.create_task(self._loop())
        logger.info(f"Started reconciliation scheduler (interval={self.interval}s)")

    async def stop(self) -> None:
        """Stop the background reconciliation loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        logger.info("Stopped reconciliation scheduler")

    async def run_now(self) -> Dict[str, ReconciliationResult]:
        """Trigger an immediate reconciliation."""
        return await self.reconciler.full_reconciliation()

    async def _loop(self) -> None:
        """Background loop that runs reconciliation periodically."""
        while self._running:
            try:
                results = await self.reconciler.full_reconciliation()

                discrepancies = self.reconciler.get_discrepancies(results)

                if discrepancies:
                    logger.warning(f"Found {len(discrepancies)} state discrepancies")

                    if self.on_discrepancy:
                        self.on_discrepancy(discrepancies)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Reconciliation failed: {e}")

            await asyncio.sleep(self.interval)
