from datetime import UTC, datetime, timedelta
from decimal import Decimal
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlmodel import Session

from humancompiler_api.auth import get_current_user_id
from humancompiler_api.main import app
from humancompiler_api.models import Goal, Project, Task, TaskStatus, User, WorkType
from humancompiler_api.routers.triage import get_session as get_triage_session


client = TestClient(app)


def seed_router_data(session: Session):
    user = User(id=uuid4(), email="triage-router@example.com")
    project = Project(id=uuid4(), owner_id=user.id, title="Router Project")
    goal = Goal(
        id=uuid4(),
        project_id=project.id,
        title="Router Goal",
        estimate_hours=Decimal("10.00"),
    )
    task = Task(
        id=uuid4(),
        goal_id=goal.id,
        title="Router Task",
        estimate_hours=Decimal("4.00"),
        due_date=datetime.now(UTC) + timedelta(days=2),
        status=TaskStatus.PENDING,
        work_type=WorkType.FOCUSED_WORK,
        priority=5,
    )
    session.add(user)
    session.add(project)
    session.add(goal)
    session.add(task)
    session.commit()
    return user, project, task


def install_overrides(session: Session, user_id):
    def override_session():
        yield session

    def override_user_id():
        return user_id

    app.dependency_overrides[get_triage_session] = override_session
    app.dependency_overrides[get_current_user_id] = override_user_id


def clear_overrides():
    app.dependency_overrides.pop(get_triage_session, None)
    app.dependency_overrides.pop(get_current_user_id, None)


def test_triage_settings_and_run_endpoints(session: Session):
    user, project, _task = seed_router_data(session)
    install_overrides(session, user.id)

    try:
        settings_response = client.put(
            "/api/triage/settings",
            json={
                "weekly_capacity_hours": 2,
                "meeting_buffer_hours": 0,
                "project_allocations": {str(project.id): 100},
                "inbox_allocation_percent": 0,
                "work_type_caps": {},
                "cadence_days": 7,
                "auto_generate_enabled": False,
                "use_ai_rank_adjustment": False,
            },
        )
        assert settings_response.status_code == 200
        assert settings_response.json()["project_allocations"][str(project.id)] == 100

        run_response = client.post("/api/triage/runs", json={})
        assert run_response.status_code == 200
        run_json = run_response.json()
        assert run_json["summary"]["cancel_candidate_items"] == 1

        latest_response = client.get("/api/triage/runs/latest")
        assert latest_response.status_code == 200
        assert latest_response.json()["id"] == run_json["id"]
    finally:
        clear_overrides()


def test_triage_run_endpoint_accepts_missing_body(session: Session):
    user, project, _task = seed_router_data(session)
    install_overrides(session, user.id)

    try:
        settings_response = client.put(
            "/api/triage/settings",
            json={
                "weekly_capacity_hours": 2,
                "meeting_buffer_hours": 0,
                "project_allocations": {str(project.id): 100},
                "inbox_allocation_percent": 0,
                "work_type_caps": {},
                "cadence_days": 7,
                "auto_generate_enabled": False,
                "use_ai_rank_adjustment": False,
            },
        )
        assert settings_response.status_code == 200

        run_response = client.post("/api/triage/runs")

        assert run_response.status_code == 200
        run_json = run_response.json()
        assert run_json["source"] == "manual"
        assert run_json["summary"]["total_items"] == 1
    finally:
        clear_overrides()


def test_triage_apply_endpoint_cancels_task(session: Session):
    user, project, task = seed_router_data(session)
    install_overrides(session, user.id)

    try:
        client.put(
            "/api/triage/settings",
            json={
                "weekly_capacity_hours": 2,
                "meeting_buffer_hours": 0,
                "project_allocations": {str(project.id): 100},
                "inbox_allocation_percent": 0,
                "work_type_caps": {},
                "cadence_days": 7,
                "auto_generate_enabled": False,
                "use_ai_rank_adjustment": False,
            },
        )
        run_json = client.post("/api/triage/runs", json={}).json()
        cancel_item_ids = [
            item["id"]
            for item in run_json["items"]
            if item["recommendation"] == "cancel"
        ]

        apply_response = client.post(
            f"/api/triage/runs/{run_json['id']}/apply",
            json={"item_ids": cancel_item_ids},
        )

        session.refresh(task)
        assert apply_response.status_code == 200
        assert apply_response.json()["applied_count"] == 1
        assert task.status == TaskStatus.CANCELLED
    finally:
        clear_overrides()
