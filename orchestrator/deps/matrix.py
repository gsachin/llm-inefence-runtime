"""
Dependency matrix loader and models.

Loads platform-specific dependency definitions from YAML configuration.
Separates CLI tools from cluster components.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml

logger = logging.getLogger(__name__)

# Default paths
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATRIX_PATH = REPO_ROOT / "configs" / "platforms_deps.yaml"


class DependencyCategory(str, Enum):
    """Category of a dependency."""
    CLI_TOOL = "cli_tool"
    CLUSTER_COMPONENT = "cluster_component"


@dataclass
class Dependency:
    """Definition of a single dependency."""
    
    name: str
    version: str
    check_cmd: str
    install_cmd: str
    verify_cmd: str
    category: DependencyCategory = DependencyCategory.CLI_TOOL
    requires_sudo: bool = False
    optional: bool = False
    description: str = ""
    docs_url: str = ""
    order: int = 100  # Lower = installed first
    requires_cluster: bool = False  # Needs a running K8s cluster to install


@dataclass
class PlatformDependencies:
    """Dependencies for a specific platform."""
    
    platform: str
    description: str
    cli_tools: List[Dependency] = field(default_factory=list)
    cluster_components: List[Dependency] = field(default_factory=list)
    
    @property
    def dependencies(self) -> List[Dependency]:
        """Get all dependencies (CLI + cluster) for backward compatibility."""
        return self.cli_tools + self.cluster_components
    
    def get_dependency(self, name: str) -> Optional[Dependency]:
        """Get a dependency by name."""
        for dep in self.dependencies:
            if dep.name == name:
                return dep
        return None
    
    def get_ordered_cli_tools(self) -> List[Dependency]:
        """Get CLI tools in installation order."""
        return sorted(self.cli_tools, key=lambda d: d.order)
    
    def get_ordered_cluster_components(self) -> List[Dependency]:
        """Get cluster components in installation order."""
        return sorted(self.cluster_components, key=lambda d: d.order)
    
    def get_ordered_dependencies(self) -> List[Dependency]:
        """Get all dependencies in installation order (CLI first, then cluster)."""
        return self.get_ordered_cli_tools() + self.get_ordered_cluster_components()
    
    def get_required_dependencies(self) -> List[Dependency]:
        """Get only required (non-optional) dependencies."""
        return [d for d in self.dependencies if not d.optional]
    
    def get_required_cli_tools(self) -> List[Dependency]:
        """Get required CLI tools."""
        return [d for d in self.cli_tools if not d.optional]


class DependencyMatrix:
    """
    Loads and manages platform-specific dependency definitions.
    
    Dependencies are loaded from a YAML file with the following structure:
    
    platforms:
      mac_m_series:
        description: "macOS with Apple Silicon"
        cli_tools:
          - name: homebrew
            version: "4.0+"
            check_cmd: "brew --version"
            install_cmd: "/bin/bash -c \"$(curl -fsSL ...)\""
            ...
        cluster_components:
          - name: kserve
            version: "0.13+"
            requires_cluster: true
            ...
    """
    
    def __init__(self, matrix_path: Path = DEFAULT_MATRIX_PATH):
        self.matrix_path = matrix_path
        self._platforms: Dict[str, PlatformDependencies] = {}
        self._loaded = False
    
    def load(self) -> None:
        """Load the dependency matrix from YAML."""
        if self._loaded:
            return
        
        if not self.matrix_path.exists():
            logger.warning(f"Dependency matrix not found: {self.matrix_path}")
            self._loaded = True
            return
        
        try:
            with open(self.matrix_path) as f:
                data = yaml.safe_load(f)
            
            platforms_data = data.get("platforms", {})
            
            for platform_name, platform_data in platforms_data.items():
                cli_tools = []
                cluster_components = []
                
                # Load CLI tools
                for dep_data in platform_data.get("cli_tools", []):
                    cli_tools.append(self._parse_dependency(
                        dep_data, 
                        DependencyCategory.CLI_TOOL
                    ))
                
                # Load cluster components
                for dep_data in platform_data.get("cluster_components", []):
                    cluster_components.append(self._parse_dependency(
                        dep_data,
                        DependencyCategory.CLUSTER_COMPONENT
                    ))
                
                # Legacy support: load from "dependencies" key if no new structure
                if not cli_tools and not cluster_components:
                    for dep_data in platform_data.get("dependencies", []):
                        cli_tools.append(self._parse_dependency(
                            dep_data,
                            DependencyCategory.CLI_TOOL
                        ))
                
                self._platforms[platform_name] = PlatformDependencies(
                    platform=platform_name,
                    description=platform_data.get("description", ""),
                    cli_tools=cli_tools,
                    cluster_components=cluster_components,
                )
            
            logger.info(f"Loaded dependency matrix: {len(self._platforms)} platforms")
            self._loaded = True
            
        except Exception as e:
            logger.error(f"Failed to load dependency matrix: {e}")
            raise
    
    def _parse_dependency(
        self, 
        dep_data: Dict[str, Any], 
        category: DependencyCategory
    ) -> Dependency:
        """Parse a dependency definition from YAML data."""
        return Dependency(
            name=dep_data["name"],
            version=dep_data.get("version", "latest"),
            check_cmd=dep_data.get("check_cmd", ""),
            install_cmd=dep_data.get("install_cmd", ""),
            verify_cmd=dep_data.get("verify_cmd", dep_data.get("check_cmd", "")),
            category=category,
            requires_sudo=dep_data.get("requires_sudo", False),
            optional=dep_data.get("optional", False),
            description=dep_data.get("description", ""),
            docs_url=dep_data.get("docs_url", ""),
            order=dep_data.get("order", 100),
            requires_cluster=dep_data.get("requires_cluster", False),
        )
    
    def get_platform(self, platform_name: str) -> Optional[PlatformDependencies]:
        """Get dependencies for a platform."""
        self.load()
        return self._platforms.get(platform_name)
    
    def get_all_platforms(self) -> List[str]:
        """Get list of all platform names."""
        self.load()
        return list(self._platforms.keys())
    
    def get_dependency_for_platform(
        self, 
        platform_name: str, 
        dep_name: str
    ) -> Optional[Dependency]:
        """Get a specific dependency for a platform."""
        platform = self.get_platform(platform_name)
        if platform:
            return platform.get_dependency(dep_name)
        return None


# Module-level singleton
_matrix: Optional[DependencyMatrix] = None


def get_matrix() -> DependencyMatrix:
    """Get the singleton dependency matrix instance."""
    global _matrix
    if _matrix is None:
        _matrix = DependencyMatrix()
    return _matrix
