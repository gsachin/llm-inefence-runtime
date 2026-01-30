"""
Credential Vault - Facade for secure credential management.

Provides a unified interface for storing and retrieving:
- AWS credentials (access key, secret key, region)
- HuggingFace tokens
- Other API keys and secrets

Uses the best available storage backend for each platform.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

from ..core.interfaces import ICredentialStore
from ..core.exceptions import CredentialMissingError
from .stores import KeychainStore, EncryptedFileStore, PassphraseDerivedStore

logger = logging.getLogger(__name__)


class CredentialVaultFactory:
    """
    Factory for selecting the best credential store per platform.
    Follows the Factory Pattern + Open/Closed Principle.
    """

    @staticmethod
    def create(
        platform: str | None = None,
        require_passphrase: bool = False,
    ) -> ICredentialStore:
        """
        Create the best available credential store for the platform.

        Priority:
        1. OS-native keychain (most secure, seamless UX)
        2. Passphrase-derived store (secure, requires user input)
        3. Encrypted file store (fallback)

        Args:
            platform: Platform identifier (mac_m_series, wsl2_windows, linux_workstation)
            require_passphrase: If True, force passphrase-based encryption
        """

        # Tier 2: Passphrase-derived encryption (if explicitly requested)
        if require_passphrase:
            logger.info("Using passphrase-derived credential store")
            return PassphraseDerivedStore()

        # Tier 1: Try OS-native secure storage
        if platform == "mac_m_series" or (platform is None and _is_macos()):
            try:
                store = KeychainStore()
                # Test that keychain is accessible
                store._init_keyring()
                logger.info("Using macOS Keychain for credential storage")
                return store
            except Exception as e:
                logger.warning(f"Keychain unavailable: {e}")

        elif platform == "wsl2_windows":
            try:
                import keyring
                from keyring.backends import Windows

                keyring.set_keyring(Windows.WinVaultKeyring())
                store = KeychainStore()
                logger.info("Using Windows Credential Manager for credential storage")
                return store
            except Exception as e:
                logger.warning(f"Windows Credential Manager unavailable: {e}")

        elif platform == "linux_workstation" or (platform is None and _is_linux()):
            try:
                store = KeychainStore()
                store._init_keyring()
                logger.info("Using Linux Secret Service for credential storage")
                return store
            except Exception as e:
                logger.warning(f"Linux Secret Service unavailable: {e}")

        # Tier 3: File encryption with system-generated key (fallback)
        logger.info("Using encrypted file store for credentials")
        return EncryptedFileStore()


def _is_macos() -> bool:
    import platform

    return platform.system() == "Darwin"


def _is_linux() -> bool:
    import platform

    return platform.system() == "Linux" and not os.path.exists(
        "/proc/sys/fs/binfmt_misc/WSLInterop"
    )


class CredentialVault:
    """
    Facade for credential management.
    Provides high-level methods for specific credential types.
    """

    def __init__(self, store: ICredentialStore | None = None, platform: str | None = None):
        """
        Initialize the credential vault.

        Args:
            store: Explicit credential store to use (for testing)
            platform: Platform identifier for auto-selection
        """
        self.store = store or CredentialVaultFactory.create(platform)

    # =========================================================================
    # AWS Credentials
    # =========================================================================

    def set_aws_credentials(
        self,
        access_key: str,
        secret_key: str,
        region: str,
    ) -> bool:
        """Store AWS credentials securely."""
        self.store.store("aws_access_key", access_key)
        self.store.store("aws_secret_key", secret_key)
        self.store.store("aws_region", region)
        return True

    def get_aws_credentials(self) -> dict:
        """
        Retrieve AWS credentials.

        Returns:
            Dict with access_key, secret_key, region

        Raises:
            CredentialMissingError: If credentials are not configured
        """
        access_key = self.store.retrieve("aws_access_key")
        secret_key = self.store.retrieve("aws_secret_key")
        region = self.store.retrieve("aws_region")

        if not all([access_key, secret_key, region]):
            raise CredentialMissingError("AWS")

        return {
            "access_key": access_key,
            "secret_key": secret_key,
            "region": region,
        }

    def get_aws_session(self):
        """
        Return a boto3 session with stored credentials.

        Returns:
            boto3.Session

        Raises:
            CredentialMissingError: If credentials are not configured
            ImportError: If boto3 is not installed
        """
        try:
            import boto3
        except ImportError:
            raise ImportError(
                "boto3 package required for AWS operations. "
                "Install with: pip install boto3"
            )

        creds = self.get_aws_credentials()

        return boto3.Session(
            aws_access_key_id=creds["access_key"],
            aws_secret_access_key=creds["secret_key"],
            region_name=creds["region"],
        )

    def has_aws_credentials(self) -> bool:
        """Check if AWS credentials are configured."""
        return all(
            self.store.exists(key)
            for key in ["aws_access_key", "aws_secret_key", "aws_region"]
        )

    def delete_aws_credentials(self) -> bool:
        """Delete stored AWS credentials."""
        self.store.delete("aws_access_key")
        self.store.delete("aws_secret_key")
        self.store.delete("aws_region")
        return True

    # =========================================================================
    # HuggingFace Token
    # =========================================================================

    def set_huggingface_token(self, token: str) -> bool:
        """Store HuggingFace token securely."""
        return self.store.store("hf_token", token)

    def get_huggingface_token(self) -> str:
        """
        Retrieve HuggingFace token.

        Raises:
            CredentialMissingError: If token is not configured
        """
        token = self.store.retrieve("hf_token")
        if not token:
            raise CredentialMissingError("HuggingFace")
        return token

    def has_huggingface_token(self) -> bool:
        """Check if HuggingFace token is configured."""
        return self.store.exists("hf_token")

    def delete_huggingface_token(self) -> bool:
        """Delete stored HuggingFace token."""
        return self.store.delete("hf_token")

    # =========================================================================
    # Generic Credentials
    # =========================================================================

    def set_credential(self, key: str, value: str) -> bool:
        """Store a generic credential."""
        return self.store.store(key, value)

    def get_credential(self, key: str) -> Optional[str]:
        """Retrieve a generic credential."""
        return self.store.retrieve(key)

    def delete_credential(self, key: str) -> bool:
        """Delete a generic credential."""
        return self.store.delete(key)

    # =========================================================================
    # Status
    # =========================================================================

    def get_status(self) -> dict:
        """
        Return the configuration status of all credential types.

        Returns:
            Dict with boolean flags for each credential type
        """
        return {
            "aws_configured": self.has_aws_credentials(),
            "huggingface_configured": self.has_huggingface_token(),
        }
