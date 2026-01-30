"""
Custom exceptions for the MLOps Orchestration Framework.

Hierarchy:
    OrchestratorError (base)
    ├── VaultLockedError
    ├── CredentialMissingError
    ├── ResourceNotFoundError
    ├── PlatformNotSupportedError
    ├── InsufficientStorageError
    ├── ConfigurationError
    └── PreflightCheckError
"""

from __future__ import annotations


class OrchestratorError(Exception):
    """Base exception for all orchestrator errors."""

    def __init__(self, message: str, details: dict | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}


class VaultLockedError(OrchestratorError):
    """Raised when attempting to access a locked credential vault."""

    def __init__(self, message: str = "Vault must be unlocked first"):
        super().__init__(message)


class CredentialMissingError(OrchestratorError):
    """Raised when required credentials are not configured."""

    def __init__(self, credential_type: str, message: str | None = None):
        msg = message or f"{credential_type} credentials not configured"
        super().__init__(msg, {"credential_type": credential_type})
        self.credential_type = credential_type


class ResourceNotFoundError(OrchestratorError):
    """Raised when a cloud or local resource is not found."""

    def __init__(self, resource_type: str, resource_id: str):
        super().__init__(
            f"{resource_type} '{resource_id}' not found",
            {"resource_type": resource_type, "resource_id": resource_id},
        )
        self.resource_type = resource_type
        self.resource_id = resource_id


class PlatformNotSupportedError(OrchestratorError):
    """Raised when the current platform is not supported."""

    def __init__(self, platform: str, reason: str | None = None):
        msg = f"Platform '{platform}' is not supported"
        if reason:
            msg += f": {reason}"
        super().__init__(msg, {"platform": platform, "reason": reason})
        self.platform = platform
        self.reason = reason


class InsufficientStorageError(OrchestratorError):
    """Raised when there is not enough disk space."""

    def __init__(self, required_gb: float, available_gb: float, path: str):
        super().__init__(
            f"Insufficient storage at {path}: {available_gb:.1f}GB available, "
            f"{required_gb:.1f}GB required",
            {"required_gb": required_gb, "available_gb": available_gb, "path": path},
        )
        self.required_gb = required_gb
        self.available_gb = available_gb
        self.path = path


class ConfigurationError(OrchestratorError):
    """Raised when configuration is invalid or missing."""

    def __init__(self, config_key: str, message: str):
        super().__init__(
            f"Configuration error for '{config_key}': {message}",
            {"config_key": config_key},
        )
        self.config_key = config_key


class PreflightCheckError(OrchestratorError):
    """Raised when a pre-flight check fails."""

    def __init__(self, check_name: str, message: str, recoverable: bool = True):
        super().__init__(
            f"Pre-flight check '{check_name}' failed: {message}",
            {"check_name": check_name, "recoverable": recoverable},
        )
        self.check_name = check_name
        self.recoverable = recoverable
