# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"""Note attachments on PostgreSQL, where foreign keys and row locks are real.

SQLite, which the other attachment tests use, does not enforce the foreign keys
(so a deleted note leaves ``note_id`` set) and ignores ``FOR UPDATE``."""

from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
import os
from uuid import UUID, uuid4

import pytest
from sqlalchemy import Engine, text
from sqlmodel import Session, SQLModel, create_engine, select

from humancompiler_api import attachment_service
from humancompiler_api.attachment_storage import InMemoryAttachmentStorage
from humancompiler_api.models import (
    ContextNote,
    ContextNoteUpdate,
    NoteAttachment,
    Project,
    User,
)
from humancompiler_api.proposal_payloads import NoteTarget
from humancompiler_api.routers import notes
from tests.attachment_helpers import image_bytes

pytestmark = pytest.mark.skipif(
    not os.environ.get("NOTEBOOK_TEST_POSTGRES_URL"), reason="requires test PostgreSQL"
)


@pytest.fixture
def engine() -> Iterator[Engine]:
    # No production table is touched, even when running against an existing database.
    url = os.environ["NOTEBOOK_TEST_POSTGRES_URL"]
    schema = f"note_attachments_orm_test_{uuid4().hex}"
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    scoped = create_engine(url, connect_args={"options": f"-csearch_path={schema}"})
    try:
        SQLModel.metadata.create_all(scoped)
        yield scoped
    finally:
        scoped.dispose()
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


def _project(engine: Engine) -> tuple[UUID, UUID]:
    user_id, project_id = uuid4(), uuid4()
    with Session(engine) as session:
        session.add(User(id=user_id, email=f"{user_id}@example.com"))
        session.flush()
        session.add(Project(id=project_id, owner_id=user_id, title="Project"))
        session.commit()
    return user_id, project_id


def _attach(
    engine: Engine,
    storage: InMemoryAttachmentStorage,
    user_id: UUID,
    project_id: UUID,
    color: tuple[int, int, int] = (200, 30, 30),
) -> UUID:
    with Session(engine) as session:
        attachment, _ = attachment_service.create_attachment(
            session,
            storage,
            user_id,
            NoteTarget(project_id=project_id),
            image_bytes(color=color),
            "図1",
            None,
            require_caption=True,
        )
        assert attachment.id is not None
        return attachment.id


def _save(engine: Engine, user_id: UUID, project_id: UUID, content: str) -> None:
    with Session(engine) as session:
        notes.update_note(
            session,
            str(user_id),
            NoteTarget(project_id=project_id),
            ContextNoteUpdate(content=content, content_type="html"),
        )


def _rows(engine: Engine) -> list[NoteAttachment]:
    with Session(engine) as session:
        return list(session.exec(select(NoteAttachment)).all())


def test_upload_reference_and_removal(engine: Engine) -> None:
    storage = InMemoryAttachmentStorage()
    user_id, project_id = _project(engine)

    attachment_id = _attach(engine, storage, user_id, project_id)
    assert _rows(engine)[0].detached_at is not None

    _save(
        engine,
        user_id,
        project_id,
        f'<img data-attachment-id="{attachment_id}" alt="新しい説明">',
    )
    (row,) = _rows(engine)
    assert row.detached_at is None
    assert row.caption == "新しい説明"

    _save(engine, user_id, project_id, "<p>removed</p>")
    (row,) = _rows(engine)
    assert row.detached_at is not None

    with Session(engine) as session:
        assert attachment_service.sweep_attachments(session, storage) == 0
        late = datetime.now(UTC) + timedelta(days=8)
        assert attachment_service.sweep_attachments(session, storage, late) == 1
    assert _rows(engine) == []
    assert storage.objects == {}


def test_deleting_the_project_leaves_the_files_to_the_sweep(engine: Engine) -> None:
    storage = InMemoryAttachmentStorage()
    user_id, project_id = _project(engine)
    kept_user, kept_project = _project(engine)
    attachment_id = _attach(engine, storage, user_id, project_id)
    kept_id = _attach(engine, storage, kept_user, kept_project)
    _save(
        engine,
        user_id,
        project_id,
        f'<img data-attachment-id="{attachment_id}" alt="図1">',
    )
    _save(
        engine,
        kept_user,
        kept_project,
        f'<img data-attachment-id="{kept_id}" alt="図1">',
    )

    with engine.begin() as connection:
        connection.execute(
            text("DELETE FROM projects WHERE id = :id"), {"id": project_id}
        )

    rows = {row.id: row for row in _rows(engine)}
    # The note went with the project; the row stays so the files can be found.
    assert rows[attachment_id].note_id is None
    assert len(storage.objects) == 4

    with Session(engine) as session:
        assert len(session.exec(select(ContextNote)).all()) == 1
        assert attachment_service.sweep_attachments(session, storage) == 1

    (row,) = _rows(engine)
    assert row.id == kept_id
    assert set(storage.objects) == {row.object_key, row.thumb_object_key}


def test_same_image_twice_and_usage(engine: Engine) -> None:
    storage = InMemoryAttachmentStorage()
    user_id, project_id = _project(engine)

    first = _attach(engine, storage, user_id, project_id)
    second = _attach(engine, storage, user_id, project_id)
    _attach(engine, storage, user_id, project_id, color=(1, 2, 3))

    assert first == second
    rows = _rows(engine)
    assert len(rows) == 2
    with Session(engine) as session:
        usage = attachment_service.attachment_usage(session, user_id)
        urls = attachment_service.signed_urls(
            session, storage, user_id, [first, uuid4()]
        )
        assert (
            attachment_service.signed_urls(session, storage, uuid4(), [first]).items
            == []
        )
    assert usage.count == 2
    assert usage.used_bytes == sum(r.byte_size + r.thumb_byte_size for r in rows)
    assert [item.id for item in urls.items] == [first]
