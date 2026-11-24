# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Where attached images are kept: a private object store.

The API is the only reader and writer. The bucket is private and has no
storage policies, so the anon and user keys open nothing; the API uses the
service role, checks who owns an attachment in the database, and hands out
signed URLs that expire after a few minutes.

``AttachmentStorage`` is all the rest of the code knows, so the files can move
to another S3-compatible store (the rows hold ``bucket`` and ``object_key``,
never a URL) and tests run against ``InMemoryAttachmentStorage``.
"""

import logging
from typing import Protocol

from fastapi import HTTPException, status

from humancompiler_api.config import settings
from humancompiler_api.database import db

logger = logging.getLogger(__name__)

WEBP_CONTENT_TYPE = "image/webp"


class AttachmentStorageError(Exception):
    """The object store refused or failed a request."""


class AttachmentStorage(Protocol):
    """A private bucket of objects addressed by key."""

    @property
    def bucket(self) -> str:
        """The bucket's name, stored with every attachment."""

    def put(self, key: str, data: bytes, content_type: str) -> None:
        """Store ``data`` under ``key``, replacing an object already there."""

    def delete(self, keys: list[str]) -> None:
        """Delete the objects; a key with no object is not an error."""

    def signed_urls(self, keys: list[str], expires_in: int) -> dict[str, str]:
        """A URL for each key that opens its object for ``expires_in`` seconds.

        A key the store could not sign is left out."""


class SupabaseAttachmentStorage:
    """A private Supabase Storage bucket, used with the service role."""

    def __init__(self, bucket: str) -> None:
        self._bucket = bucket

    @property
    def bucket(self) -> str:
        return self._bucket

    def _files(self):  # type: ignore[no-untyped-def]
        client = db.get_service_client()
        if client is None:
            raise AttachmentStorageError("Supabase is not configured")
        return client.storage.from_(self._bucket)

    def put(self, key: str, data: bytes, content_type: str) -> None:
        try:
            self._files().upload(
                key,
                data,
                {
                    "content-type": content_type,
                    # The key holds the attachment's id, so a retry of the same
                    # upload overwrites its own object.
                    "upsert": "true",
                    # A key is never reused for other bytes.
                    "cache-control": "31536000",
                },
            )
        except Exception as error:
            raise AttachmentStorageError(f"Could not store {key}") from error

    def delete(self, keys: list[str]) -> None:
        if not keys:
            return
        try:
            self._files().remove(keys)
        except Exception as error:
            raise AttachmentStorageError("Could not delete objects") from error

    def signed_urls(self, keys: list[str], expires_in: int) -> dict[str, str]:
        if not keys:
            return {}
        try:
            signed = self._files().create_signed_urls(keys, expires_in)
        except Exception as error:
            raise AttachmentStorageError("Could not sign URLs") from error
        urls: dict[str, str] = {}
        for item in signed:
            url = item.get("signedURL") or item.get("signedUrl")
            path = item.get("path")
            if url and path and not item.get("error"):
                urls[path] = url
        return urls


class InMemoryAttachmentStorage:
    """Objects in a dict, for tests."""

    def __init__(self, bucket: str = "test-attachments") -> None:
        self._bucket = bucket
        self.objects: dict[str, bytes] = {}
        self.content_types: dict[str, str] = {}

    @property
    def bucket(self) -> str:
        return self._bucket

    def put(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = data
        self.content_types[key] = content_type

    def delete(self, keys: list[str]) -> None:
        for key in keys:
            self.objects.pop(key, None)
            self.content_types.pop(key, None)

    def signed_urls(self, keys: list[str], expires_in: int) -> dict[str, str]:
        return {
            key: f"https://storage.test/{self._bucket}/{key}?expires_in={expires_in}"
            for key in keys
            if key in self.objects
        }


_storage: AttachmentStorage | None = None


def get_attachment_storage() -> AttachmentStorage:
    """FastAPI dependency: the store attachments are kept in."""
    global _storage
    if _storage is None:
        _storage = SupabaseAttachmentStorage(settings.attachments_bucket)
    return _storage


def storage_unavailable(error: AttachmentStorageError) -> HTTPException:
    """The 503 for a request the object store failed; the cause is logged."""
    logger.error("Attachment storage failed: %s", error, exc_info=error)
    return HTTPException(
        status.HTTP_503_SERVICE_UNAVAILABLE,
        "Image storage is not available right now; try again later",
    )
