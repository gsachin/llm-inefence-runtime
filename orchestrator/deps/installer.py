"""
Dependency installer.

Installs dependencies using platform-specific commands.
Supports privilege escalation and real-time progress streaming.
"""

from __future__ import annotations

import asyncio
import logging
import subprocess
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

from .checker import DependencyChecker, DependencyInfo, DependencyStatus
from .matrix import Dependency, DependencyMatrix, get_matrix

logger = logging.getLogger(__name__)


class InstallState(str, Enum):
    """State of an installation."""
    
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class InstallProgress:
    """Progress update for an installation."""
    
    dependency: str
    state: InstallState
    message: str
    output: str = ""
    progress_percent: Optional[float] = None
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "dependency": self.dependency,
            "state": self.state.value,
            "message": self.message,
            "output": self.output,
            "progress_percent": self.progress_percent,
        }


@dataclass
class InstallResult:
    """Result of installing dependencies."""
    
    success: bool
    installed: List[str] = field(default_factory=list)
    failed: List[str] = field(default_factory=list)
    skipped: List[str] = field(default_factory=list)
    errors: Dict[str, str] = field(default_factory=dict)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "success": self.success,
            "installed": self.installed,
            "failed": self.failed,
            "skipped": self.skipped,
            "errors": self.errors,
        }


class DependencyInstaller:
    """
    Installs dependencies for a platform.
    
    Features:
    - Topological ordering based on dependency order
    - Real-time progress streaming via async generator
    - Privilege escalation for sudo commands
    - Verification after installation
    """
    
    def __init__(
        self,
        matrix: Optional[DependencyMatrix] = None,
        escalation_method: str = "sudo",  # sudo, pkexec, osascript
    ):
        self.matrix = matrix or get_matrix()
        self.checker = DependencyChecker(self.matrix)
        self.escalation_method = escalation_method
        self._cancel_requested = False
    
    def cancel(self) -> None:
        """Request cancellation of current installation."""
        self._cancel_requested = True
    
    async def install_all(
        self,
        platform_name: str,
        skip_installed: bool = True,
        skip_optional: bool = False,
    ) -> AsyncIterator[InstallProgress]:
        """
        Install all dependencies for a platform.
        
        Yields progress updates for each dependency.
        
        Args:
            platform_name: Platform to install dependencies for
            skip_installed: Skip already installed dependencies
            skip_optional: Skip optional dependencies
            
        Yields:
            InstallProgress for each dependency
        """
        self._cancel_requested = False
        
        platform_deps = self.matrix.get_platform(platform_name)
        if not platform_deps:
            yield InstallProgress(
                dependency="platform",
                state=InstallState.FAILED,
                message=f"Unknown platform: {platform_name}",
            )
            return
        
        # Check current status
        current_status = await self.checker.check_all(platform_name)
        status_map = {info.name: info for info in current_status}
        
        # Get ordered dependencies
        ordered_deps = platform_deps.get_ordered_dependencies()
        
        installed = []
        failed = []
        skipped = []
        
        for dep in ordered_deps:
            if self._cancel_requested:
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.SKIPPED,
                    message="Installation cancelled",
                )
                skipped.append(dep.name)
                continue
            
            info = status_map.get(dep.name)
            
            # Skip logic
            if skip_optional and dep.optional:
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.SKIPPED,
                    message="Optional dependency skipped",
                )
                skipped.append(dep.name)
                continue
            
            if skip_installed and info and info.status == DependencyStatus.INSTALLED:
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.SKIPPED,
                    message=f"Already installed: {info.message}",
                )
                skipped.append(dep.name)
                continue
            
            # Install the dependency
            async for progress in self._install_dependency(dep):
                yield progress
                
                if progress.state == InstallState.SUCCESS:
                    installed.append(dep.name)
                elif progress.state == InstallState.FAILED:
                    failed.append(dep.name)
                    # Don't fail fast - continue with other deps
        
        # Final summary
        success = len(failed) == 0
        yield InstallProgress(
            dependency="__summary__",
            state=InstallState.SUCCESS if success else InstallState.FAILED,
            message=f"Installed: {len(installed)}, Failed: {len(failed)}, Skipped: {len(skipped)}",
        )
    
    async def install_one(
        self,
        platform_name: str,
        dep_name: str,
    ) -> AsyncIterator[InstallProgress]:
        """Install a single dependency."""
        self._cancel_requested = False
        
        dep = self.matrix.get_dependency_for_platform(platform_name, dep_name)
        if not dep:
            yield InstallProgress(
                dependency=dep_name,
                state=InstallState.FAILED,
                message=f"Unknown dependency: {dep_name}",
            )
            return
        
        async for progress in self._install_dependency(dep):
            yield progress
    
    async def _install_dependency(
        self,
        dep: Dependency,
    ) -> AsyncIterator[InstallProgress]:
        """
        Install a single dependency.
        
        Steps:
        1. Emit RUNNING state
        2. Execute install command (with sudo if needed)
        3. Verify installation
        4. Emit SUCCESS or FAILED state
        """
        yield InstallProgress(
            dependency=dep.name,
            state=InstallState.RUNNING,
            message=f"Installing {dep.name}...",
        )
        
        if not dep.install_cmd:
            yield InstallProgress(
                dependency=dep.name,
                state=InstallState.FAILED,
                message="No install command defined",
            )
            return
        
        try:
            # Build command with escalation if needed
            cmd = self._build_command(dep.install_cmd, dep.requires_sudo)
            
            # Run installation
            process = await asyncio.create_subprocess_shell(
                cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            
            output_lines = []
            
            # Stream output
            while True:
                if self._cancel_requested:
                    process.terminate()
                    await process.wait()
                    yield InstallProgress(
                        dependency=dep.name,
                        state=InstallState.FAILED,
                        message="Installation cancelled",
                    )
                    return
                
                line = await process.stdout.readline()
                if not line:
                    break
                    
                decoded = line.decode().rstrip()
                output_lines.append(decoded)
                
                # Emit progress with latest output
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.RUNNING,
                    message=f"Installing {dep.name}...",
                    output=decoded,
                )
            
            await process.wait()
            
            if process.returncode != 0:
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.FAILED,
                    message=f"Install command failed (exit code {process.returncode})",
                    output="\n".join(output_lines[-10:]),  # Last 10 lines
                )
                return
            
            # Verify installation
            verified = await self._verify_installation(dep)
            
            if verified:
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.SUCCESS,
                    message=f"Successfully installed {dep.name}",
                )
            else:
                yield InstallProgress(
                    dependency=dep.name,
                    state=InstallState.FAILED,
                    message=f"Installation completed but verification failed",
                )
                
        except Exception as e:
            logger.exception(f"Failed to install {dep.name}")
            yield InstallProgress(
                dependency=dep.name,
                state=InstallState.FAILED,
                message=str(e),
            )
    
    def _build_command(self, cmd: str, requires_sudo: bool) -> str:
        """Build command with privilege escalation if needed."""
        if not requires_sudo:
            return cmd
        
        # Use platform-appropriate escalation
        if self.escalation_method == "osascript":
            # macOS - use AppleScript for GUI prompt
            escaped = cmd.replace('"', '\\"').replace("'", "\\'")
            return f'osascript -e \'do shell script "{escaped}" with administrator privileges\''
        elif self.escalation_method == "pkexec":
            # Linux with PolicyKit
            return f"pkexec {cmd}"
        else:
            # Default sudo
            return f"sudo {cmd}"
    
    async def _verify_installation(self, dep: Dependency) -> bool:
        """Verify that installation succeeded."""
        verify_cmd = dep.verify_cmd or dep.check_cmd
        
        if not verify_cmd:
            return True  # No way to verify, assume success
        
        try:
            result = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: subprocess.run(
                    verify_cmd,
                    shell=True,
                    capture_output=True,
                    timeout=30,
                )
            )
            return result.returncode == 0
        except Exception as e:
            logger.warning(f"Verification failed for {dep.name}: {e}")
            return False


async def install_platform_dependencies(
    platform_name: str,
    skip_installed: bool = True,
) -> InstallResult:
    """
    Convenience function to install all dependencies for a platform.
    
    Collects all progress into a final result.
    """
    installer = DependencyInstaller()
    
    result = InstallResult(success=True)
    
    async for progress in installer.install_all(platform_name, skip_installed):
        if progress.dependency == "__summary__":
            result.success = progress.state == InstallState.SUCCESS
        elif progress.state == InstallState.SUCCESS:
            result.installed.append(progress.dependency)
        elif progress.state == InstallState.FAILED:
            result.failed.append(progress.dependency)
            result.errors[progress.dependency] = progress.message
            result.success = False
        elif progress.state == InstallState.SKIPPED:
            result.skipped.append(progress.dependency)
    
    return result
