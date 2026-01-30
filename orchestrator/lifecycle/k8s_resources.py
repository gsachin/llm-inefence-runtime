"""
Kubernetes resource implementations for lifecycle management.

Implements ICloudResource for various Kubernetes objects that
the orchestrator deploys and tracks.
"""

from __future__ import annotations

import logging
import subprocess
from typing import Optional

from ..core.interfaces import ICloudResource, ResourceState

logger = logging.getLogger(__name__)


class HelmReleaseResource(ICloudResource):
    """
    Represents a Helm release as a trackable cloud resource.
    
    Wraps helm uninstall for destruction and queries release status.
    """

    def __init__(
        self,
        release_name: str,
        namespace: str,
        model: str = "",
        profile: str = "",
        cost_per_hour: float = 0.0,
    ):
        self.release_name = release_name
        self.namespace = namespace
        self.model = model
        self.profile = profile
        self._cost_per_hour = cost_per_hour
        self._state = ResourceState.ACTIVE
        self._provision_id = f"helm/{namespace}/{release_name}"

    def provision(self) -> bool:
        """Helm release is provisioned via helm upgrade --install."""
        # Provisioning happens outside this class via helm CLI
        return True

    def destroy(self) -> bool:
        """Uninstall the Helm release."""
        try:
            result = subprocess.run(
                ["helm", "uninstall", self.release_name, "-n", self.namespace],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                self._state = ResourceState.DESTROYED
                logger.info(f"Destroyed Helm release: {self.release_name}")
                return True
            else:
                logger.error(f"Failed to destroy Helm release: {result.stderr}")
                self._state = ResourceState.FAILED
                return False
        except Exception as e:
            logger.error(f"Error destroying Helm release: {e}")
            self._state = ResourceState.FAILED
            return False

    def get_cost_per_hour(self) -> float:
        """Return estimated hourly cost."""
        return self._cost_per_hour

    def get_state(self) -> ResourceState:
        """Query helm status to get current state."""
        try:
            result = subprocess.run(
                ["helm", "status", self.release_name, "-n", self.namespace, "-o", "json"],
                capture_output=True,
                text=True,
            )
            if result.returncode == 0:
                import json
                status_data = json.loads(result.stdout)
                helm_status = status_data.get("info", {}).get("status", "")
                
                if helm_status == "deployed":
                    self._state = ResourceState.ACTIVE
                elif helm_status in ["pending-install", "pending-upgrade"]:
                    self._state = ResourceState.PROVISIONING
                elif helm_status == "failed":
                    self._state = ResourceState.FAILED
                else:
                    self._state = ResourceState.PENDING
            else:
                # Release not found
                self._state = ResourceState.DESTROYED
        except Exception as e:
            logger.error(f"Error checking Helm status: {e}")
        
        return self._state

    def get_provision_id(self) -> Optional[str]:
        return self._provision_id

    def to_dict(self) -> dict:
        """Serialize for persistence."""
        return {
            "type": "helm_release",
            "release_name": self.release_name,
            "namespace": self.namespace,
            "model": self.model,
            "profile": self.profile,
            "cost_per_hour": self._cost_per_hour,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "HelmReleaseResource":
        """Deserialize from persistence."""
        return cls(
            release_name=data["release_name"],
            namespace=data["namespace"],
            model=data.get("model", ""),
            profile=data.get("profile", ""),
            cost_per_hour=data.get("cost_per_hour", 0.0),
        )


def discover_helm_releases(namespace: str = "llm") -> list[HelmReleaseResource]:
    """
    Discover existing Helm releases in a namespace.
    
    Returns:
        List of HelmReleaseResource for each release found
    """
    resources = []
    
    try:
        result = subprocess.run(
            ["helm", "list", "-n", namespace, "-o", "json"],
            capture_output=True,
            text=True,
        )
        
        if result.returncode == 0:
            import json
            releases = json.loads(result.stdout) if result.stdout.strip() else []
            
            for release in releases:
                resources.append(
                    HelmReleaseResource(
                        release_name=release.get("name", ""),
                        namespace=namespace,
                        model="",  # Would need to query values to get this
                        profile="",
                        cost_per_hour=0.0,
                    )
                )
    except Exception as e:
        logger.error(f"Error discovering Helm releases: {e}")
    
    return resources


def discover_inferenceservices(namespace: str = "llm") -> list[dict]:
    """
    Discover InferenceService resources directly from Kubernetes.
    
    Returns:
        List of InferenceService info dicts
    """
    services = []
    
    try:
        result = subprocess.run(
            ["kubectl", "get", "inferenceservice", "-n", namespace, "-o", "json"],
            capture_output=True,
            text=True,
        )
        
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            items = data.get("items", [])
            
            for item in items:
                metadata = item.get("metadata", {})
                spec = item.get("spec", {})
                status = item.get("status", {})
                
                # Get predictor container spec for model info
                predictor = spec.get("predictor", {})
                containers = predictor.get("containers", [])
                
                model = ""
                for container in containers:
                    for env in container.get("env", []):
                        if env.get("name") == "MODEL_ID":
                            model = env.get("value", "")
                            break
                
                # Check if ready
                conditions = status.get("conditions", [])
                is_ready = any(
                    c.get("type") == "Ready" and c.get("status") == "True"
                    for c in conditions
                )
                
                services.append({
                    "name": metadata.get("name", ""),
                    "namespace": metadata.get("namespace", namespace),
                    "model": model,
                    "ready": is_ready,
                    "url": status.get("url", ""),
                    "created_at": metadata.get("creationTimestamp", ""),
                })
    except Exception as e:
        logger.error(f"Error discovering InferenceServices: {e}")
    
    return services
