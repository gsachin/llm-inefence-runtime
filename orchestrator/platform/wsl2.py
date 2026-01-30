"""
WSL2 platform adapter for Windows Subsystem for Linux.

Handles:
- WSL2 detection and version check
- CUDA passthrough detection
- Optimal model cache path (Linux-native filesystem for performance)
- Docker Desktop K8s integration
"""

from __future__ import annotations

import os
import platform
import subprocess
from typing import Any, Dict

from .base import BasePlatformAdapter
from ..core.exceptions import ConfigurationError


class WSL2Adapter(BasePlatformAdapter):
    """
    Platform adapter for WSL2 (Windows Subsystem for Linux 2).
    """

    @property
    def platform_name(self) -> str:
        return "wsl2_windows"

    def detect(self) -> bool:
        """Return True if running inside WSL2."""
        if platform.system() != "Linux":
            return False
        return os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop")

    def probe_hardware(self) -> Dict[str, Any]:
        """
        Probe WSL2 hardware capabilities.

        Returns:
            Dict with arch, ram_gb, gpu_type, cuda_available, disk_free_gb
        """
        result = {
            "arch": platform.machine(),
            "platform": self.platform_name,
            "wsl_version": 2,
        }

        # Get RAM
        result["ram_gb"] = self.get_total_ram_gb()

        # Check for CUDA passthrough
        cuda_info = self._check_cuda_passthrough()
        result.update(cuda_info)

        # Check disk space (Linux-native path)
        cache_path = self.get_optimal_cache_path()
        result["disk_free_gb"] = self.get_disk_free_gb(os.path.dirname(cache_path))

        # Warn if using Windows mount
        if self._is_using_windows_mount():
            result["performance_warning"] = (
                "Model cache should be on Linux filesystem for optimal performance"
            )

        return result

    def _check_cuda_passthrough(self) -> Dict[str, Any]:
        """Check if CUDA is available via GPU passthrough."""
        result = {
            "gpu_type": None,
            "cuda_available": False,
            "cuda_version": None,
        }

        # Check nvidia-smi
        nvidia_result = self.run_command(["nvidia-smi", "--query-gpu=name,driver_version", "--format=csv,noheader"])
        if nvidia_result.returncode == 0:
            try:
                lines = nvidia_result.stdout.strip().split("\n")
                if lines:
                    parts = lines[0].split(", ")
                    result["gpu_type"] = parts[0]
                    result["driver_version"] = parts[1] if len(parts) > 1 else None
                    result["cuda_available"] = True
            except Exception:
                pass

        # Check CUDA version
        if result["cuda_available"]:
            nvcc_result = self.run_command(["nvcc", "--version"])
            if nvcc_result.returncode == 0:
                for line in nvcc_result.stdout.split("\n"):
                    if "release" in line:
                        try:
                            result["cuda_version"] = line.split("release")[1].split(",")[0].strip()
                        except Exception:
                            pass

        return result

    def _is_using_windows_mount(self) -> bool:
        """Check if the home directory is on a Windows mount (slow)."""
        home = os.path.expanduser("~")
        return home.startswith("/mnt/")

    def get_feasibility(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        Determine if the profile is feasible on WSL2.

        Returns:
            status, actions, recommended_profiles, environment_config
        """
        hw = self.probe_hardware()

        actions = []
        recommended_profiles = []

        # Determine profiles based on GPU availability
        if hw["cuda_available"]:
            recommended_profiles = ["mid_range_gpu", "cpu_fallback", "local_dev"]
            runtime = "cuda"
        else:
            recommended_profiles = ["cpu_fallback", "local_dev"]
            runtime = "cpu"

        # Check for Docker Desktop K8s
        if not self._check_docker_k8s():
            actions.append({
                "name": "Enable Docker Desktop Kubernetes",
                "cmd": "Open Docker Desktop → Settings → Kubernetes → Enable",
                "required_for": ["all"],
                "duration": "~3 minutes",
            })

        # Warn about Windows mount performance
        if self._is_using_windows_mount():
            actions.append({
                "name": "Configure Linux-native model cache",
                "cmd": f"mkdir -p {self.get_optimal_cache_path()}",
                "reason": "Windows filesystem mounts are 10x slower for LLM model loading",
                "required_for": ["all"],
                "duration": "~1 minute",
            })

        return {
            "status": "supported",
            "actions": actions,
            "recommended_profiles": recommended_profiles,
            "environment_config": {
                "type": "venv",
                "python_version": "3.11.8",
                "path": self.get_optimal_cache_path().replace("/model-cache", "/venvs/wsl2"),
                "runtime": runtime,
            },
            "hardware": hw,
        }

    def _check_docker_k8s(self) -> bool:
        """Check if Docker Desktop K8s is available."""
        result = self.run_command(["kubectl", "cluster-info"])
        if result.returncode != 0:
            return False

        # Check if it's Docker Desktop's K8s
        return "docker-desktop" in result.stdout.lower()

    def get_optimal_cache_path(self) -> str:
        """
        Return the optimal path for model cache on WSL2.

        IMPORTANT: Must be on Linux-native filesystem (not /mnt/c/...)
        for acceptable performance with large LLM models.
        """
        user = os.getenv("USER", "user")
        linux_home = f"/home/{user}"

        # Verify we're not on Windows mount
        if linux_home.startswith("/mnt/"):
            raise ConfigurationError(
                "cache_path",
                f"Model cache MUST be on Linux filesystem for performance. "
                f"Current home is on Windows mount: {linux_home}. "
                f"Use /home/{user}/.mlops-wizard instead."
            )

        return os.path.join(linux_home, ".mlops-wizard", "model-cache")

    def validate_cache_path(self, path: str) -> Dict[str, Any]:
        """
        Validate a cache path for WSL2 performance.

        Returns:
            Dict with valid, reason, recommended_path
        """
        if path.startswith("/mnt/"):
            return {
                "valid": False,
                "reason": "Path is on Windows filesystem (slow I/O)",
                "performance": "~10x slower model loading",
                "recommended_path": self.get_optimal_cache_path(),
            }

        return {
            "valid": True,
            "reason": "Path is on Linux-native filesystem",
            "performance": "optimal",
        }

    def get_k8s_engine_recommendation(self) -> Dict[str, Any]:
        """Get recommended Kubernetes engine for WSL2."""
        return {
            "recommended": "k3d",
            "alternatives": ["kind", "docker-desktop"],
            "install_cmd": "curl -s https://raw.githubusercontent.com/k3d-io/k3d/main/install.sh | bash",
            "reason": "k3d is lightweight and CUDA-aware for GPU workloads",
        }
