from datetime import datetime
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

from humancompiler_api.dev_tools.scheduler_fixture_export import (
    _parse_slot_arg,
    build_anonymized_scheduler_fixture,
    dump_fixture_yaml,
)
from humancompiler_api.models import TaskStatus, WorkType


def test_build_anonymized_fixture_preserves_scheduler_fields_without_titles():
    project_id = uuid4()
    goal_id = uuid4()
    prereq_id = uuid4()
    task_id = uuid4()
    quick_task_id = uuid4()

    project = SimpleNamespace(id=project_id)
    goal = SimpleNamespace(id=goal_id, project_id=project_id)
    prereq = SimpleNamespace(
        id=prereq_id,
        title="Sensitive prerequisite",
        estimate_hours=Decimal("1.00"),
        priority=5,
        work_type=WorkType.LIGHT_WORK,
        due_date=None,
        goal_id=goal_id,
        status=TaskStatus.PENDING,
    )
    task = SimpleNamespace(
        id=task_id,
        title="Sensitive focused task",
        estimate_hours=Decimal("4.00"),
        priority=1,
        work_type=WorkType.FOCUSED_WORK,
        due_date=datetime(2026, 5, 20, 17, 0),
        goal_id=goal_id,
        status=TaskStatus.IN_PROGRESS,
    )
    quick_task = SimpleNamespace(
        id=quick_task_id,
        title="Sensitive quick task",
        estimate_hours=Decimal("0.50"),
        priority=2,
        work_type=WorkType.STUDY,
        due_date=datetime(2026, 5, 21, 9, 0),
        status=TaskStatus.PENDING,
    )
    log = SimpleNamespace(task_id=task_id, actual_minutes=150)
    dependency = SimpleNamespace(task_id=task_id, depends_on_task_id=prereq_id)

    fixture = build_anonymized_scheduler_fixture(
        target_date="2026-05-20",
        projects=[project],
        goals=[goal],
        tasks=[task, prereq],
        quick_tasks=[quick_task],
        logs=[log],
        task_dependencies=[dependency],
        time_slots=[
            {
                "start": "09:00",
                "end": "12:00",
                "kind": "focused_work",
                "capacity_hours": 2.5,
                "assigned_project_id": str(project_id),
            }
        ],
        fixed_assignments=[
            {
                "task_id": f"quick_{quick_task_id}",
                "slot_index": 0,
                "duration_hours": 0.5,
            }
        ],
    )

    tasks_by_source = {item["source"]: item for item in fixture["tasks"]}
    regular_tasks = [item for item in fixture["tasks"] if item["source"] == "task"]
    focused_task = next(item for item in regular_tasks if item["priority"] == 1)
    quick_fixture_task = tasks_by_source["quick_task"]

    assert focused_task["remaining_minutes"] == 90
    assert focused_task["work_kind"] == "focused_work"
    assert focused_task["due_at"] == "2026-05-20T17:00:00"
    assert focused_task["project_id"] == "project_001"
    assert focused_task["goal_id"] == "goal_001"
    assert focused_task["title"].startswith("Task ")
    assert "Sensitive" not in dump_fixture_yaml(fixture)

    assert quick_fixture_task["id"].startswith("quick_")
    assert quick_fixture_task["priority"] == 2
    assert quick_fixture_task["remaining_minutes"] == 30
    assert fixture["fixed_assignments"] == [
        {"task_id": quick_fixture_task["id"], "slot_index": 0, "duration_minutes": 30}
    ]
    assert fixture["time_slots"][0]["capacity_minutes"] == 150
    assert fixture["time_slots"][0]["assigned_project_id"] == "project_001"
    prereq_fixture_task = next(item for item in regular_tasks if item["priority"] == 5)
    assert fixture["task_dependencies"] == {
        focused_task["id"]: [prereq_fixture_task["id"]]
    }


def test_dump_fixture_yaml_outputs_scheduler_readable_shape():
    fixture = {
        "date": "2026-05-20",
        "metadata": {"name": "test", "anonymized": True},
        "time_slots": [{"start": "09:00", "end": "10:00", "work_kind": "study"}],
        "tasks": [{"id": "task_001", "title": "Task 001", "remaining_minutes": 30}],
        "task_dependencies": {},
    }

    output = dump_fixture_yaml(fixture)

    assert 'date: "2026-05-20"' in output
    assert "anonymized: true" in output
    assert '- start: "09:00"' in output
    assert 'id: "task_001"' in output
    assert "task_dependencies: {}" in output


def test_parse_slot_arg_handles_time_colons_and_capacity():
    slot = _parse_slot_arg("09:00-12:30:focused_work:2.5")

    assert slot == {
        "start": "09:00",
        "end": "12:30",
        "work_kind": "focused_work",
        "capacity_hours": 2.5,
    }
