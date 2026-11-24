# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API for images attached to context notes, under ``/api/agent/v1``.

An agent attaches a figure it made (through the ``humancompiler attach``
command, which shrinks it first) and reads one back through a short-lived
signed URL. The upload does not change the note: the agent puts the returned
Markdown reference in it with the note append or replace.

The handlers are plain ``def`` and run in the threadpool, as the context
export does: they decode an image and call the object store.
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Response,
    UploadFile,
    status,
)
from pydantic import ValidationError
from sqlmodel import Session

from humancompiler_api import agent_write_service, attachment_service
from humancompiler_api.agent_auth import AgentPrincipal, require_scope
from humancompiler_api.agent_write_models import NoteTargetKind
from humancompiler_api.attachment_service import ATTACHMENT_GUIDE, AttachmentVariant
from humancompiler_api.attachment_storage import (
    AttachmentStorage,
    get_attachment_storage,
)
from humancompiler_api.database import get_session
from humancompiler_api.models import (
    AgentScope,
    AttachmentSource,
    AttachmentUrlResponse,
    NoteAttachmentResponse,
)
from humancompiler_api.note_attachment_refs import CAPTION_MAX_LENGTH
from humancompiler_api.routers.agent_proposals import body_capped_route
from humancompiler_api.routers.note_attachments import (
    ATTACHMENT_MAX_BODY_BYTES,
    read_upload,
)

router = APIRouter(prefix="/api/agent/v1", tags=["agent"])
upload_router = APIRouter(route_class=body_capped_route(ATTACHMENT_MAX_BODY_BYTES))

_NOT_FOUND: dict[int | str, dict[str, Any]] = {
    404: {"description": "Not found, or another user's"}
}


def _parse_source(raw: str | None) -> AttachmentSource | None:
    if raw is None or not raw.strip():
        return None
    try:
        return AttachmentSource.model_validate_json(raw)
    except ValidationError as error:
        problems = "; ".join(
            f"{'.'.join(str(part) for part in item['loc']) or 'source'}: {item['msg']}"
            for item in error.errors()
        )
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, f"source is not valid: {problems}"
        ) from None


@upload_router.post(
    "/context-notes/{kind}/{target_id}/attachments",
    response_model=NoteAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Attach an image to a note",
    description=(
        "Send multipart/form-data with file (the image), caption (required: "
        f"what the image shows, at most {CAPTION_MAX_LENGTH} characters) and "
        "optionally source, a JSON object saying where the original is: path, "
        "script, host, sha256 (of the original file). kind is projects, goals "
        "or tasks, and target_id is that item's id; another user's item and a "
        "missing one both give 404. Creates the note if the item has none, and "
        "does not change its text. Sending the same image for the same note "
        "again answers 200 with the attachment already there (reused: true), "
        "which takes the caption sent. "
        f"{ATTACHMENT_GUIDE}"
    ),
    responses={
        200: {"description": "The same image was already attached to this note"},
        **_NOT_FOUND,
        413: {"description": "The image or the request is too large"},
        422: {"description": "Not an accepted image, or a limit is reached"},
    },
)
def attach_image(
    kind: NoteTargetKind,
    target_id: UUID,
    response: Response,
    file: Annotated[UploadFile, File()],
    caption: Annotated[str, Form(max_length=2000)],
    session: Annotated[Session, Depends(get_session)],
    storage: Annotated[AttachmentStorage, Depends(get_attachment_storage)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.ATTACHMENTS_WRITE))
    ],
    source: Annotated[str | None, Form(max_length=8000)] = None,
) -> NoteAttachmentResponse:
    parsed_source = _parse_source(source)
    target = agent_write_service.owned_note_target(
        session, principal.user_id, kind, target_id
    ).target
    attachment, reused = attachment_service.create_attachment(
        session,
        storage,
        principal.user_id,
        target,
        read_upload(file),
        caption,
        parsed_source,
        require_caption=True,
    )
    if reused:
        response.status_code = status.HTTP_200_OK
    return attachment_service.attachment_response(attachment, reused=reused)


@router.get(
    "/attachments/{attachment_id}",
    response_model=NoteAttachmentResponse,
    summary="Get an attached image's caption and details",
    description=(
        "The caption, size and source of an image a note refers to as "
        "![caption](attachment:<id>). The image itself comes from the url "
        "endpoint."
    ),
    responses=_NOT_FOUND,
)
def get_attachment(
    attachment_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.ATTACHMENTS_READ))
    ],
) -> NoteAttachmentResponse:
    attachment = attachment_service.get_attachment(
        session, principal.user_id, attachment_id
    )
    return attachment_service.attachment_response(attachment)


@router.get(
    "/attachments/{attachment_id}/url",
    response_model=AttachmentUrlResponse,
    summary="Get a download URL for an attached image",
    description=(
        "A signed URL that opens the image (WebP) until expires_at, a few "
        "minutes from now. Fetch it without the agent token: it is on another "
        "host. variant is full (the preview, up to 1600 px) or thumb (up to "
        "480 px)."
    ),
    responses=_NOT_FOUND,
)
def get_attachment_url(
    attachment_id: UUID,
    session: Annotated[Session, Depends(get_session)],
    storage: Annotated[AttachmentStorage, Depends(get_attachment_storage)],
    principal: Annotated[
        AgentPrincipal, Depends(require_scope(AgentScope.ATTACHMENTS_READ))
    ],
    variant: Annotated[AttachmentVariant, Query()] = "full",
) -> AttachmentUrlResponse:
    return attachment_service.signed_url(
        session, storage, principal.user_id, attachment_id, variant
    )


router.include_router(upload_router)
