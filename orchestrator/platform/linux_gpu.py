"""
Linux GPU platform adapter for NVIDIA workstations.

Handles:
- NVIDIA driver detection
- NVIDIA Container Toolkit validation
- containerd GPU runtime configuration
- K8s GPU visibility (device plugin)
"""

from __future__ import annotations

import os
import platform
import subprocess
from typing import Any, Dict, List

from .base import BasePlatformAdapter


class LinuxGPUAdapter(BasePlatformAdapter):
    """
    Platform adapter for Linux workstations with NVIDIA GPUs.
    """

    CONTAINERD_CONFIG = "/etc/containerd/config.toml"
    DOCKER_DAEMON_JSON = "/etc/docker/daemon.json"

    @property
    def platform_name(self) -> str:
        return "linux_workstation"

    def detect(self) -> bool:
        """Return True if running on native Linux (not WSL2)."""
        if platform.system() != "Linux":
            return False
        # Exclude WSL2
        if os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop"):
            return False
        return True

    def probe_hardware(self) -> Dict[str, Any]:
        """
        Probe Linux hardware capabilities.

        Returns:
            Dict with arch, ram_gb, gpu_type, vram_gb, driver_version, etc.
        """
        result = {
            "arch": platform.machine(),
            "platform": self.platform_name,
        }

        # Get RAM
        result["ram_gb"] = self.get_total_ram_gb()

        # Check for NVIDIA GPU
        gpu_info = self._probe_nvidia_gpu()
        result.update(gpu_info)

        # Check disk space
        result["disk_free_gb"] = self.get_disk_free_gb("/var/lib")

        return result

    def _probe_nvidia_gpu(self) -> Dict[str, Any]:
        """Probe NVIDIA GPU information."""
        result = {
            "gpu_type": None,
            "gpu_count": 0,
            "vram_gb": 0,
            "driver_version": None,
            "cuda_available": False,
        }

        nvidia_result = self.run_command([
            "nvidia-smi",
            "--query-gpu=name,memory.total,driver_version",
            "--format=csv,noheader,nounits"
        ])

        if nvidia_result.returncode != 0:
            return result

        try:
            lines = nvidia_result.stdout.strip().split("\n")
            result["gpu_count"] = len(lines)

            if lines:
                parts = lines[0].split(", ")
                result["gpu_type"] = parts[0]
                result["vram_gb"] = float(parts[1]) / 1024 if len(parts) > 1 else 0
                result["driver_version"] = parts[2] if len(parts) > 2 else None
                result["cuda_available"] = True
        except Exception:
            pass

        return result

    def get_feasibility(self, profile: Dict[str, Any]) -> Dict[str, Any]:
        """
        Determine if the profile is feasible on Linux GPU.

        Returns:
            status, actions, recommended_profiles, environment_config
        """
        hw = self.probe_hardware()
        gpu_stack = self.check_gpu_container_stack()

        # Determine profiles based on GPU
        if hw["cuda_available"]:
            vram = hw.get("vram_gb", 0)
            if vram >= 80:
                recommended_profiles = ["dgx_cloud_gpu", "high_param_unified_gpu", "mid_range_gpu"]
            elif vram >= 24:
                recommended_profiles = ["mid_range_gpu", "local_dev"]
            elif vram >= 8:
                recommended_profiles = ["local_dev", "cpu_fallback"]
            else:
                recommended_profiles = ["cpu_fallback"]
        else:
            recommended_profiles = ["cpu_fallback"]

        return {
            "status": "supported" if gpu_stack["all_ready"] else "warning",
            "actions": gpu_stack["required_actions"],
            "recommended_profiles": recommended_profiles,
            "environment_config": {
                "type": "docker",  # Safer for NVIDIA driver isolation
                "base_image": self._get_cuda_base_image(hw),
                "path": self.get_optimal_cache_path().replace("/model-cache", "/containers/linux_gpu"),
            },
            "hardware": hw,
            "gpu_stack": gpu_stack,
        }

    def _get_cuda_base_image(self, hw: Dict[str, Any]) -> str:
        """Get appropriate CUDA base image for this GPU."""
        # Determine CUDA version based on driver
        driver = hw.get("driver_version", "")
        try:
            driver_major = int(driver.split(".")[0])
        except (ValueError, IndexError):
            driver_major = 535  # Default to recent

        if driver_major >= 535:
            return "nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04"
        elif driver_major >= 520:
            return "nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04"
        else:
            return "nvidia/cuda:11.7.0-cudnn8-runtime-ubuntu22.04"

    def check_gpu_container_stack(self) -> Dict[str, Any]:
        """
        Full GPU accessibility check for containerized workloads.

        Validates:
        1. NVIDIA Driver installed
        2. NVIDIA Container Toolkit installed
        3. containerd configured with NVIDIA runtime
        4. K8s can see GPUs (if cluster exists)
        """
        checks = {}
        actions = []

        # 1. NVIDIA Driver
        driver_check = self._check_nvidia_driver()
        checks["nvidia_driver"] = driver_check
        if not driver_check["installed"]:
            actions.append({
                "name": "Install NVIDIA Driver",
                "cmd": "sudo apt install nvidia-driver-535",
                "required": True,
                "duration": "~5 minutes + reboot",
            })

        # 2. NVIDIA Container Toolkit
        ctk_check = self._check_nvidia_container_toolkit()
        checks["nvidia_ctk"] = ctk_check
        if not ctk_check["installed"]:
            actions.append({
                "name": "Install NVIDIA Container Toolkit",
                "cmd": self._get_nvidia_ctk_install_cmd(),
                "required": True,
                "duration": "~2 minutes",
            })

        # 3. containerd NVIDIA runtime
        containerd_check = self._check_containerd_nvidia_runtime()
        checks["containerd_nvidia"] = containerd_check
        if not containerd_check["configured"]:
            actions.append({
                "name": "Configure containerd for NVIDIA",
                "cmd": "sudo nvidia-ctk runtime configure --runtime=containerd && sudo systemctl restart containerd",
                "required": True,
                "duration": "~30 seconds",
            })

        # 4. K8s GPU visibility
        k8s_check = self._check_k8s_gpu_visibility()
        checks["k8s_gpu_visible"] = k8s_check
        if k8s_check.get("cluster_exists") and not k8s_check.get("gpus_visible"):
            actions.append({
                "name": "Install NVIDIA Device Plugin for K8s",
                "cmd": "kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.5/nvidia-device-plugin.yml",
                "required": True,
                "duration": "~1 minute",
            })

        return {
            "all_ready": all(
                c.get("installed", c.get("configured", c.get("gpus_visible", True)))
                for c in checks.values()
                if not (c.get("cluster_exists") is False)  # Skip K8s check if no cluster
            ),
            "checks": checks,
            "required_actions": actions,
        }

    def _check_nvidia_driver(self) -> Dict[str, Any]:
        """Check if NVIDIA driver is installed."""
        result = self.run_command([
            "nvidia-smi", "--query-gpu=driver_version", "--format=csv,noheader"
        ])
        if result.returncode == 0:
            return {"installed": True, "version": result.stdout.strip()}
        return {"installed": False}

    def _check_nvidia_container_toolkit(self) -> Dict[str, Any]:
        """Check if NVIDIA Container Toolkit is installed."""
        result = self.run_command(["nvidia-ctk", "--version"])
        if result.returncode == 0:
            return {"installed": True, "version": result.stdout.strip()}
        return {"installed": False}

    def _check_containerd_nvidia_runtime(self) -> Dict[str, Any]:
        """Check if containerd is configured with NVIDIA runtime."""
        if not os.path.exists(self.CONTAINERD_CONFIG):
            return {"configured": False, "reason": "containerd config not found"}

        try:
            with open(self.CONTAINERD_CONFIG, "r") as f:
                config = f.read()

            if "nvidia-container-runtime" in config or "nvidia" in config:
                return {"configured": True}

            return {"configured": False, "reason": "NVIDIA runtime not in containerd config"}
        except Exception as e:
            return {"configured": False, "reason": str(e)}

    def _check_k8s_gpu_visibility(self) -> Dict[str, Any]:
        """Check if K8s cluster can see GPUs."""
        # First check if cluster exists
        cluster_result = self.run_command(["kubectl", "cluster-info"])
        if cluster_result.returncode != 0:
            return {"cluster_exists": False}

        # Check for GPU resources on nodes
        result = self.run_command([
            "kubectl", "get", "nodes", "-o",
            "jsonpath={.items[*].status.allocatable.nvidia\\.com/gpu}"
        ])

        if result.returncode != 0:
            return {"cluster_exists": True, "gpus_visible": False, "error": result.stderr}

        gpu_count = result.stdout.strip()
        gpus_visible = gpu_count and gpu_count != "0" and gpu_count != ""

        return {
            "cluster_exists": True,
            "gpus_visible": gpus_visible,
            "gpu_count": gpu_count if gpus_visible else "0",
        }

    def _get_nvidia_ctk_install_cmd(self) -> str:
        """Get the command to install NVIDIA Container Toolkit."""
        return """
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \\
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \\
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
""".strip()

    def get_optimal_cache_path(self) -> str:
        """Return the optimal path for model cache on Linux."""
        return "/var/lib/mlops-wizard/models"

    def get_k8s_engine_recommendation(self) -> Dict[str, Any]:
        """Get recommended Kubernetes engine for Linux."""
        return {
            "recommended": "k3s",
            "alternatives": ["microk8s", "kind"],
            "install_cmd": "curl -sfL https://get.k3s.io | sh -",
            "reason": "k3s is native and has no Docker overhead for GPU workloads",
        }
