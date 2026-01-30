"""
Base platform adapter and detector.
"""

from __future__ import annotations

import os
import platform
import shutil
import subprocess
from abc import ABC
from typing import Any, Dict, List, Optional

from ..core.interfaces import IPlatformAdapter


class BasePlatformAdapter(IPlatformAdapter, ABC):
    """
    Base class for platform adapters with common utility methods.
    """

    def run_command(
        self,
        cmd: List[str],
        capture_output: bool = True,
        check: bool = False,
    ) -> subprocess.CompletedProcess:
        """Run a shell command safely."""
        return subprocess.run(
            cmd,
            capture_output=capture_output,
            text=True,
            check=check,
        )

    def command_exists(self, cmd: str) -> bool:
        """Check if a command is available in PATH."""
        return shutil.which(cmd) is not None

    def get_disk_free_gb(self, path: str) -> float:
        """Get free disk space in GB for a path."""
        try:
            stat = os.statvfs(path)
            return (stat.f_bavail * stat.f_frsize) / (1024**3)
        except Exception:
            return 0.0

    def get_total_ram_gb(self) -> float:
        """Get total system RAM in GB."""
        try:
            import psutil
            return psutil.virtual_memory().total / (1024**3)
        except ImportError:
            # Fallback for systems without psutil
            if platform.system() == "Darwin":
                result = self.run_command(["sysctl", "-n", "hw.memsize"])
                if result.returncode == 0:
                    return int(result.stdout.strip()) / (1024**3)
            elif platform.system() == "Linux":
                with open("/proc/meminfo") as f:
                    for line in f:
                        if line.startswith("MemTotal"):
                            return int(line.split()[1]) / (1024**2)
            return 0.0


class PlatformDetector:
    """
    Detects the current platform and returns the appropriate adapter.
    Follows the Factory Pattern.
    """

    _adapters: List[IPlatformAdapter] = []

    @classmethod
    def register_adapter(cls, adapter: IPlatformAdapter) -> None:
        """Register a platform adapter."""
        cls._adapters.append(adapter)

    @classmethod
    def detect(cls) -> Optional[IPlatformAdapter]:
        """
        Detect the current platform and return the matching adapter.

        Returns:
            The first adapter that matches, or None
        """
        for adapter in cls._adapters:
            if adapter.detect():
                return adapter
        return None

    @classmethod
    def get_platform_name(cls) -> str:
        """Get the current platform name."""
        adapter = cls.detect()
        if adapter:
            return adapter.platform_name
        return "unknown"

    @classmethod
    def get_all_adapters(cls) -> List[IPlatformAdapter]:
        """Get all registered adapters."""
        return cls._adapters.copy()


def detect_platform() -> Dict[str, Any]:
    """
    Detect basic platform information without using adapters.
    Useful for initial platform detection before loading adapters.
    """
    system = platform.system()
    machine = platform.machine()

    info = {
        "system": system,
        "machine": machine,
        "is_macos": system == "Darwin",
        "is_linux": system == "Linux",
        "is_windows": system == "Windows",
        "is_arm64": machine in ("arm64", "aarch64"),
        "is_x86_64": machine in ("x86_64", "AMD64"),
        "is_wsl": False,
    }

    # Detect WSL2
    if system == "Linux":
        if os.path.exists("/proc/sys/fs/binfmt_misc/WSLInterop"):
            info["is_wsl"] = True
            info["wsl_version"] = 2

    # Detect Apple Silicon
    if system == "Darwin" and machine == "arm64":
        info["is_apple_silicon"] = True
        # Get chip name
        result = subprocess.run(
            ["sysctl", "-n", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            info["cpu_brand"] = result.stdout.strip()

    return info
