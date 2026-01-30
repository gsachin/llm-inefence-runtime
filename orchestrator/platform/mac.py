"""
Mac platform adapter for Apple Silicon (M1/M2/M3).

Handles:
- Hardware detection (Metal, unified memory)
- Toolchain validation (Xcode CLI, CMake for MLX)
- Optimal model cache path
- vLLM vs MLX runtime selection
"""

from __future__ import annotations

import os
import platform
import subprocess
from typing import Any, Dict

from .base import BasePlatformAdapter
from ..core.exceptions import PlatformNotSupportedError


class MacAdapter(BasePlatformAdapter):
    """
    Platform adapter for macOS (Apple Silicon).
    """

    @property
    def platform_name(self) -> str:
        return "mac_m_series"

    def detect(self) -> bool:
        """Return True if running on Apple Silicon Mac."""
        return (
            platform.system() == "Darwin"
            and platform.machine() == "arm64"
        )

    def probe_hardware(self) -> Dict[str, Any]:
        """
        Probe Mac hardware capabilities.

        Returns:
            Dict with arch, ram_gb, chip_name, metal_support, disk_free_gb
        """
        result = {
            "arch": "arm64",
            "platform": self.platform_name,
            "gpu_type": "apple_metal",
            "gpu_discrete": False,  # Unified memory
        }

        # Get total RAM (unified memory)
        result["ram_gb"] = self.get_total_ram_gb()

        # Get chip name
        chip_result = self.run_command(["sysctl", "-n", "machdep.cpu.brand_string"])
        if chip_result.returncode == 0:
            result["chip_name"] = chip_result.stdout.strip()

        # Check Metal support
        result["metal_support"] = self._check_metal_support()

        # Check disk space for model cache
        cache_path = self.get_optimal_cache_path()
        result["disk_free_gb"] = self.get_disk_free_gb(os.path.dirname(cache_path))

        return result

    def _check_metal_support(self) -> bool:
        """Check if Metal is available."""
        result = self.run_command(["system_profiler", "SPDisplaysDataType"])
        if result.returncode == 0:
            return "Metal" in result.stdout
        return False

    def get_feasibility(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        Determine if the profile is feasible on Mac.

        Returns:
            status, actions, recommended_profiles, environment_config
        """
        hw = self.probe_hardware()

        # Minimum RAM check
        if hw["ram_gb"] < 16:
            return {
                "status": "unsupported",
                "reason": "Metal runtime requires ≥16GB unified memory",
                "actions": [],
                "recommended_profiles": [],
            }

        # Determine available profiles based on RAM
        if hw["ram_gb"] >= 64:
            recommended_profiles = ["cpu_fallback", "local_dev", "mid_range_gpu"]
        elif hw["ram_gb"] >= 32:
            recommended_profiles = ["cpu_fallback", "local_dev"]
        else:
            recommended_profiles = ["cpu_fallback", "local_dev"]

        # Determine runtime and actions
        toolchain = self.check_toolchain("vllm_mps")

        actions = []
        for check_name, check_info in toolchain["checks"].items():
            if not check_info.get("installed", check_info.get("available", False)):
                for action in toolchain.get("required_actions", []):
                    if action["name"] not in [a["name"] for a in actions]:
                        actions.append(action)

        return {
            "status": "supported",
            "actions": actions,
            "recommended_profiles": recommended_profiles,
            "environment_config": {
                "type": "venv",  # Not conda; Metal needs system Python
                "python_version": "3.10.13",
                "path": self.get_optimal_cache_path().replace("/model-cache", "/venvs/mac_m_series"),
            },
            "hardware": hw,
        }

    def check_toolchain(self, runtime_choice: str = "vllm_mps") -> Dict[str, Any]:
        """
        Check if the required toolchain is installed.

        Args:
            runtime_choice: "vllm_mps" or "mlx_lm"

        Returns:
            Dict with checks and required_actions
        """
        checks = {}
        actions = []

        # 1. Xcode Command Line Tools
        xcode_result = self.run_command(["xcode-select", "-p"])
        checks["xcode_clt"] = {"installed": xcode_result.returncode == 0}
        if not checks["xcode_clt"]["installed"]:
            actions.append({
                "name": "Install Xcode Command Line Tools",
                "cmd": "xcode-select --install",
                "required_for": ["mlx_lm", "vllm_mps"],
                "duration": "~5 minutes",
            })

        # 2. Homebrew
        brew_installed = self.command_exists("brew")
        checks["homebrew"] = {"installed": brew_installed}
        if not brew_installed:
            actions.append({
                "name": "Install Homebrew",
                "cmd": '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"',
                "required_for": ["mlx_lm", "vllm_mps"],
                "duration": "~3 minutes",
            })

        # 3. CMake (MLX requires ≥3.24)
        if runtime_choice == "mlx_lm":
            cmake_version = None
            cmake_result = self.run_command(["cmake", "--version"])
            if cmake_result.returncode == 0:
                try:
                    cmake_version = cmake_result.stdout.split()[2]
                except (IndexError, ValueError):
                    pass

            checks["cmake"] = {
                "installed": cmake_version is not None,
                "version": cmake_version,
            }

            if not cmake_version or self._version_lt(cmake_version, "3.24"):
                actions.append({
                    "name": "Install/Upgrade CMake",
                    "cmd": "brew install cmake",
                    "required_for": ["mlx_lm"],
                    "duration": "~2 minutes",
                })

        # 4. Metal Compiler
        metal_result = self.run_command(["xcrun", "metal", "--version"])
        checks["metal_compiler"] = {"available": metal_result.returncode == 0}

        return {
            "all_ready": all(
                c.get("installed", c.get("available", True))
                for c in checks.values()
            ),
            "checks": checks,
            "required_actions": actions,
        }

    def _version_lt(self, v1: str, v2: str) -> bool:
        """Check if version v1 is less than v2."""
        from packaging import version
        try:
            return version.parse(v1) < version.parse(v2)
        except Exception:
            return False

    def get_optimal_cache_path(self) -> str:
        """Return the optimal path for model cache on Mac."""
        return os.path.expanduser("~/.mlops-wizard/model-cache")

    def get_k8s_engine_recommendation(self) -> Dict[str, Any]:
        """Get recommended Kubernetes engine for Mac."""
        return {
            "recommended": "orbstack",
            "alternatives": ["docker-desktop", "kind"],
            "install_cmd": "brew install orbstack",
            "reason": "Orbstack is faster and more memory-efficient than Docker Desktop on Mac",
        }
