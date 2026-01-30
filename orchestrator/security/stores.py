"""
Credential storage backends implementing ICredentialStore.

Three-tier fallback strategy:
1. KeychainStore: OS-native secure storage (macOS Keychain, Windows Credential Manager)
2. PassphraseDerivedStore: User passphrase-based encryption (secure but requires unlock)
3. EncryptedFileStore: File-based encryption with system-generated key (fallback)
"""

from __future__ import annotations

import base64
import json
import os
from typing import Optional

from ..core.interfaces import ICredentialStore
from ..core.exceptions import VaultLockedError


class KeychainStore(ICredentialStore):
    """
    OS-native secure credential storage.
    Uses macOS Keychain, Windows Credential Manager, or Linux Secret Service.
    """

    def __init__(self, service_name: str = "mlops-wizard"):
        self.service_name = service_name
        self._keyring = None
        self._init_keyring()

    def _init_keyring(self) -> None:
        try:
            import keyring

            self._keyring = keyring
        except ImportError:
            raise ImportError(
                "keyring package required for KeychainStore. "
                "Install with: pip install keyring"
            )

    def store(self, key: str, value: str) -> bool:
        self._keyring.set_password(self.service_name, key, value)
        return True

    def retrieve(self, key: str) -> Optional[str]:
        return self._keyring.get_password(self.service_name, key)

    def delete(self, key: str) -> bool:
        try:
            self._keyring.delete_password(self.service_name, key)
            return True
        except self._keyring.errors.PasswordDeleteError:
            return False

    def exists(self, key: str) -> bool:
        return self.retrieve(key) is not None


class EncryptedFileStore(ICredentialStore):
    """
    File-based encrypted credential storage.
    Uses Fernet symmetric encryption with a system-generated key.

    Security note: Key is stored alongside vault. Use PassphraseDerivedStore
    for higher security requirements.
    """

    def __init__(self, vault_path: str = "~/.mlops-wizard/.vault"):
        self.vault_path = os.path.expanduser(vault_path)
        self.key_path = f"{self.vault_path}.key"
        self._cipher = None
        self._ensure_directory()
        self._ensure_key()

    def _ensure_directory(self) -> None:
        vault_dir = os.path.dirname(self.vault_path)
        if not os.path.exists(vault_dir):
            os.makedirs(vault_dir, mode=0o700)

    def _ensure_key(self) -> None:
        try:
            from cryptography.fernet import Fernet
        except ImportError:
            raise ImportError(
                "cryptography package required for EncryptedFileStore. "
                "Install with: pip install cryptography"
            )

        if os.path.exists(self.key_path):
            with open(self.key_path, "rb") as f:
                key = f.read()
        else:
            key = Fernet.generate_key()
            with open(self.key_path, "wb") as f:
                f.write(key)
            os.chmod(self.key_path, 0o600)

        self._cipher = Fernet(key)

    def _load_vault(self) -> dict:
        if not os.path.exists(self.vault_path):
            return {}

        with open(self.vault_path, "rb") as f:
            encrypted = f.read()

        if not encrypted:
            return {}

        decrypted = self._cipher.decrypt(encrypted)
        return json.loads(decrypted.decode())

    def _save_vault(self, vault: dict) -> None:
        encrypted = self._cipher.encrypt(json.dumps(vault).encode())

        with open(self.vault_path, "wb") as f:
            f.write(encrypted)
        os.chmod(self.vault_path, 0o600)

    def store(self, key: str, value: str) -> bool:
        vault = self._load_vault()
        vault[key] = value
        self._save_vault(vault)
        return True

    def retrieve(self, key: str) -> Optional[str]:
        vault = self._load_vault()
        return vault.get(key)

    def delete(self, key: str) -> bool:
        vault = self._load_vault()
        if key in vault:
            del vault[key]
            self._save_vault(vault)
            return True
        return False

    def exists(self, key: str) -> bool:
        vault = self._load_vault()
        return key in vault


class PassphraseDerivedStore(ICredentialStore):
    """
    Passphrase-derived encrypted credential storage.

    The encryption key is derived from a user passphrase using PBKDF2.
    The passphrase is never stored - it must be entered at app launch.

    Security: Credentials are never "at rest" without human interaction.
    """

    SALT_FILE = "~/.mlops-wizard/.vault.salt"
    VAULT_FILE = "~/.mlops-wizard/.vault.enc"
    MARKER_KEY = "__marker__"
    MARKER_VALUE = "mlops-wizard"

    def __init__(self):
        self.salt_path = os.path.expanduser(self.SALT_FILE)
        self.vault_path = os.path.expanduser(self.VAULT_FILE)
        self._cipher = None
        self._locked = True
        self._ensure_directory()

    def _ensure_directory(self) -> None:
        vault_dir = os.path.dirname(self.vault_path)
        if not os.path.exists(vault_dir):
            os.makedirs(vault_dir, mode=0o700)

    @property
    def is_locked(self) -> bool:
        return self._locked

    def unlock(self, passphrase: str) -> bool:
        """
        Derive encryption key from passphrase and unlock the vault.
        Must be called before any store/retrieve operations.

        Returns True if unlock successful, False if wrong passphrase.
        """
        try:
            from cryptography.fernet import Fernet
            from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
            from cryptography.hazmat.primitives import hashes
            from cryptography.hazmat.backends import default_backend
        except ImportError:
            raise ImportError(
                "cryptography package required for PassphraseDerivedStore. "
                "Install with: pip install cryptography"
            )

        salt = self._get_or_create_salt()

        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=480000,  # OWASP recommended
            backend=default_backend(),
        )

        key = base64.urlsafe_b64encode(kdf.derive(passphrase.encode()))
        self._cipher = Fernet(key)

        # Verify passphrase by trying to decrypt a known marker
        if os.path.exists(self.vault_path):
            try:
                vault = self._load_vault_internal()
                if vault.get(self.MARKER_KEY) != self.MARKER_VALUE:
                    self._cipher = None
                    return False
            except Exception:
                self._cipher = None
                return False
        else:
            # First time: create marker
            self._save_vault_internal({self.MARKER_KEY: self.MARKER_VALUE})

        self._locked = False
        return True

    def lock(self) -> None:
        """Lock the vault, clearing the encryption key from memory."""
        self._cipher = None
        self._locked = True

    def _get_or_create_salt(self) -> bytes:
        if os.path.exists(self.salt_path):
            with open(self.salt_path, "rb") as f:
                return f.read()

        salt = os.urandom(16)
        with open(self.salt_path, "wb") as f:
            f.write(salt)
        os.chmod(self.salt_path, 0o600)
        return salt

    def _load_vault_internal(self) -> dict:
        if not os.path.exists(self.vault_path):
            return {}

        with open(self.vault_path, "rb") as f:
            encrypted = f.read()

        if not encrypted:
            return {}

        decrypted = self._cipher.decrypt(encrypted)
        return json.loads(decrypted.decode())

    def _save_vault_internal(self, vault: dict) -> None:
        encrypted = self._cipher.encrypt(json.dumps(vault).encode())

        with open(self.vault_path, "wb") as f:
            f.write(encrypted)
        os.chmod(self.vault_path, 0o600)

    def _check_unlocked(self) -> None:
        if self._locked:
            raise VaultLockedError()

    def store(self, key: str, value: str) -> bool:
        self._check_unlocked()
        vault = self._load_vault_internal()
        vault[key] = value
        self._save_vault_internal(vault)
        return True

    def retrieve(self, key: str) -> Optional[str]:
        self._check_unlocked()
        vault = self._load_vault_internal()
        return vault.get(key)

    def delete(self, key: str) -> bool:
        self._check_unlocked()
        vault = self._load_vault_internal()
        if key in vault:
            del vault[key]
            self._save_vault_internal(vault)
            return True
        return False

    def exists(self, key: str) -> bool:
        self._check_unlocked()
        vault = self._load_vault_internal()
        return key in vault

    def is_initialized(self) -> bool:
        """Check if the vault has been initialized (has a salt)."""
        return os.path.exists(self.salt_path)
