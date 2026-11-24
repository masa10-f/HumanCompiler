# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Images attached to context notes: upload, signed URLs and cleanup.

Shared by the web API (``routers/note_attachments``) and the agent API
(``routers/agent_attachments``). Both check that the project, goal or task is
the caller's before calling ``create_attachment``; every read here filters by
``NoteAttachment.user_id``, which only this module sets, from the
authenticated caller.

Life of an attachment:

1. Upload stores the preview and thumbnail and inserts the row, detached
   (``detached_at`` set): nothing refers to it yet.
2. The note write that adds ``<img data-attachment-id>`` attaches it
   (``models._sync_note_attachments``); a write that removes the reference
   detaches it again.
3. ``sweep_attachments`` deletes the files and the row of an attachment that
   has been detached for ``DETACH_GRACE``, or whose note is gone. The grace
   period keeps the image through an undo, a save from a stale browser tab,
   and the time between ``humancompiler attach`` and pasting the reference.
"""

import logging
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy import ColumnElement
from sqlmodel import Session, and_, col, func, select

from humancompiler_api import proposal_service
from humancompiler_api.attachment_images import (
    ImageRejected,
    ImageTooLarge,
    process_upload,
)
from humancompiler_api.attachment_storage import (
    WEBP_CONTENT_TYPE,
    AttachmentStorage,
    AttachmentStorageError,
    storage_unavailable,
)
from humancompiler_api.config import settings
from humancompiler_api.models import (
    AttachmentSource,
    AttachmentUrlItem,
    AttachmentUrlResponse,
    AttachmentUrlsResponse,
    AttachmentUsageResponse,
    ContextNote,
    NoteAttachment,
    NoteAttachmentResponse,
    User,
)
from humancompiler_api.note_attachment_refs import (
    attachment_markdown,
    normalize_caption,
)
from humancompiler_api.proposal_payloads import NoteTarget

logger = logging.getLogger(__name__)

# How long a signed URL opens an image.
URL_TTL_SECONDS = 600
# How long an attachment no note refers to is kept.
DETACH_GRACE = timedelta(days=7)
# Attachments one cleanup run looks at.
SWEEP_BATCH = 200
# How long an upload counts towards its note's image limit before the note
# refers to it. The editor saves the reference seconds after the upload.
PENDING_WINDOW = timedelta(hours=1)

AttachmentVariant = Literal["full", "thumb"]

ATTACHMENT_GUIDE = (
    "The image must be PNG, JPEG or WebP, at most 300 KB and 1600 px on its "
    "long edge, and not animated: shrink it before uploading (the "
    "humancompiler CLI's attach command does). It is stored as a WebP preview "
    "with a thumbnail, without EXIF; the original is not kept. To show it, put "
    "the returned markdown, ![caption](attachment:<id>), in the note of the "
    "same user. An attachment no note refers to is deleted after 7 days."
)


def _unprocessable(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail)


def _not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "Attachment not found")


def _attachment_id(attachment: NoteAttachment) -> UUID:
    if attachment.id is None:
        raise RuntimeError("Attachment has no id")
    return attachment.id


def attachment_response(
    attachment: NoteAttachment, *, reused: bool = False
) -> NoteAttachmentResponse:
    return NoteAttachmentResponse(
        id=_attachment_id(attachment),
        note_id=attachment.note_id,
        caption=attachment.caption,
        width=attachment.width,
        height=attachment.height,
        byte_size=attachment.byte_size,
        thumb_byte_size=attachment.thumb_byte_size,
        sha256=attachment.sha256,
        source=attachment.source,
        created_at=attachment.created_at or datetime.now(UTC),
        markdown=attachment_markdown(_attachment_id(attachment), attachment.caption),
        reused=reused,
    )


def _used_bytes(session: Session, user_id: UUID) -> tuple[int, int]:
    """Bytes and number of the user's stored attachments, detached ones too."""
    used, count = session.exec(
        select(
            func.coalesce(
                func.sum(NoteAttachment.byte_size + NoteAttachment.thumb_byte_size), 0
            ),
            func.count(),
        ).where(NoteAttachment.user_id == user_id)
    ).one()
    return int(used), int(count)


def attachment_usage(session: Session, user_id: UUID) -> AttachmentUsageResponse:
    used, count = _used_bytes(session, user_id)
    return AttachmentUsageResponse(
        used_bytes=used,
        limit_bytes=settings.attachment_user_quota_bytes,
        count=count,
    )


def create_attachment(
    session: Session,
    storage: AttachmentStorage,
    user_id: UUID,
    target: NoteTarget,
    data: bytes,
    caption: str,
    source: AttachmentSource | None,
    *,
    require_caption: bool,
) -> tuple[NoteAttachment, bool]:
    """Attach an image to the note of ``target``, which must be the user's.

    Returns the attachment and whether it was already there: the same image
    (same stored bytes) attached to the same note is not stored twice. Creates
    the note if the item has none. The note's content is not changed; the
    caller puts the reference in it.

    413 for too many bytes; 422 for anything else wrong with the image or the
    caption, for a note with too many images and for a full quota; 503 when the
    object store fails."""
    caption = normalize_caption(caption)
    if require_caption and not caption:
        raise _unprocessable(
            "caption is required: say what the image shows, for readers who "
            "cannot see it"
        )
    try:
        image = process_upload(data)
    except ImageTooLarge as error:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, str(error)) from None
    except ImageRejected as error:
        raise _unprocessable(str(error)) from None

    stored_keys: list[str] = []
    try:
        # Locking the user's row makes that user's uploads run one after the
        # other, so the checks below still hold when the row is inserted: two
        # uploads at the same moment cannot both take the last of the quota.
        # FOR NO KEY UPDATE, so inserts that reference the user do not wait.
        session.exec(
            select(col(User.id))
            .where(User.id == user_id)
            .with_for_update(key_share=True)
        ).first()
        note = proposal_service.lock_note(session, target)
        if note is None:
            note = proposal_service.create_note(session, user_id, target)

        # Locked, so the cleanup job cannot delete it while it is handed out
        # (and if the job got there first, the row is gone and a new one is
        # stored).
        existing = session.exec(
            select(NoteAttachment)
            .where(
                NoteAttachment.note_id == note.id,
                NoteAttachment.user_id == user_id,
                NoteAttachment.sha256 == image.sha256,
            )
            .with_for_update()
        ).first()
        if existing is not None:
            if existing.detached_at is not None:
                # Start the grace period again: the caller is about to use it.
                existing.detached_at = datetime.now(UTC)
                session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing, True

        # Images the note shows, and uploads so recent that the note may not
        # have been saved with them yet: without those, uploading many images
        # before the first save would pass the limit.
        now = datetime.now(UTC)
        shown = session.exec(
            select(func.count())
            .select_from(NoteAttachment)
            .where(
                NoteAttachment.note_id == note.id,
                col(NoteAttachment.detached_at).is_(None)
                | (col(NoteAttachment.created_at) > now - PENDING_WINDOW),
            )
        ).one()
        if shown >= settings.attachment_max_per_note:
            raise _unprocessable(
                f"The note already has {settings.attachment_max_per_note} images, "
                "the most one note can show"
            )
        used, _ = _used_bytes(session, user_id)
        new_bytes = len(image.preview) + len(image.thumb)
        if used + new_bytes > settings.attachment_user_quota_bytes:
            raise _unprocessable(
                "The storage for attached images is full "
                f"({settings.attachment_user_quota_bytes // (1024 * 1024)} MB). "
                "Remove images from notes; they are deleted 7 days later"
            )

        attachment_id = uuid4()
        prefix = f"{user_id}/{attachment_id}"
        attachment = NoteAttachment(
            id=attachment_id,
            user_id=user_id,
            note_id=note.id,
            bucket=storage.bucket,
            object_key=f"{prefix}/preview.webp",
            thumb_object_key=f"{prefix}/thumb.webp",
            byte_size=len(image.preview),
            thumb_byte_size=len(image.thumb),
            width=image.width,
            height=image.height,
            sha256=image.sha256,
            caption=caption,
            source=source.model_dump(exclude_none=True) or None if source else None,
            detached_at=datetime.now(UTC),
        )
        for key, body in (
            (attachment.object_key, image.preview),
            (attachment.thumb_object_key, image.thumb),
        ):
            storage.put(key, body, WEBP_CONTENT_TYPE)
            stored_keys.append(key)
        session.add(attachment)
        session.commit()
    except AttachmentStorageError as error:
        session.rollback()
        _delete_quietly(storage, stored_keys)
        raise storage_unavailable(error) from None
    except Exception:
        session.rollback()
        _delete_quietly(storage, stored_keys)
        raise
    session.refresh(attachment)
    return attachment, False


def _delete_quietly(storage: AttachmentStorage, keys: list[str]) -> None:
    """Delete objects whose row was not saved; a failure leaves them orphaned."""
    if not keys:
        return
    try:
        storage.delete(keys)
    except AttachmentStorageError:
        logger.warning("Could not delete %s after a failed upload", keys)


def get_attachment(
    session: Session, user_id: UUID, attachment_id: UUID
) -> NoteAttachment:
    """The user's attachment; another user's and a missing one both give 404."""
    attachment = session.exec(
        select(NoteAttachment).where(
            NoteAttachment.id == attachment_id, NoteAttachment.user_id == user_id
        )
    ).first()
    if attachment is None:
        raise _not_found()
    return attachment


def _expires_at() -> datetime:
    return datetime.now(UTC) + timedelta(seconds=URL_TTL_SECONDS)


def signed_urls(
    session: Session, storage: AttachmentStorage, user_id: UUID, ids: list[UUID]
) -> AttachmentUrlsResponse:
    """Signed thumbnail and preview URLs for those of ``ids`` that are the user's.

    The rest (unknown, deleted, another user's, in another bucket) are left
    out, so an id says nothing to someone who does not own it."""
    expires_at = _expires_at()
    if not ids:
        return AttachmentUrlsResponse(items=[], expires_at=expires_at)
    attachments = session.exec(
        select(NoteAttachment).where(
            NoteAttachment.user_id == user_id,
            col(NoteAttachment.id).in_(set(ids)),
            NoteAttachment.bucket == storage.bucket,
        )
    ).all()
    keys = [
        key
        for attachment in attachments
        for key in (attachment.object_key, attachment.thumb_object_key)
    ]
    try:
        urls = storage.signed_urls(keys, URL_TTL_SECONDS)
    except AttachmentStorageError as error:
        raise storage_unavailable(error) from None
    items = [
        AttachmentUrlItem(
            id=_attachment_id(attachment),
            url=urls[attachment.object_key],
            thumb_url=urls[attachment.thumb_object_key],
            width=attachment.width,
            height=attachment.height,
            caption=attachment.caption,
        )
        for attachment in attachments
        if attachment.object_key in urls and attachment.thumb_object_key in urls
    ]
    return AttachmentUrlsResponse(items=items, expires_at=expires_at)


def signed_url(
    session: Session,
    storage: AttachmentStorage,
    user_id: UUID,
    attachment_id: UUID,
    variant: AttachmentVariant,
) -> AttachmentUrlResponse:
    """A signed URL of the user's attachment (404 if it is not theirs)."""
    attachment = get_attachment(session, user_id, attachment_id)
    key = attachment.object_key if variant == "full" else attachment.thumb_object_key
    expires_at = _expires_at()
    if attachment.bucket != storage.bucket:
        raise _not_found()
    try:
        urls = storage.signed_urls([key], URL_TTL_SECONDS)
    except AttachmentStorageError as error:
        raise storage_unavailable(error) from None
    if key not in urls:
        raise _not_found()
    return AttachmentUrlResponse(url=urls[key], expires_at=expires_at)


def _referring_note_id(session: Session, attachment: NoteAttachment) -> UUID | None:
    """A note of the same user whose content names the attachment's id.

    References are written with the id in lower case (``note_markdown`` and the
    web editor both do)."""
    return session.exec(
        select(ContextNote.id)
        .where(
            ContextNote.user_id == attachment.user_id,
            col(ContextNote.content).contains(str(attachment.id), autoescape=True),
        )
        .limit(1)
    ).first()


def _sweepable(storage: AttachmentStorage, now: datetime) -> ColumnElement[bool]:
    """Attachments the cleanup may delete: the note is gone, or the grace
    period since the note last referred to them has passed."""
    return and_(
        NoteAttachment.bucket == storage.bucket,
        col(NoteAttachment.note_id).is_(None)
        | (col(NoteAttachment.detached_at) < now - DETACH_GRACE),
    )


def sweep_attachments(
    session: Session, storage: AttachmentStorage, now: datetime | None = None
) -> int:
    """Delete attachments nothing refers to any more; return how many.

    Candidates are attachments whose note is gone and those detached for
    longer than ``DETACH_GRACE``. One that some note of the same user still
    names (an image copied to another note, or a note written without the
    reference sync) is attached to that note instead. The files are deleted
    before the row, so a failed delete is tried again on the next run.

    Each candidate is locked and checked again before anything is deleted, so
    a note write or a repeated upload that brings the image back at the same
    moment either comes first, and the image is kept, or waits and then finds
    the attachment gone. It never ends with a kept row whose files are
    deleted."""
    now = now or datetime.now(UTC)
    candidate_ids = session.exec(
        select(col(NoteAttachment.id))
        .where(_sweepable(storage, now))
        .order_by(col(NoteAttachment.created_at))
        .limit(SWEEP_BATCH)
    ).all()
    # End the read transaction: each candidate gets its own.
    session.rollback()
    deleted = 0
    for candidate_id in candidate_ids:
        attachment = session.exec(
            select(NoteAttachment)
            .where(NoteAttachment.id == candidate_id, _sweepable(storage, now))
            # Skipped when a write holds it: that write is using the image.
            .with_for_update(skip_locked=True)
            .execution_options(populate_existing=True)
        ).first()
        if attachment is None:
            session.rollback()
            continue
        note_id = _referring_note_id(session, attachment)
        if note_id is not None:
            attachment.note_id = note_id
            attachment.detached_at = None
            session.add(attachment)
            session.commit()
            continue
        try:
            storage.delete([attachment.object_key, attachment.thumb_object_key])
        except AttachmentStorageError:
            logger.warning(
                "Could not delete the files of attachment %s; will retry",
                candidate_id,
            )
            session.rollback()
            continue
        session.delete(attachment)
        session.commit()
        deleted += 1
    return deleted
