# Core abstractions for the MLOps Orchestration Framework
# Follows SOLID principles: Dependency Inversion, Interface Segregation

from .interfaces import (
    ICloudResource,
    ICredentialStore,
    ICloudDiscovery,
    IPlatformAdapter,
    IInstaller,
)
from .exceptions import (
    OrchestratorError,
    VaultLockedError,
    CredentialMissingError,
    ResourceNotFoundError,
    PlatformNotSupportedError,
    InsufficientStorageError,
    ConfigurationError,
    PreflightCheckError,
)

__all__ = [
    # Interfaces
    "ICloudResource",
    "ICredentialStore",
    "ICloudDiscovery",
    "IPlatformAdapter",
    "IInstaller",
    # Exceptions
    "OrchestratorError",
    "VaultLockedError",
    "CredentialMissingError",
    "ResourceNotFoundError",
    "PlatformNotSupportedError",
    "InsufficientStorageError",
    "ConfigurationError",
    "PreflightCheckError",
]
