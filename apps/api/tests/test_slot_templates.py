"""Tests for slot template slot kind validation."""

from uuid import uuid4

import pytest
from pydantic import ValidationError
from sqlalchemy.pool import StaticPool
from sqlmodel import Session, SQLModel, create_engine

from humancompiler_api.models import (
    SlotKind,
    SlotTemplateCreate,
    SlotTemplateResponse,
    SlotTemplateUpdate,
    TimeSlotSchema,
    User,
)
from humancompiler_api.services import slot_template_service


@pytest.fixture
def test_session():
    """Create test database session."""
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    SQLModel.metadata.create_all(engine)

    try:
        with Session(engine) as session:
            yield session
    finally:
        engine.dispose()


@pytest.fixture
def test_user(test_session):
    """Create test user."""
    user = User(id=uuid4(), email="slot-template-test@example.com")
    test_session.add(user)
    test_session.commit()
    test_session.refresh(user)
    return user


def test_time_slot_schema_accepts_all_slot_kinds():
    """TimeSlotSchema accepts every API slot kind."""
    for kind in SlotKind:
        slot = TimeSlotSchema(start="09:00", end="10:00", kind=kind)
        assert slot.kind == kind


@pytest.mark.parametrize(
    ("start", "end", "kind"),
    [
        ("25:00", "26:00", "focused_work"),
        ("10:00", "09:00", "focused_work"),
        ("09:00", "10:00", "invalid_kind"),
    ],
)
def test_time_slot_schema_rejects_invalid_values(start, end, kind):
    """TimeSlotSchema rejects invalid times, ranges, and slot kinds."""
    with pytest.raises(ValidationError):
        TimeSlotSchema(start=start, end=end, kind=kind)


def test_slot_template_create_stores_slot_kind_as_json_string(test_session, test_user):
    """Slot template creation stores enum values as plain JSON strings."""
    template = slot_template_service.create_slot_template(
        test_session,
        SlotTemplateCreate(
            name="Meeting template",
            day_of_week=0,
            slots=[TimeSlotSchema(start="12:00", end="13:00", kind=SlotKind.MEETING)],
        ),
        test_user.id,
    )

    assert template.slots_json == [
        {
            "start": "12:00",
            "end": "13:00",
            "kind": "meeting",
            "capacity_hours": None,
            "assigned_project_id": None,
        }
    ]

    response = SlotTemplateResponse.from_db_model(template)
    assert response.slots[0].kind == SlotKind.MEETING


def test_slot_template_update_stores_slot_kind_as_json_string(test_session, test_user):
    """Slot template updates also keep the stored JSON wire format stable."""
    template = slot_template_service.create_slot_template(
        test_session,
        SlotTemplateCreate(
            name="Work template",
            day_of_week=1,
            slots=[
                TimeSlotSchema(
                    start="09:00",
                    end="10:00",
                    kind=SlotKind.FOCUSED_WORK,
                )
            ],
        ),
        test_user.id,
    )

    updated = slot_template_service.update_slot_template(
        test_session,
        template.id,
        test_user.id,
        SlotTemplateUpdate(
            slots=[TimeSlotSchema(start="11:00", end="12:00", kind="meeting")]
        ),
    )

    assert updated.slots_json[0]["kind"] == "meeting"
    assert not isinstance(updated.slots_json[0]["kind"], SlotKind)
