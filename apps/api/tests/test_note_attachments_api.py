# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Web API for note attachments, the reference sync on note writes, and cleanup."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

import pytest
from sqlmodel import Session, select

from humancompiler_api import attachment_service
from humancompiler_api.attachment_images import MAX_UPLOAD_BYTES
from humancompiler_api.attachment_storage import (
    AttachmentStorageError,
    InMemoryAttachmentStorage,
    get_attachment_storage,
)
from humancompiler_api.auth import AuthUser, get_current_user
from humancompiler_api.config import settings
from humancompiler_api.main import app
from humancompiler_api.models import ContextNote, NoteAttachment, WeeklyNote
from humancompiler_api.routers import notes
from humancompiler_api.scheduler import notification_scheduler
from tests.agent_api_helpers import (
    client,
    seed_goal,
    seed_note,
    seed_project,
    seed_task,
    seed_user,
)
from tests.attachment_helpers import image_bytes, noise_bytes, opened

USER_A = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
USER_B = UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")


class _Caller:
    user_id = USER_A


@pytest.fixture
def storage() -> InMemoryAttachmentStorage:
    return InMemoryAttachmentStorage()


@pytest.fixture(autouse=True)
def web_session(session: Session, storage: InMemoryAttachmentStorage) -> Iterator[None]:
    seed_user(session, USER_A)
    seed_user(session, USER_B)
    _Caller.user_id = USER_A

    def override_session():
        yield session

    def override_user():
        return AuthUser(user_id=str(_Caller.user_id), email="web-user@example.com")

    app.dependency_overrides[notes.get_session] = override_session
    app.dependency_overrides[get_current_user] = override_user
    app.dependency_overrides[get_attachment_storage] = lambda: storage
    yield
    for dependency in (notes.get_session, get_current_user, get_attachment_storage):
        app.dependency_overrides.pop(dependency, None)


def _upload(path: str, data: bytes | None = None, caption: str | None = "図1"):
    fields = {} if caption is None else {"caption": caption}
    return client.post(
        path,
        files={"file": ("figure.png", data or image_bytes(), "image/png")},
        data=fields,
    )


def _project_path(session: Session, owner: UUID = USER_A) -> tuple[str, UUID]:
    project = seed_project(session, owner)
    return f"/api/notes/projects/{project.id}", project.id


def _rows(session: Session) -> list[NoteAttachment]:
    session.expire_all()
    return list(session.exec(select(NoteAttachment)).all())


def _reference(attachment_id: str, caption: str = "図1") -> str:
    return f'<img data-attachment-id="{attachment_id}" alt="{caption}">'


def _save_note(path: str, content: str) -> None:
    response = client.put(path, json={"content": content, "content_type": "html"})
    assert response.status_code == 200, response.text


# --- Upload -----------------------------------------------------------------


def test_upload_stores_a_preview_and_a_thumbnail(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)

    response = _upload(f"{path}/attachments", image_bytes(size=(800, 400)))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["caption"] == "図1"
    assert (body["width"], body["height"]) == (800, 400)
    assert body["markdown"] == f"![図1](attachment:{body['id']})"
    assert body["reused"] is False
    assert "object_key" not in body and "bucket" not in body

    (row,) = _rows(session)
    assert row.user_id == USER_A
    assert row.bucket == storage.bucket
    assert row.object_key == f"{USER_A}/{row.id}/preview.webp"
    assert row.thumb_object_key == f"{USER_A}/{row.id}/thumb.webp"
    assert set(storage.objects) == {row.object_key, row.thumb_object_key}
    assert opened(storage.objects[row.object_key]).format == "WEBP"
    assert row.byte_size == len(storage.objects[row.object_key])
    assert row.thumb_byte_size == len(storage.objects[row.thumb_object_key])
    assert set(storage.content_types.values()) == {"image/webp"}


def test_upload_creates_the_note_without_text(session: Session) -> None:
    path, project_id = _project_path(session)

    assert _upload(f"{path}/attachments").status_code == 201

    note = session.exec(
        select(ContextNote).where(ContextNote.project_id == project_id)
    ).one()
    assert note.content == ""
    assert _rows(session)[0].note_id == note.id


@pytest.mark.parametrize("kind", ["goals", "tasks"])
def test_upload_to_goal_and_task_notes(session: Session, kind: str) -> None:
    goal = seed_goal(session, seed_project(session, USER_A))
    target = goal if kind == "goals" else seed_task(session, goal)

    response = _upload(f"/api/notes/{kind}/{target.id}/attachments")

    assert response.status_code == 201, response.text
    note = session.get(ContextNote, UUID(response.json()["note_id"]))
    assert note is not None
    assert (note.goal_id if kind == "goals" else note.task_id) == target.id


def test_web_upload_may_leave_the_caption_for_later(session: Session) -> None:
    path, _ = _project_path(session)

    response = _upload(f"{path}/attachments", caption=None)

    assert response.status_code == 201
    assert response.json()["caption"] == ""


def test_upload_to_another_users_item_is_refused(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session, USER_B)

    response = _upload(f"{path}/attachments")

    assert response.status_code == 403
    assert _rows(session) == []
    assert storage.objects == {}


def test_upload_of_something_else_than_an_image_is_422(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)

    response = _upload(f"{path}/attachments", b"<svg><script>1</script></svg>")

    assert response.status_code == 422
    assert "PNG, JPEG and WebP" in response.json()["detail"]
    assert storage.objects == {}


def test_upload_of_a_header_claiming_a_huge_image_is_422(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    # 45 bytes that say "20000 x 20000 pixels": refused, not a server error.
    path, _ = _project_path(session)
    tiny = bytes.fromhex(
        "89504e470d0a1a0a0000000d4948445200004e2000004e2008020000006c12d16e"
        "0000000049454e44ae426082"
    )

    response = _upload(f"{path}/attachments", tiny)

    assert response.status_code == 422, response.text
    assert "long edge limit" in response.json()["detail"]
    assert storage.objects == {}


def test_upload_over_the_image_limit_is_413(session: Session) -> None:
    path, _ = _project_path(session)
    data = noise_bytes("PNG", (355, 355))
    assert MAX_UPLOAD_BYTES < len(data) < MAX_UPLOAD_BYTES + 32 * 1024

    response = _upload(f"{path}/attachments", data)

    assert response.status_code == 413
    assert _rows(session) == []


def test_upload_over_the_body_cap_is_413_before_parsing(session: Session) -> None:
    path, _ = _project_path(session)

    response = _upload(f"{path}/attachments", b"x" * (MAX_UPLOAD_BYTES + 128 * 1024))

    assert response.status_code == 413
    assert "Request body exceeds" in response.json()["detail"]


def test_same_image_for_the_same_note_is_stored_once(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    first = _upload(f"{path}/attachments")

    second = _upload(f"{path}/attachments", caption="another caption")

    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["reused"] is True
    assert second.json()["caption"] == "another caption"
    (row,) = _rows(session)
    assert row.caption == "another caption"
    assert len(storage.objects) == 2


@pytest.mark.parametrize("caption", [None, "", "  "])
def test_same_image_without_a_caption_keeps_the_caption(
    session: Session, caption: str | None
) -> None:
    path, _ = _project_path(session)
    first = _upload(f"{path}/attachments")

    second = _upload(f"{path}/attachments", caption=caption)

    assert second.status_code == 200
    assert second.json()["id"] == first.json()["id"]
    assert second.json()["caption"] == "図1"
    (row,) = _rows(session)
    assert row.caption == "図1"


def test_same_image_for_another_note_is_a_new_attachment(session: Session) -> None:
    first_path, _ = _project_path(session)
    second_path, _ = _project_path(session)

    first = _upload(f"{first_path}/attachments")
    second = _upload(f"{second_path}/attachments")

    assert second.status_code == 201
    assert second.json()["id"] != first.json()["id"]


def test_note_shows_at_most_the_limit_of_images(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "attachment_max_per_note", 1)
    path, _ = _project_path(session)
    first = _upload(f"{path}/attachments", image_bytes(color=(1, 2, 3)))
    _save_note(path, _reference(first.json()["id"]))

    response = _upload(f"{path}/attachments", image_bytes(color=(9, 9, 9)))

    assert response.status_code == 422
    assert "already has 1 images" in response.json()["detail"]


def test_limit_counts_uploads_the_note_does_not_refer_to_yet(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Several images pasted before the first save must not pass the limit.
    monkeypatch.setattr(settings, "attachment_max_per_note", 2)
    path, _ = _project_path(session)
    for color in ((200, 30, 30), (30, 200, 30)):
        response = _upload(f"{path}/attachments", image_bytes(color=color))
        assert response.status_code == 201

    response = _upload(f"{path}/attachments", image_bytes(color=(30, 30, 200)))

    assert response.status_code == 422
    assert len(_rows(session)) == 2


def test_limit_does_not_count_images_removed_from_the_note(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "attachment_max_per_note", 1)
    path, _ = _project_path(session)
    _upload(f"{path}/attachments", image_bytes(color=(1, 2, 3)))
    (row,) = _rows(session)
    # Uploaded a while ago and no longer in the note: waiting to be deleted.
    row.created_at = datetime.now(UTC) - timedelta(hours=2)
    row.detached_at = datetime.now(UTC) - timedelta(hours=1)
    session.add(row)
    session.commit()

    response = _upload(f"{path}/attachments", image_bytes(color=(9, 9, 9)))

    assert response.status_code == 201


def test_quota_counts_all_of_the_users_attachments(
    session: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    path, _ = _project_path(session)
    first = _upload(f"{path}/attachments", image_bytes(color=(1, 2, 3)))
    used = first.json()["byte_size"] + first.json()["thumb_byte_size"]
    monkeypatch.setattr(settings, "attachment_user_quota_bytes", used + 10)

    response = _upload(f"{path}/attachments", image_bytes(color=(9, 9, 9)))

    assert response.status_code == 422
    assert "full" in response.json()["detail"]
    assert len(_rows(session)) == 1

    usage = client.get("/api/notes/attachments/usage").json()
    assert usage == {"used_bytes": used, "limit_bytes": used + 10, "count": 1}


def test_storage_failure_is_503_and_leaves_nothing(
    session: Session, storage: InMemoryAttachmentStorage, monkeypatch
) -> None:
    path, _ = _project_path(session)
    put = storage.put

    def failing_put(key: str, data: bytes, content_type: str) -> None:
        if key.endswith("thumb.webp"):
            raise AttachmentStorageError("down")
        put(key, data, content_type)

    monkeypatch.setattr(storage, "put", failing_put)

    response = _upload(f"{path}/attachments")

    assert response.status_code == 503
    assert _rows(session) == []
    assert storage.objects == {}


# --- Signed URLs ------------------------------------------------------------


def test_urls_are_signed_for_the_owner(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]

    response = client.post(
        "/api/notes/attachments/urls", json={"ids": [attachment_id, str(uuid4())]}
    )

    assert response.status_code == 200
    body = response.json()
    (item,) = body["items"]
    assert item["id"] == attachment_id
    assert item["url"].startswith(f"https://storage.test/{storage.bucket}/{USER_A}/")
    assert item["url"].endswith("/preview.webp?expires_in=600")
    assert item["thumb_url"].endswith("/thumb.webp?expires_in=600")
    assert (item["width"], item["height"], item["caption"]) == (64, 48, "図1")
    expires_at = datetime.fromisoformat(body["expires_at"])
    assert (
        timedelta(minutes=9) < expires_at - datetime.now(UTC) <= timedelta(minutes=10)
    )


def test_another_user_gets_no_url_and_no_metadata(session: Session) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    _Caller.user_id = USER_B

    response = client.post("/api/notes/attachments/urls", json={"ids": [attachment_id]})

    assert response.status_code == 200
    assert response.json()["items"] == []
    assert client.get("/api/notes/attachments/usage").json()["count"] == 0


def test_urls_need_a_signed_in_user(session: Session) -> None:
    app.dependency_overrides.pop(get_current_user, None)

    response = client.post("/api/notes/attachments/urls", json={"ids": []})

    assert response.status_code in (401, 403)


def test_note_response_never_carries_a_url(session: Session) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    _save_note(path, _reference(attachment_id))

    body = client.get(path).json()

    assert body["content"] == _reference(attachment_id)
    assert "storage.test" not in str(body)


# --- Reference sync on note writes ------------------------------------------


def test_new_attachment_is_detached_until_the_note_refers_to_it(
    session: Session,
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    assert _rows(session)[0].detached_at is not None

    _save_note(path, f"<p>before</p>{_reference(attachment_id)}")

    assert _rows(session)[0].detached_at is None


def test_removing_the_reference_detaches_and_adding_it_back_attaches(
    session: Session,
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    _save_note(path, _reference(attachment_id))

    _save_note(path, "<p>image removed</p>")
    assert _rows(session)[0].detached_at is not None

    _save_note(path, _reference(attachment_id))
    assert _rows(session)[0].detached_at is None


def test_caption_follows_the_alt_text_in_the_note(session: Session) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments", caption=None).json()["id"]

    _save_note(path, _reference(attachment_id, "損失の  推移 &amp; 精度"))

    assert _rows(session)[0].caption == "損失の 推移 & 精度"


def test_saving_other_fields_keeps_attachments_as_they_are(session: Session) -> None:
    path, project_id = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    _save_note(path, _reference(attachment_id))
    note = session.exec(
        select(ContextNote).where(ContextNote.project_id == project_id)
    ).one()

    note.updated_at = datetime.now(UTC)
    session.add(note)
    session.commit()

    assert _rows(session)[0].detached_at is None


def test_reference_in_a_note_does_not_attach_another_notes_image(
    session: Session,
) -> None:
    first_path, _ = _project_path(session)
    second_path, _ = _project_path(session)
    attachment_id = _upload(f"{first_path}/attachments").json()["id"]
    other_id = _upload(f"{second_path}/attachments").json()["id"]

    _save_note(second_path, _reference(attachment_id) + _reference(other_id))

    rows = {str(row.id): row for row in _rows(session)}
    assert rows[attachment_id].detached_at is not None
    assert rows[other_id].detached_at is None


# --- Cleanup ----------------------------------------------------------------


def _sweep(session: Session, storage: InMemoryAttachmentStorage, days: int = 0) -> int:
    return attachment_service.sweep_attachments(
        session, storage, now=datetime.now(UTC) + timedelta(days=days)
    )


def test_sweep_keeps_attached_and_recently_detached_images(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attached = _upload(f"{path}/attachments", image_bytes(color=(1, 2, 3))).json()
    _save_note(path, _reference(attached["id"]))
    _upload(f"{path}/attachments", image_bytes(color=(9, 9, 9)))

    assert _sweep(session, storage, days=6) == 0
    assert len(_rows(session)) == 2
    assert len(storage.objects) == 4


def test_sweep_deletes_images_detached_past_the_grace_period(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attached = _upload(f"{path}/attachments", image_bytes(color=(1, 2, 3))).json()
    _save_note(path, _reference(attached["id"]))
    _upload(f"{path}/attachments", image_bytes(color=(9, 9, 9)))

    assert _sweep(session, storage, days=8) == 1

    (row,) = _rows(session)
    assert str(row.id) == attached["id"]
    assert set(storage.objects) == {row.object_key, row.thumb_object_key}


def test_sweep_deletes_the_images_of_a_deleted_note(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    _save_note(path, _reference(attachment_id))
    (row,) = _rows(session)
    note = session.get(ContextNote, row.note_id)
    # What ON DELETE SET NULL does on PostgreSQL when the note's row goes.
    row.note_id = None
    session.add(row)
    session.delete(note)
    session.commit()

    assert _sweep(session, storage) == 1

    assert _rows(session) == []
    assert storage.objects == {}


def test_sweep_moves_an_image_to_the_note_that_still_shows_it(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    first_path, _ = _project_path(session)
    second_path, second_project = _project_path(session)
    attachment_id = _upload(f"{first_path}/attachments").json()["id"]
    # Copied into another note, then removed from the first.
    _save_note(second_path, _reference(attachment_id))
    _save_note(first_path, "<p>moved</p>")

    assert _sweep(session, storage, days=30) == 0

    (row,) = _rows(session)
    second_note = session.exec(
        select(ContextNote).where(ContextNote.project_id == second_project)
    ).one()
    assert row.note_id == second_note.id
    assert row.detached_at is None
    assert len(storage.objects) == 2


def test_sweep_does_not_count_another_users_note_as_a_reference(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    other_project = seed_project(session, USER_B)
    other_note = seed_note(session, USER_B, project=other_project)
    other_note.content = _reference(attachment_id)
    other_note.content_type = "html"
    session.add(other_note)
    session.commit()

    assert _sweep(session, storage, days=8) == 1
    assert _rows(session) == []


def test_sweep_keeps_the_row_when_the_files_cannot_be_deleted(
    session: Session, storage: InMemoryAttachmentStorage, monkeypatch
) -> None:
    path, _ = _project_path(session)
    _upload(f"{path}/attachments")

    def failing_delete(keys: list[str]) -> None:
        raise AttachmentStorageError("down")

    monkeypatch.setattr(storage, "delete", failing_delete)

    assert _sweep(session, storage, days=8) == 0
    assert len(_rows(session)) == 1


async def test_daily_job_sweeps_with_the_configured_storage(
    session: Session, storage: InMemoryAttachmentStorage, monkeypatch
) -> None:
    path, _ = _project_path(session)
    _upload(f"{path}/attachments")
    (row,) = _rows(session)
    row.detached_at = datetime.now(UTC) - timedelta(days=8)
    session.add(row)
    session.commit()
    monkeypatch.setattr(
        notification_scheduler.db, "get_engine", lambda: session.get_bind()
    )
    monkeypatch.setattr(
        notification_scheduler, "get_attachment_storage", lambda: storage
    )

    await notification_scheduler.sweep_note_attachments()

    assert _rows(session) == []
    assert storage.objects == {}


def test_sweep_keeps_an_image_brought_back_after_it_was_listed(
    session: Session, storage: InMemoryAttachmentStorage, monkeypatch
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    (row,) = _rows(session)
    row.detached_at = datetime.now(UTC) - timedelta(days=8)
    session.add(row)
    session.commit()
    rollback = session.rollback
    saved = False

    def save_note_then_rollback() -> None:
        # The sweep has listed its candidates; before it gets to this one, the
        # user puts the image back in the note.
        nonlocal saved
        rollback()
        if not saved:
            saved = True
            _save_note(path, _reference(attachment_id))

    monkeypatch.setattr(session, "rollback", save_note_then_rollback)

    assert _sweep(session, storage) == 0

    monkeypatch.undo()
    (row,) = _rows(session)
    assert row.detached_at is None
    assert len(storage.objects) == 2


def _expire(session: Session) -> None:
    for row in _rows(session):
        row.detached_at = datetime.now(UTC) - timedelta(days=8)
        session.add(row)
    session.commit()


def test_sweep_keeps_an_image_a_weekly_note_shows(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    # Copied from the project note into a weekly note, then removed from the
    # project note.
    session.add(
        WeeklyNote(
            user_id=USER_A,
            week_start=datetime(2026, 11, 22).date(),
            content=f"<p>今週</p>{_reference(attachment_id)}",
        )
    )
    session.commit()
    _expire(session)

    assert _sweep(session, storage) == 0
    assert len(storage.objects) == 2

    weekly = session.exec(select(WeeklyNote)).one()
    weekly.content = "<p>今週</p>"
    session.add(weekly)
    session.commit()
    assert _sweep(session, storage, days=8) == 1
    assert storage.objects == {}


def test_sweep_does_not_keep_an_image_for_another_users_weekly_note(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    path, _ = _project_path(session)
    attachment_id = _upload(f"{path}/attachments").json()["id"]
    session.add(
        WeeklyNote(
            user_id=USER_B,
            week_start=datetime(2026, 11, 22).date(),
            content=_reference(attachment_id),
        )
    )
    session.commit()
    _expire(session)

    assert _sweep(session, storage) == 1


def test_sweep_finds_a_reference_written_in_upper_case(
    session: Session, storage: InMemoryAttachmentStorage
) -> None:
    first_path, _ = _project_path(session)
    second_path, _ = _project_path(session)
    attachment_id = _upload(f"{first_path}/attachments").json()["id"]
    _save_note(second_path, _reference(attachment_id.upper()))
    _expire(session)

    assert _sweep(session, storage) == 0
    assert _rows(session)[0].detached_at is None


def test_sweep_goes_on_past_images_it_cannot_delete(
    session: Session, storage: InMemoryAttachmentStorage, monkeypatch
) -> None:
    monkeypatch.setattr(attachment_service, "SWEEP_BATCH", 2)
    path, _ = _project_path(session)
    for color in ((200, 30, 30), (30, 200, 30), (30, 30, 200), (200, 200, 30)):
        assert (
            _upload(f"{path}/attachments", image_bytes(color=color)).status_code == 201
        )
    _expire(session)
    stuck = {
        row.object_key for row in sorted(_rows(session), key=lambda r: r.created_at)[:2]
    }
    delete = storage.delete

    def delete_unless_stuck(keys: list[str]) -> None:
        if stuck & set(keys):
            raise AttachmentStorageError("down")
        delete(keys)

    monkeypatch.setattr(storage, "delete", delete_unless_stuck)

    # The two oldest fill the first batch and fail; the newer two still go.
    assert _sweep(session, storage) == 2
    assert {row.object_key for row in _rows(session)} == stuck
