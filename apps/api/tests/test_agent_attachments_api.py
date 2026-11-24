# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Agent API for note attachments under /api/agent/v1."""

import json
from collections.abc import Iterator
from typing import Any
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api.attachment_storage import (
    InMemoryAttachmentStorage,
    get_attachment_storage,
)
from humancompiler_api.database import get_session
from humancompiler_api.main import app
from humancompiler_api.models import AgentScope, ContextNote, NoteAttachment
from humancompiler_api.note_markdown_out import note_html_to_markdown
from tests.agent_api_helpers import (
    bearer,
    client,
    issue_token,
    seed_goal,
    seed_project,
    seed_task,
    seed_user,
    use_session,
)
from tests.attachment_helpers import image_bytes

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")
BASE = "/api/agent/v1"
ATTACH = [AgentScope.ATTACHMENTS_WRITE, AgentScope.ATTACHMENTS_READ]
SOURCE = {
    "path": "/data/run42/loss.png",
    "script": "analysis/plot_loss.py",
    "host": "lab-gpu-01",
    "sha256": "a" * 64,
}


@pytest.fixture
def storage() -> InMemoryAttachmentStorage:
    return InMemoryAttachmentStorage()


@pytest.fixture(autouse=True)
def agent_session(
    session: Session, storage: InMemoryAttachmentStorage
) -> Iterator[None]:
    use_session(session)
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    app.dependency_overrides[get_attachment_storage] = lambda: storage
    yield
    app.dependency_overrides.pop(get_session, None)
    app.dependency_overrides.pop(get_attachment_storage, None)


def _attach(
    token: str,
    kind: str,
    target_id: UUID,
    *,
    data: bytes | None = None,
    caption: str | None = "損失の推移",
    source: Any = None,
):
    fields: dict[str, str] = {}
    if caption is not None:
        fields["caption"] = caption
    if source is not None:
        fields["source"] = source if isinstance(source, str) else json.dumps(source)
    return client.post(
        f"{BASE}/context-notes/{kind}/{target_id}/attachments",
        files={"file": ("preview.webp", data or image_bytes("WEBP"), "image/webp")},
        data=fields,
        headers=bearer(token),
    )


def _rows(session: Session) -> list[NoteAttachment]:
    session.expire_all()
    return list(session.exec(select(NoteAttachment)).all())


def test_attach_returns_the_reference_and_keeps_the_source(session: Session) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)

    response = _attach(token, "projects", project.id, source=SOURCE)

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["markdown"] == f"![損失の推移](attachment:{body['id']})"
    assert body["source"] == SOURCE
    assert body["reused"] is False
    (row,) = _rows(session)
    assert row.user_id == USER_A
    assert row.source == SOURCE
    assert row.caption == "損失の推移"


@pytest.mark.parametrize("kind", ["goals", "tasks"])
def test_attach_to_goal_and_task(session: Session, kind: str) -> None:
    token = issue_token(session, USER_A, ATTACH)
    goal = seed_goal(session, seed_project(session, USER_A))
    target = goal if kind == "goals" else seed_task(session, goal)

    response = _attach(token, kind, target.id)

    assert response.status_code == 201, response.text


def test_attach_needs_the_write_scope(session: Session) -> None:
    token = issue_token(
        session, USER_A, [AgentScope.ATTACHMENTS_READ, AgentScope.NOTES_WRITE]
    )
    project = seed_project(session, USER_A)

    response = _attach(token, "projects", project.id)

    assert response.status_code == 403
    assert response.json()["detail"] == "Missing required scope: attachments:write"
    assert _rows(session) == []


def test_attach_to_another_users_item_is_404(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_B)

    response = _attach(token, "projects", project.id)

    assert response.status_code == 404
    assert storage.objects == {}


@pytest.mark.parametrize("caption", [None, "", "   \n "])
def test_caption_is_required(session: Session, caption: str | None) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)

    response = _attach(token, "projects", project.id, caption=caption)

    assert response.status_code == 422
    assert _rows(session) == []


def test_caption_becomes_one_line(session: Session) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)

    response = _attach(token, "projects", project.id, caption=" 図 [1]\n  損失 ")

    body = response.json()
    assert body["caption"] == "図 [1] 損失"
    assert body["markdown"] == f"![図 \\[1\\] 損失](attachment:{body['id']})"


@pytest.mark.parametrize(
    "source",
    [
        "not json",
        '["a list"]',
        {"path": "/a.png", "command": "rm"},
        {"sha256": "abc"},
        {"path": "x" * 1001},
    ],
    ids=["not-json", "not-an-object", "unknown-key", "bad-sha256", "long-path"],
)
def test_bad_source_is_422(session: Session, source: Any) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)

    response = _attach(token, "projects", project.id, source=source)

    assert response.status_code == 422
    assert "source" in response.json()["detail"]
    assert _rows(session) == []


def test_same_image_again_is_reused(session: Session) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)
    first = _attach(token, "projects", project.id)

    second = _attach(token, "projects", project.id)

    assert second.status_code == 200
    assert second.json()["reused"] is True
    assert second.json()["id"] == first.json()["id"]


def test_metadata_and_url_for_the_owner(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)
    attachment_id = _attach(token, "projects", project.id, source=SOURCE).json()["id"]

    metadata = client.get(f"{BASE}/attachments/{attachment_id}", headers=bearer(token))
    full = client.get(f"{BASE}/attachments/{attachment_id}/url", headers=bearer(token))
    thumb = client.get(
        f"{BASE}/attachments/{attachment_id}/url?variant=thumb", headers=bearer(token)
    )

    assert metadata.status_code == 200
    assert metadata.json()["caption"] == "損失の推移"
    assert metadata.json()["source"] == SOURCE
    assert full.json()["url"].endswith("/preview.webp?expires_in=600")
    assert thumb.json()["url"].endswith("/thumb.webp?expires_in=600")
    assert "expires_at" in full.json()
    assert full.headers.get("location") is None


def test_another_users_token_gets_neither_metadata_nor_url(session: Session) -> None:
    owner = issue_token(session, USER_A, ATTACH)
    other = issue_token(session, USER_B, ATTACH, name="other")
    project = seed_project(session, USER_A)
    attachment_id = _attach(owner, "projects", project.id).json()["id"]

    metadata = client.get(f"{BASE}/attachments/{attachment_id}", headers=bearer(other))
    url = client.get(f"{BASE}/attachments/{attachment_id}/url", headers=bearer(other))
    missing = client.get(f"{BASE}/attachments/{uuid4()}", headers=bearer(other))

    assert metadata.status_code == url.status_code == 404
    # Another user's attachment and one that does not exist look the same.
    assert metadata.json() == url.json() == missing.json()


def test_reading_needs_the_read_scope(session: Session) -> None:
    writer = issue_token(session, USER_A, [AgentScope.ATTACHMENTS_WRITE])
    project = seed_project(session, USER_A)
    attachment_id = _attach(writer, "projects", project.id).json()["id"]

    for path in (f"/attachments/{attachment_id}", f"/attachments/{attachment_id}/url"):
        response = client.get(f"{BASE}{path}", headers=bearer(writer))
        assert response.status_code == 403
        assert response.json()["detail"] == "Missing required scope: attachments:read"


def test_unknown_variant_is_422(session: Session) -> None:
    token = issue_token(session, USER_A, ATTACH)
    project = seed_project(session, USER_A)
    attachment_id = _attach(token, "projects", project.id).json()["id"]

    response = client.get(
        f"{BASE}/attachments/{attachment_id}/url?variant=original",
        headers=bearer(token),
    )

    assert response.status_code == 422


def test_appending_the_reference_attaches_the_image(session: Session) -> None:
    token = issue_token(session, USER_A, [*ATTACH, AgentScope.NOTES_WRITE])
    project = seed_project(session, USER_A)
    attached = _attach(token, "projects", project.id).json()
    assert _rows(session)[0].detached_at is not None

    response = client.post(
        f"{BASE}/context-notes/projects/{project.id}/append",
        json={"content_markdown": f"結果:\n\n{attached['markdown']}"},
        headers=bearer(token),
    )

    assert response.status_code == 200, response.text
    assert _rows(session)[0].detached_at is None
    note = session.exec(
        select(ContextNote).where(ContextNote.project_id == project.id)
    ).one()
    assert f'<img data-attachment-id="{attached["id"]}" alt="損失の推移">' in (
        note.content
    )
    assert "storage.test" not in note.content
    assert note.content_text.endswith("結果:\n損失の推移")
    # An agent reading the note back gets the same reference.
    assert attached["markdown"] in note_html_to_markdown(note.content)


def test_replacing_the_note_without_the_reference_detaches_the_image(
    session: Session,
) -> None:
    token = issue_token(
        session,
        USER_A,
        [*ATTACH, AgentScope.NOTES_WRITE, AgentScope.WRITES_UNCONFIRMED],
    )
    project = seed_project(session, USER_A)
    attached = _attach(token, "projects", project.id).json()
    appended = client.post(
        f"{BASE}/context-notes/projects/{project.id}/append",
        json={"content_markdown": attached["markdown"]},
        headers=bearer(token),
    ).json()

    response = client.put(
        f"{BASE}/context-notes/projects/{project.id}",
        json={
            "content_markdown": "図は不要になった",
            "expected_updated_at": appended["updated_at"],
        },
        headers=bearer(token),
    )

    assert response.status_code == 200, response.text
    assert _rows(session)[0].detached_at is not None


def test_a_note_with_only_an_image_is_not_blank_for_replace(session: Session) -> None:
    # Replacing it is destructive, so it needs writes:unconfirmed.
    token = issue_token(session, USER_A, [*ATTACH, AgentScope.NOTES_WRITE])
    project = seed_project(session, USER_A)
    attached = _attach(token, "projects", project.id).json()
    created = client.put(
        f"{BASE}/context-notes/projects/{project.id}",
        json={"content_markdown": attached["markdown"], "expected_updated_at": None},
        headers=bearer(token),
    )
    # The upload created the note, so a replace must name its updated_at.
    assert created.status_code == 409
    current = created.json()["detail"]["current_updated_at"]
    filled = client.put(
        f"{BASE}/context-notes/projects/{project.id}",
        json={"content_markdown": attached["markdown"], "expected_updated_at": current},
        headers=bearer(token),
    )
    assert filled.status_code == 200, filled.text

    response = client.put(
        f"{BASE}/context-notes/projects/{project.id}",
        json={
            "content_markdown": "text only",
            "expected_updated_at": filled.json()["updated_at"],
        },
        headers=bearer(token),
    )

    assert response.status_code == 403


def test_openapi_describes_the_upload(session: Session) -> None:
    spec = app.openapi()
    post = spec["paths"][f"{BASE}/context-notes/{{kind}}/{{target_id}}/attachments"][
        "post"
    ]

    assert "multipart/form-data" in post["requestBody"]["content"]
    assert "300 KB" in post["description"]
    assert set(post["responses"]) >= {"200", "201", "404", "413", "422"}
