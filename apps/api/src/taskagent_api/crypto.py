"""Cryptography module for encrypting sensitive data like API keys."""

import base64
import os
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from taskagent_api.config import settings


class CryptoService:
    """Service for encrypting and decrypting sensitive data."""

    def __init__(self):
        """Initialize the crypto service with encryption key."""
        self.fernet = self._get_fernet()

    def _get_fernet(self) -> Fernet:
        """Get or create Fernet instance for encryption."""
        # Use environment variable for encryption key or generate from secret
        if hasattr(settings, "encryption_key") and settings.encryption_key:
            key = settings.encryption_key.encode()
        else:
            # Derive key from a secret (should be set in environment)
            password = settings.secret_key.encode()

            # Generate or retrieve a unique salt for key derivation
            if hasattr(settings, "encryption_salt") and settings.encryption_salt:
                salt = base64.urlsafe_b64decode(settings.encryption_salt.encode())
            else:
                # Fail fast if encryption_salt is not set in the environment
                raise ValueError(
                    "Encryption salt is not configured. Please set 'ENCRYPTION_SALT' "
                    "environment variable with a base64-encoded 16-byte salt."
                )

            kdf = PBKDF2HMAC(
                algorithm=hashes.SHA256(),
                length=32,
                salt=salt,
                iterations=480000,
            )
            key = base64.urlsafe_b64encode(kdf.derive(password))

        return Fernet(key)

    def encrypt(self, plaintext: str) -> str:
        """Encrypt a plaintext string.

        Args:
            plaintext: The string to encrypt

        Returns:
            Base64 encoded encrypted string
        """
        if not plaintext:
            return ""

        encrypted_bytes = self.fernet.encrypt(plaintext.encode())
        return base64.urlsafe_b64encode(encrypted_bytes).decode()

    def decrypt(self, ciphertext: str) -> str:
        """Decrypt an encrypted string.

        Args:
            ciphertext: Base64 encoded encrypted string

        Returns:
            Decrypted plaintext string
        """
        if not ciphertext:
            return ""

        try:
            encrypted_bytes = base64.urlsafe_b64decode(ciphertext.encode())
            decrypted_bytes = self.fernet.decrypt(encrypted_bytes)
            return decrypted_bytes.decode()
        except Exception as e:
            # Log the exception for debugging while maintaining security
            import logging

            logger = logging.getLogger(__name__)
            logger.warning(f"Failed to decrypt data: {type(e).__name__}")
            # Return empty string if decryption fails
            return ""


# Global instance - initialized lazily
crypto_service = None


def get_crypto_service() -> CryptoService:
    """Get the global crypto service instance, initializing it if needed."""
    global crypto_service
    if crypto_service is None:
        crypto_service = CryptoService()
    return crypto_service
