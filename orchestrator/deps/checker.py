"""
Dependency checker.

Checks if dependencies are installed and their versions.
Separates CLI tools from cluster components.
"""

from __future__ import annotations

import asyncio
import logging
import re
import shutil
import subprocess
from dataclasses import dataclass
from enum import Enum
from typing import Any, Dict, List, Optional, Tuple

from packaging import version as pkg_version

from .matrix import (
    Dependency, 
    DependencyCategory,
    DependencyMatrix, 
    PlatformDependencies, 
    get_matrix
)

logger = logging.getLogger(__name__)


class DependencyStatus(str, Enum):
    """Status of a dependency."""
    
    INSTALLED = "installed"        # Installed and meets version requirement
    OUTDATED = "outdated"          # Installed but version too old
    MISSING = "missing"            # Not installed
    CHECK_FAILED = "check_failed"  # Could not determine status
    OPTIONAL_MISSING = "optional_missing"  # Optional and not installed
    PENDING_CLUSTER = "pending_cluster"  # Requires cluster - will install during deploy


@dataclass
class DependencyInfo:
    """Information about a dependency's status."""
    
    name: str
    status: DependencyStatus
    required_version: str
    category: str = "cli_tool"  # "cli_tool" or "cluster_component"
    installed_version: Optional[str] = None
    message: str = ""
    install_cmd: str = ""
    requires_sudo: bool = False
    optional: bool = False
    order: int = 100
    description: str = ""
    docs_url: str = ""
    requires_cluster: bool = False


class DependencyChecker:
    """
    Checks dependency status for a given platform.
    
    Runs check commands to determine if dependencies are installed
    and extracts version information for comparison.
    """
    
    # Common version extraction patterns
    VERSION_PATTERNS = [
        # Standard semantic versioning: v1.2.3 or 1.2.3
        r"v?(\d+\.\d+(?:\.\d+)?(?:-[a-zA-Z0-9.]+)?)",
        # Just major.minor: 1.2
        r"(\d+\.\d+)",
    ]
    
    def __init__(self, matrix: Optional[DependencyMatrix] = None):
        self.matrix = matrix or get_matrix()
        self._cluster_available: Optional[bool] = None
    
    async def check_cluster_available(self) -> bool:
        """Check if a Kubernetes cluster is accessible."""
        if self._cluster_available is not None:
            return self._cluster_available
        
        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(
                    "kubectl cluster-info 2>/dev/null",
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=10,
                )
            )
            self._cluster_available = result.returncode == 0
        except Exception:
            self._cluster_available = False
        
        return self._cluster_available
    
    async def check_all(self, platform_name: str) -> List[DependencyInfo]:
        """
        Check all dependencies for a platform.
        
        Args:
            platform_name: The platform to check dependencies for
            
        Returns:
            List of DependencyInfo with status for each dependency
        """
        platform_deps = self.matrix.get_platform(platform_name)
        if not platform_deps:
            logger.warning(f"Unknown platform: {platform_name}")
            return []
        
        # Check cluster availability first
        cluster_available = await self.check_cluster_available()
        
        # Run all CLI tool checks concurrently
        cli_tasks = [
            self._check_dependency(dep, cluster_available)
            for dep in platform_deps.cli_tools
        ]
        
        # Run all cluster component checks concurrently
        cluster_tasks = [
            self._check_dependency(dep, cluster_available)
            for dep in platform_deps.cluster_components
        ]
        
        all_tasks = cli_tasks + cluster_tasks
        all_deps = platform_deps.cli_tools + platform_deps.cluster_components
        
        results = await asyncio.gather(*all_tasks, return_exceptions=True)
        
        # Convert exceptions to check_failed status
        infos = []
        for dep, result in zip(all_deps, results):
            if isinstance(result, Exception):
                logger.error(f"Check failed for {dep.name}: {result}")
                infos.append(DependencyInfo(
                    name=dep.name,
                    status=DependencyStatus.CHECK_FAILED,
                    required_version=dep.version,
                    category=dep.category.value,
                    message=str(result),
                    install_cmd=dep.install_cmd,
                    requires_sudo=dep.requires_sudo,
                    optional=dep.optional,
                    order=dep.order,
                    description=dep.description,
                    docs_url=dep.docs_url,
                    requires_cluster=dep.requires_cluster,
                ))
            else:
                infos.append(result)
        
        return sorted(infos, key=lambda i: i.order)
    
    async def check_cli_tools(self, platform_name: str) -> List[DependencyInfo]:
        """Check only CLI tools for a platform."""
        platform_deps = self.matrix.get_platform(platform_name)
        if not platform_deps:
            return []
        
        cluster_available = await self.check_cluster_available()
        
        tasks = [
            self._check_dependency(dep, cluster_available)
            for dep in platform_deps.cli_tools
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        infos = []
        for dep, result in zip(platform_deps.cli_tools, results):
            if isinstance(result, Exception):
                infos.append(DependencyInfo(
                    name=dep.name,
                    status=DependencyStatus.CHECK_FAILED,
                    required_version=dep.version,
                    category=dep.category.value,
                    message=str(result),
                    install_cmd=dep.install_cmd,
                    requires_sudo=dep.requires_sudo,
                    optional=dep.optional,
                    order=dep.order,
                    description=dep.description,
                    docs_url=dep.docs_url,
                    requires_cluster=dep.requires_cluster,
                ))
            else:
                infos.append(result)
        
        return sorted(infos, key=lambda i: i.order)
    
    async def check_cluster_components(self, platform_name: str) -> List[DependencyInfo]:
        """Check only cluster components for a platform."""
        platform_deps = self.matrix.get_platform(platform_name)
        if not platform_deps:
            return []
        
        cluster_available = await self.check_cluster_available()
        
        tasks = [
            self._check_dependency(dep, cluster_available)
            for dep in platform_deps.cluster_components
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        infos = []
        for dep, result in zip(platform_deps.cluster_components, results):
            if isinstance(result, Exception):
                infos.append(DependencyInfo(
                    name=dep.name,
                    status=DependencyStatus.CHECK_FAILED,
                    required_version=dep.version,
                    category=dep.category.value,
                    message=str(result),
                    install_cmd=dep.install_cmd,
                    requires_sudo=dep.requires_sudo,
                    optional=dep.optional,
                    order=dep.order,
                    description=dep.description,
                    docs_url=dep.docs_url,
                    requires_cluster=dep.requires_cluster,
                ))
            else:
                infos.append(result)
        
        return sorted(infos, key=lambda i: i.order)
    
    async def check_one(
        self, 
        platform_name: str, 
        dep_name: str
    ) -> Optional[DependencyInfo]:
        """Check a single dependency."""
        dep = self.matrix.get_dependency_for_platform(platform_name, dep_name)
        if not dep:
            return None
        cluster_available = await self.check_cluster_available()
        return await self._check_dependency(dep, cluster_available)
    
    async def _check_dependency(
        self, 
        dep: Dependency, 
        cluster_available: bool
    ) -> DependencyInfo:
        """
        Check if a single dependency is installed and get its version.
        """
        # For cluster components that require a cluster but none is available
        if dep.requires_cluster and not cluster_available:
            return DependencyInfo(
                name=dep.name,
                status=DependencyStatus.PENDING_CLUSTER,
                required_version=dep.version,
                category=dep.category.value,
                message="Will be installed when cluster is created",
                install_cmd=dep.install_cmd,
                requires_sudo=dep.requires_sudo,
                optional=dep.optional,
                order=dep.order,
                description=dep.description,
                docs_url=dep.docs_url,
                requires_cluster=dep.requires_cluster,
            )
        
        if not dep.check_cmd:
            return DependencyInfo(
                name=dep.name,
                status=DependencyStatus.CHECK_FAILED,
                required_version=dep.version,
                category=dep.category.value,
                message="No check command defined",
                install_cmd=dep.install_cmd,
                requires_sudo=dep.requires_sudo,
                optional=dep.optional,
                order=dep.order,
                description=dep.description,
                docs_url=dep.docs_url,
                requires_cluster=dep.requires_cluster,
            )
        
        try:
            # Run check command
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(
                    dep.check_cmd,
                    shell=True,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
            )
            
            if result.returncode != 0:
                # Command failed - dependency missing
                status = (
                    DependencyStatus.OPTIONAL_MISSING 
                    if dep.optional 
                    else DependencyStatus.MISSING
                )
                return DependencyInfo(
                    name=dep.name,
                    status=status,
                    required_version=dep.version,
                    category=dep.category.value,
                    message=f"Not installed",
                    install_cmd=dep.install_cmd,
                    requires_sudo=dep.requires_sudo,
                    optional=dep.optional,
                    order=dep.order,
                    description=dep.description,
                    docs_url=dep.docs_url,
                    requires_cluster=dep.requires_cluster,
                )
            
            # Extract version from output
            output = result.stdout + result.stderr
            installed_version = self._extract_version(output)
            
            # Compare versions if we could extract one
            if installed_version and dep.version:
                status, message = self._compare_versions(
                    installed_version, 
                    dep.version
                )
            else:
                # Assume installed if command succeeded
                status = DependencyStatus.INSTALLED
                message = "Installed (version unknown)"
                if installed_version:
                    message = f"Version {installed_version}"
            
            return DependencyInfo(
                name=dep.name,
                status=status,
                required_version=dep.version,
                category=dep.category.value,
                installed_version=installed_version,
                message=message,
                install_cmd=dep.install_cmd,
                requires_sudo=dep.requires_sudo,
                optional=dep.optional,
                order=dep.order,
                description=dep.description,
                docs_url=dep.docs_url,
                requires_cluster=dep.requires_cluster,
            )
            
        except subprocess.TimeoutExpired:
            return DependencyInfo(
                name=dep.name,
                status=DependencyStatus.CHECK_FAILED,
                required_version=dep.version,
                category=dep.category.value,
                message="Check command timed out",
                install_cmd=dep.install_cmd,
                requires_sudo=dep.requires_sudo,
                optional=dep.optional,
                order=dep.order,
                description=dep.description,
                docs_url=dep.docs_url,
                requires_cluster=dep.requires_cluster,
            )
        except Exception as e:
            return DependencyInfo(
                name=dep.name,
                status=DependencyStatus.CHECK_FAILED,
                required_version=dep.version,
                category=dep.category.value,
                message=str(e),
                install_cmd=dep.install_cmd,
                requires_sudo=dep.requires_sudo,
                optional=dep.optional,
                order=dep.order,
                description=dep.description,
                docs_url=dep.docs_url,
                requires_cluster=dep.requires_cluster,
            )
    
    def _extract_version(self, output: str) -> Optional[str]:
        """Extract version string from command output."""
        for pattern in self.VERSION_PATTERNS:
            match = re.search(pattern, output)
            if match:
                return match.group(1)
        return None
    
    def _compare_versions(
        self, 
        installed: str, 
        required: str
    ) -> Tuple[DependencyStatus, str]:
        """
        Compare installed version against requirement.
        
        Supports version specs like:
        - "1.2.3" - exact match or higher
        - "1.2.3+" - 1.2.3 or higher  
        - ">=1.2.3" - 1.2.3 or higher
        - "~1.2" - 1.2.x (any patch version)
        """
        try:
            # Handle version requirement operators
            required_clean = required.strip()
            
            # Handle "latest" or empty
            if not required_clean or required_clean.lower() == "latest":
                return DependencyStatus.INSTALLED, f"Version {installed}"
            
            # Handle + suffix (e.g., "4.0+")
            if required_clean.endswith("+"):
                min_version = required_clean[:-1]
                if pkg_version.parse(installed) >= pkg_version.parse(min_version):
                    return DependencyStatus.INSTALLED, f"Version {installed}"
                else:
                    return DependencyStatus.OUTDATED, f"Version {installed} < {min_version}"
            
            # Handle >= prefix
            if required_clean.startswith(">="):
                min_version = required_clean[2:]
                if pkg_version.parse(installed) >= pkg_version.parse(min_version):
                    return DependencyStatus.INSTALLED, f"Version {installed}"
                else:
                    return DependencyStatus.OUTDATED, f"Version {installed} < {min_version}"
            
            # Handle ~ prefix (any patch version)
            if required_clean.startswith("~"):
                base = required_clean[1:]
                base_parts = base.split(".")
                installed_parts = installed.split(".")
                
                # Major and minor must match
                if (len(installed_parts) >= 2 and len(base_parts) >= 2 and
                    installed_parts[0] == base_parts[0] and
                    installed_parts[1] == base_parts[1]):
                    return DependencyStatus.INSTALLED, f"Version {installed}"
                else:
                    return DependencyStatus.OUTDATED, f"Version {installed} doesn't match ~{base}"
            
            # Default: installed must be >= required
            if pkg_version.parse(installed) >= pkg_version.parse(required_clean):
                return DependencyStatus.INSTALLED, f"Version {installed}"
            else:
                return DependencyStatus.OUTDATED, f"Version {installed} < {required_clean}"
                
        except Exception as e:
            logger.debug(f"Version comparison failed: {e}")
            # If parsing fails, assume installed is OK
            return DependencyStatus.INSTALLED, f"Version {installed}"


async def check_platform_dependencies(platform_name: str) -> List[DependencyInfo]:
    """
    Convenience function to check all dependencies for a platform.
    
    Args:
        platform_name: The platform to check
        
    Returns:
        List of DependencyInfo for all dependencies
    """
    checker = DependencyChecker()
    return await checker.check_all(platform_name)
