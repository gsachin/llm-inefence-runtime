"""
Core interfaces for the MLOps Orchestration Framework.

These abstractions follow the Dependency Inversion Principle (DIP):
- High-level modules depend on abstractions, not concretions.
- Implementations are pluggable and testable.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from enum import Enum
from typing import Any, Callable, Dict, List, Optional


class ResourceState(Enum):
    """State machine states for cloud resources."""

    PENDING = "pending"
    PROVISIONING = "provisioning"
    ACTIVE = "active"
    FAILED = "failed"
    DESTROYING = "destroying"
    DESTROYED = "destroyed"


class DependencyState(Enum):
    """State machine states for dependency installation."""

    PENDING = "pending"
    CHECKING = "checking"
    INSTALLING = "installing"
    VERIFY = "verify"
    SUCCESS = "success"
    FAILED = "failed"
    CLEANING = "cleaning"
    RETRYING = "retrying"


class ICloudResource(ABC):
    """
    Interface for any cloud resource (SRP + DIP).
    Implementations: EKSClusterResource, EC2InstanceResource, etc.
    """

    @abstractmethod
    def provision(self) -> bool:
        """Provision the resource. Returns True on success."""
        pass

    @abstractmethod
    def destroy(self) -> bool:
        """Destroy the resource. Must be idempotent."""
        pass

    @abstractmethod
    def get_cost_per_hour(self) -> float:
        """Return the hourly cost of this resource in USD."""
        pass

    @abstractmethod
    def get_state(self) -> ResourceState:
        """Return the current state of the resource."""
        pass

    @abstractmethod
    def get_provision_id(self) -> Optional[str]:
        """Return the cloud provider's ID for this resource."""
        pass


class ICredentialStore(ABC):
    """
    Interface for secure credential storage (DIP).
    Implementations: KeychainStore, EncryptedFileStore, PassphraseDerivedStore
    """

    @abstractmethod
    def store(self, key: str, value: str) -> bool:
        """Store a credential. Returns True on success."""
        pass

    @abstractmethod
    def retrieve(self, key: str) -> Optional[str]:
        """Retrieve a credential. Returns None if not found."""
        pass

    @abstractmethod
    def delete(self, key: str) -> bool:
        """Delete a credential. Returns True on success."""
        pass

    @abstractmethod
    def exists(self, key: str) -> bool:
        """Check if a credential exists."""
        pass


class ICloudDiscovery(ABC):
    """
    Interface for cloud resource discovery (DIP).
    Used by StateReconciler to detect orphaned resources.
    """

    @abstractmethod
    async def list_resources(self, resource_type: str) -> List[Dict[str, Any]]:
        """Return all resources of a type from cloud provider."""
        pass

    @abstractmethod
    async def get_resource_state(self, provision_id: str) -> Optional[str]:
        """Get current state of a specific resource."""
        pass


class IPlatformAdapter(ABC):
    """
    Interface for platform-specific operations (OCP).
    Implementations: MacAdapter, WSL2Adapter, LinuxAdapter, CloudAdapter
    """

    @property
    @abstractmethod
    def platform_name(self) -> str:
        """Return the platform identifier (e.g., 'mac_m_series')."""
        pass

    @abstractmethod
    def detect(self) -> bool:
        """Return True if this adapter matches the current system."""
        pass

    @abstractmethod
    def probe_hardware(self) -> Dict[str, Any]:
        """
        Probe hardware capabilities.
        Returns: arch, gpu_type, vram_gb, ram_gb, disk_free_gb, etc.
        """
        pass

    @abstractmethod
    def get_feasibility(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        Determine if the profile is feasible on this platform.
        Returns: status, actions, recommended_profiles, environment_config
        """
        pass

    @abstractmethod
    def get_optimal_cache_path(self) -> str:
        """Return the optimal path for model cache on this platform."""
        pass


class IInstaller(ABC):
    """
    Interface for dependency installers (SRP).
    Each dependency (k3d, helm, kserve) has its own installer.
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Return the dependency name (e.g., 'k3d')."""
        pass

    @property
    @abstractmethod
    def required_version(self) -> str:
        """Return the required version."""
        pass

    @abstractmethod
    def is_installed(self) -> bool:
        """Check if the dependency is installed at the required version."""
        pass

    @abstractmethod
    def get_current_version(self) -> Optional[str]:
        """Return the currently installed version, or None."""
        pass

    @abstractmethod
    async def install(self, progress_callback: Optional[Callable] = None) -> bool:
        """Install the dependency. Returns True on success."""
        pass

    @abstractmethod
    async def cleanup(self) -> bool:
        """Clean up partial installation state. Must be idempotent."""
        pass

    @abstractmethod
    def verify(self) -> bool:
        """Verify the installation is functional."""
        pass
