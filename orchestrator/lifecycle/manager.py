"""
Resource Lifecycle Manager - Tracks cloud resources for cleanup and cost monitoring.

Key responsibilities:
- Track provisioned resources with state persistence
- Provide "Global Kill Switch" for emergency cleanup
- Calculate real-time cost burn rate
- Enable session recovery after app crashes
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Dict, Optional, TYPE_CHECKING

from ..core.interfaces import ICloudResource, ResourceState

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class ResourceLifecycleManager:
    """
    Manages all provisioned resources with cleanup tracking.
    Follows Single Responsibility Principle.
    """

    DEFAULT_STATE_FILE = "~/.mlops-wizard/resources.json"

    def __init__(self, state_file: str | None = None):
        """
        Initialize the lifecycle manager.

        Args:
            state_file: Path to persist resource state (for recovery)
        """
        self.state_file = os.path.expanduser(state_file or self.DEFAULT_STATE_FILE)
        self.resources: Dict[str, ICloudResource] = {}
        self._resource_metadata: Dict[str, dict] = {}
        self._ensure_directory()
        self._load_state()

    def _ensure_directory(self) -> None:
        state_dir = os.path.dirname(self.state_file)
        if not os.path.exists(state_dir):
            os.makedirs(state_dir, mode=0o700)

    # =========================================================================
    # Resource Registration
    # =========================================================================

    def register_resource(
        self,
        resource_id: str,
        resource: ICloudResource,
        metadata: dict | None = None,
    ) -> None:
        """
        Track a resource for lifecycle management.

        Args:
            resource_id: Unique identifier for this resource
            resource: The cloud resource instance
            metadata: Optional metadata (cost_per_hour, description, etc.)
        """
        self.resources[resource_id] = resource
        self._resource_metadata[resource_id] = metadata or {}
        self._resource_metadata[resource_id]["registered_at"] = datetime.utcnow().isoformat()
        self._persist_state()
        logger.info(f"Registered resource: {resource_id}")

    def unregister_resource(self, resource_id: str) -> bool:
        """
        Stop tracking a resource (e.g., after successful destroy).

        Args:
            resource_id: The resource to unregister

        Returns:
            True if resource was found and removed
        """
        if resource_id in self.resources:
            del self.resources[resource_id]
            if resource_id in self._resource_metadata:
                del self._resource_metadata[resource_id]
            self._persist_state()
            logger.info(f"Unregistered resource: {resource_id}")
            return True
        return False

    # =========================================================================
    # Resource Destruction
    # =========================================================================

    def destroy_resource(self, resource_id: str) -> bool:
        """
        Destroy a single resource.

        Args:
            resource_id: The resource to destroy

        Returns:
            True if destruction was successful
        """
        resource = self.resources.get(resource_id)
        if not resource:
            logger.warning(f"Resource not found: {resource_id}")
            return False

        try:
            success = resource.destroy()
            if success:
                self.unregister_resource(resource_id)
                logger.info(f"Destroyed resource: {resource_id}")
            else:
                logger.error(f"Failed to destroy resource: {resource_id}")
            return success
        except Exception as e:
            logger.error(f"Error destroying resource {resource_id}: {e}")
            return False

    def destroy_all(self) -> Dict[str, bool]:
        """
        Global kill switch - destroy all tracked resources.

        Returns:
            Dict mapping resource_id to destruction success/failure
        """
        results = {}
        resource_ids = list(self.resources.keys())

        for resource_id in resource_ids:
            results[resource_id] = self.destroy_resource(resource_id)

        self._persist_state()
        return results

    # =========================================================================
    # Cost Monitoring
    # =========================================================================

    def get_total_cost_per_hour(self) -> float:
        """
        Calculate the current burn rate across all resources.

        Returns:
            Total cost per hour in USD
        """
        return sum(
            resource.get_cost_per_hour()
            for resource in self.resources.values()
            if resource.get_state() == ResourceState.ACTIVE
        )

    def get_cost_breakdown(self) -> Dict[str, float]:
        """
        Get per-resource cost breakdown.

        Returns:
            Dict mapping resource_id to hourly cost
        """
        return {
            resource_id: resource.get_cost_per_hour()
            for resource_id, resource in self.resources.items()
            if resource.get_state() == ResourceState.ACTIVE
        }

    # =========================================================================
    # State Query
    # =========================================================================

    def get_resource(self, resource_id: str) -> Optional[ICloudResource]:
        """Get a tracked resource by ID."""
        return self.resources.get(resource_id)

    def list_resources(self, state_filter: ResourceState | None = None) -> Dict[str, dict]:
        """
        List all tracked resources with their metadata.

        Args:
            state_filter: If provided, only return resources in this state

        Returns:
            Dict mapping resource_id to resource info
        """
        result = {}

        for resource_id, resource in self.resources.items():
            current_state = resource.get_state()

            if state_filter and current_state != state_filter:
                continue

            result[resource_id] = {
                "state": current_state.value,
                "provision_id": resource.get_provision_id(),
                "cost_per_hour": resource.get_cost_per_hour(),
                "type": resource.__class__.__name__,
                **self._resource_metadata.get(resource_id, {}),
            }

        return result

    def has_active_resources(self) -> bool:
        """Check if there are any active (running) resources."""
        return any(
            resource.get_state() == ResourceState.ACTIVE
            for resource in self.resources.values()
        )

    # =========================================================================
    # State Persistence
    # =========================================================================

    def _persist_state(self) -> None:
        """Save resource IDs and metadata for recovery after crash."""
        state = {
            "version": 1,
            "updated_at": datetime.utcnow().isoformat(),
            "resources": {},
        }

        for resource_id, resource in self.resources.items():
            state["resources"][resource_id] = {
                "type": resource.__class__.__name__,
                "state": resource.get_state().value,
                "provision_id": resource.get_provision_id(),
                "metadata": self._resource_metadata.get(resource_id, {}),
            }

        with open(self.state_file, "w") as f:
            json.dump(state, f, indent=2)

        logger.debug(f"Persisted state to {self.state_file}")

    def _load_state(self) -> None:
        """
        Load previously tracked resources from state file.

        Note: This only loads metadata. Actual resource objects need to be
        reconstructed by the reconciler using cloud discovery.
        """
        if not os.path.exists(self.state_file):
            return

        try:
            with open(self.state_file, "r") as f:
                state = json.load(f)

            version = state.get("version", 0)
            if version != 1:
                logger.warning(f"Unknown state file version: {version}")
                return

            resources_data = state.get("resources", {})

            for resource_id, info in resources_data.items():
                stored_state = info.get("state")
                if stored_state in ["active", "provisioning"]:
                    # Resource might still be running - needs reconciliation
                    logger.warning(
                        f"Found potentially orphaned resource: {resource_id} "
                        f"(state={stored_state})"
                    )
                    self._resource_metadata[resource_id] = {
                        "type": info.get("type"),
                        "provision_id": info.get("provision_id"),
                        "needs_reconciliation": True,
                        **info.get("metadata", {}),
                    }

            logger.info(f"Loaded state from {self.state_file}")

        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse state file: {e}")
        except Exception as e:
            logger.error(f"Failed to load state: {e}")

    def get_orphaned_metadata(self) -> Dict[str, dict]:
        """
        Get metadata for resources that need reconciliation.

        These are resources that were active when the app last closed
        but don't have corresponding resource objects (e.g., after restart).
        """
        return {
            resource_id: meta
            for resource_id, meta in self._resource_metadata.items()
            if meta.get("needs_reconciliation") and resource_id not in self.resources
        }

    def clear_orphaned_metadata(self, resource_id: str) -> None:
        """Mark an orphaned resource as reconciled."""
        if resource_id in self._resource_metadata:
            self._resource_metadata[resource_id]["needs_reconciliation"] = False
            self._persist_state()
