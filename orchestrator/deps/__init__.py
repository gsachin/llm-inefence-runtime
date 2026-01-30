"""
Dependency management module.

Provides dependency checking and installation for the MLOps platform.
"""

from .checker import DependencyChecker, DependencyStatus, DependencyInfo
from .installer import DependencyInstaller, InstallProgress, InstallResult, InstallState
from .matrix import DependencyCategory, DependencyMatrix, PlatformDependencies

__all__ = [
    "DependencyCategory",
    "DependencyChecker",
    "DependencyStatus",
    "DependencyInfo",
    "DependencyInstaller",
    "InstallProgress",
    "InstallResult",
    "InstallState",
    "DependencyMatrix",
    "PlatformDependencies",
]
