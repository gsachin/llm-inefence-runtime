# Security module for credential management
# Follows SOLID principles: Strategy Pattern for storage backends

from .vault import CredentialVault, CredentialVaultFactory
from .stores import KeychainStore, EncryptedFileStore, PassphraseDerivedStore

__all__ = [
    "CredentialVault",
    "CredentialVaultFactory",
    "KeychainStore",
    "EncryptedFileStore",
    "PassphraseDerivedStore",
]
