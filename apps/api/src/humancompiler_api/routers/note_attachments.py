# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Web API for images attached to context notes, under ``/api/notes``.

The editor uploads a shrunk preview here and puts the returned id in the note
HTML; the viewer asks for signed URLs of the ids a note refers to. The agent
API has the same upload under ``/api/agent/v1`` (``routers/agent_attachments``).

The handlers are plain ``def``: FastAPI runs them in a worker thread, so
decoding an image and calling the object store do not hold up the event loop.
"""

from typing import Annotated, Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from sqlmodel import Session

from humancompiler_api import attachment_service
from humancompiler_api.attachment_images import MAX_UPLOAD_BYTES
from humancompiler_api.attachment_storage import (
    AttachmentStorage,
    get_attachment_storage,
)
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.models import (
    AttachmentUrlsRequest,
    AttachmentUrlsResponse,
    AttachmentUsageResponse,
    ErrorResponse,
    NoteAttachmentResponse,
)
from humancompiler_api.proposal_payloads import NoteTarget
from humancompiler_api.routers.agent_proposals import body_capped_route
from humancompiler_api.routers.notes import (
    get_session,
    verify_goal_ownership,
    verify_project_ownership,
    verify_task_ownership,
)

# The image, plus room for the caption, the source and the multipart framing.
ATTACHMENT_MAX_BODY_BYTES = MAX_UPLOAD_BYTES + 64 * 1024

router = APIRouter(prefix="/notes", tags=["notes"])
upload_router = APIRouter(route_class=body_capped_route(ATTACHMENT_MAX_BODY_BYTES))

_UPLOAD_RESPONSES: dict[int | str, dict[str, Any]] = {
    200: {"description": "The same image was already attached to this note"},
    403: {"model": ErrorResponse, "description": "Not authorized"},
    404: {"model": ErrorResponse, "description": "Item not found"},
    413: {"description": "The image or the request is too large"},
    422: {"description": "Not an accepted image, or a limit is reached"},
}


def read_upload(file: UploadFile) -> bytes:
    """The uploaded bytes, never more than one over the limit."""
    return file.file.read(MAX_UPLOAD_BYTES + 1)


def _upload(
    session: Session,
    storage: AttachmentStorage,
    user_id: str,
    target: NoteTarget,
    file: UploadFile,
    caption: str,
    response: Response,
) -> NoteAttachmentResponse:
    # A caption may come later here: the editor puts the cursor in the caption
    # field once the image is in the note.
    attachment, reused = attachment_service.create_attachment(
        session,
        storage,
        UUID(user_id),
        target,
        read_upload(file),
        caption,
        None,
        require_caption=False,
    )
    if reused:
        response.status_code = status.HTTP_200_OK
    return attachment_service.attachment_response(attachment, reused=reused)


@upload_router.post(
    "/projects/{project_id}/attachments",
    response_model=NoteAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_UPLOAD_RESPONSES,
)
def upload_project_attachment(
    project_id: UUID,
    response: Response,
    file: Annotated[UploadFile, File()],
    caption: Annotated[str, Form(max_length=2000)] = "",
    session: Session = Depends(get_session),
    storage: AttachmentStorage = Depends(get_attachment_storage),
    current_user: AuthUser = Depends(get_current_user),
) -> NoteAttachmentResponse:
    """Attach an image to a project's note (PNG, JPEG or WebP, already shrunk)."""
    verify_project_ownership(session, project_id, current_user.user_id)
    target = NoteTarget(project_id=project_id)
    return _upload(
        session, storage, current_user.user_id, target, file, caption, response
    )


@upload_router.post(
    "/goals/{goal_id}/attachments",
    response_model=NoteAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_UPLOAD_RESPONSES,
)
def upload_goal_attachment(
    goal_id: UUID,
    response: Response,
    file: Annotated[UploadFile, File()],
    caption: Annotated[str, Form(max_length=2000)] = "",
    session: Session = Depends(get_session),
    storage: AttachmentStorage = Depends(get_attachment_storage),
    current_user: AuthUser = Depends(get_current_user),
) -> NoteAttachmentResponse:
    """Attach an image to a goal's note (PNG, JPEG or WebP, already shrunk)."""
    verify_goal_ownership(session, goal_id, current_user.user_id)
    target = NoteTarget(goal_id=goal_id)
    return _upload(
        session, storage, current_user.user_id, target, file, caption, response
    )


@upload_router.post(
    "/tasks/{task_id}/attachments",
    response_model=NoteAttachmentResponse,
    status_code=status.HTTP_201_CREATED,
    responses=_UPLOAD_RESPONSES,
)
def upload_task_attachment(
    task_id: UUID,
    response: Response,
    file: Annotated[UploadFile, File()],
    caption: Annotated[str, Form(max_length=2000)] = "",
    session: Session = Depends(get_session),
    storage: AttachmentStorage = Depends(get_attachment_storage),
    current_user: AuthUser = Depends(get_current_user),
) -> NoteAttachmentResponse:
    """Attach an image to a task's note (PNG, JPEG or WebP, already shrunk)."""
    verify_task_ownership(session, task_id, current_user.user_id)
    target = NoteTarget(task_id=task_id)
    return _upload(
        session, storage, current_user.user_id, target, file, caption, response
    )


@router.post("/attachments/urls", response_model=AttachmentUrlsResponse)
def get_attachment_urls(
    request: AttachmentUrlsRequest,
    session: Session = Depends(get_session),
    storage: AttachmentStorage = Depends(get_attachment_storage),
    current_user: AuthUser = Depends(get_current_user),
) -> AttachmentUrlsResponse:
    """Signed URLs for the images a note refers to.

    Only the caller's own attachments are answered; any other id is left out.
    The URLs stop working at ``expires_at``: ask again then."""
    return attachment_service.signed_urls(
        session, storage, UUID(current_user.user_id), request.ids
    )


@router.get("/attachments/usage", response_model=AttachmentUsageResponse)
def get_attachment_usage(
    session: Session = Depends(get_session),
    current_user: AuthUser = Depends(get_current_user),
) -> AttachmentUsageResponse:
    """How much of the caller's storage for attached images is in use."""
    return attachment_service.attachment_usage(session, UUID(current_user.user_id))


router.include_router(upload_router)
