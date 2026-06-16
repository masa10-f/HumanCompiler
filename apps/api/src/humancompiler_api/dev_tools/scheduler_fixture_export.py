"""Export anonymized HumanCompiler data into Scheduler human fixture shape.

This module is intentionally not wired into FastAPI routes. It is a dev-only
bridge for reviewing real-ish scheduling data with the external Scheduler repo.
"""

from __future__ import annotations

import argparse
import json
import re
from collections.abc import Mapping, Sequence
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any
from uuid import UUID

from sqlmodel import Session, select

from humancompiler_api.models import (
    Goal,
    Log,
    Project,
    QuickTask,
    Task,
    TaskDependency,
    TaskStatus,
)

Fixture = dict[str, Any]


def export_anonymized_scheduler_fixture(
    session: Session,
    *,
    user_id: str | UUID,
    target_date: str | date,
    time_slots: Sequence[Mapping[str, Any]],
    fixed_assignments: Sequence[Mapping[str, Any]] | None = None,
    include_quick_tasks: bool = True,
    metadata_name: str = "humancompiler_anonymous_export",
) -> Fixture:
    """Query a user's active tasks and build an anonymized Scheduler fixture."""

    user_uuid = _coerce_uuid(user_id)
    projects = session.exec(select(Project).where(Project.owner_id == user_uuid)).all()
    project_ids = [project.id for project in projects if project.id is not None]

    goals: list[Goal] = []
    if project_ids:
        goals = session.exec(select(Goal).where(Goal.project_id.in_(project_ids))).all()
    goal_ids = [goal.id for goal in goals if goal.id is not None]

    tasks: list[Task] = []
    if goal_ids:
        tasks = session.exec(select(Task).where(Task.goal_id.in_(goal_ids))).all()
    tasks = [task for task in tasks if _is_schedulable_status(task.status)]
    task_ids = [task.id for task in tasks if task.id is not None]

    quick_tasks: list[QuickTask] = []
    if include_quick_tasks:
        quick_tasks = session.exec(
            select(QuickTask).where(QuickTask.owner_id == user_uuid)
        ).all()
        quick_tasks = [
            quick_task
            for quick_task in quick_tasks
            if _is_schedulable_status(quick_task.status)
        ]

    logs: list[Log] = []
    task_dependencies: list[TaskDependency] = []
    if task_ids:
        logs = session.exec(select(Log).where(Log.task_id.in_(task_ids))).all()
        task_dependencies = session.exec(
            select(TaskDependency).where(TaskDependency.task_id.in_(task_ids))
        ).all()

    return build_anonymized_scheduler_fixture(
        target_date=target_date,
        tasks=tasks,
        quick_tasks=quick_tasks,
        goals=goals,
        projects=projects,
        logs=logs,
        task_dependencies=task_dependencies,
        time_slots=time_slots,
        fixed_assignments=fixed_assignments or [],
        metadata_name=metadata_name,
    )


def build_anonymized_scheduler_fixture(
    *,
    target_date: str | date,
    tasks: Sequence[Any],
    quick_tasks: Sequence[Any] = (),
    goals: Sequence[Any] = (),
    projects: Sequence[Any] = (),
    logs: Sequence[Any] = (),
    task_dependencies: Sequence[Any] = (),
    time_slots: Sequence[Mapping[str, Any]],
    fixed_assignments: Sequence[Mapping[str, Any]] = (),
    metadata_name: str = "humancompiler_anonymous_export",
) -> Fixture:
    """Build an anonymized fixture dict from model-like objects.

    The returned shape matches ``scheduler.human`` YAML fixtures. Titles,
    descriptions, memos, and raw IDs are deliberately omitted.
    """

    project_aliases = _build_aliases(projects, "project")
    goal_aliases = _build_aliases(goals, "goal")
    task_aliases = _build_aliases(tasks, "task")
    quick_task_aliases = _build_aliases(quick_tasks, "quick")
    actual_minutes_by_task_id = _actual_minutes_by_task_id(logs)
    goals_by_id = {_object_id(goal): goal for goal in goals}

    fixture_tasks = []
    for index, task in enumerate(sorted(tasks, key=_object_id), start=1):
        task_id = _object_id(task)
        goal_id = _object_id(getattr(task, "goal_id", None))
        goal = goals_by_id.get(goal_id)
        project_id = _object_id(getattr(goal, "project_id", None)) if goal else ""
        remaining_minutes = _remaining_minutes(
            getattr(task, "estimate_hours", 0),
            actual_minutes_by_task_id.get(task_id, 0),
        )
        fixture_tasks.append(
            _without_none(
                {
                    "id": task_aliases[task_id],
                    "title": f"Task {index:03d}",
                    "remaining_minutes": remaining_minutes,
                    "priority": int(getattr(task, "priority", 3)),
                    "work_kind": _enum_value(
                        getattr(task, "work_type", None), "light_work"
                    ),
                    "due_at": _datetime_or_none(getattr(task, "due_date", None)),
                    "project_id": project_aliases.get(project_id),
                    "goal_id": goal_aliases.get(goal_id),
                    "source": "task",
                }
            )
        )

    for index, quick_task in enumerate(
        sorted(quick_tasks, key=_object_id),
        start=1,
    ):
        quick_task_id = _object_id(quick_task)
        fixture_tasks.append(
            _without_none(
                {
                    "id": quick_task_aliases[quick_task_id],
                    "title": f"Quick Task {index:03d}",
                    "remaining_minutes": _estimate_minutes(
                        getattr(quick_task, "estimate_hours", 0)
                    ),
                    "priority": int(getattr(quick_task, "priority", 3)),
                    "work_kind": _enum_value(
                        getattr(quick_task, "work_type", None), "light_work"
                    ),
                    "due_at": _datetime_or_none(getattr(quick_task, "due_date", None)),
                    "source": "quick_task",
                }
            )
        )

    return _without_none(
        {
            "date": target_date.isoformat()
            if isinstance(target_date, date)
            else str(target_date),
            "metadata": {
                "name": metadata_name,
                "anonymized": True,
                "source": "humancompiler_dev_export",
            },
            "time_slots": [
                _anonymized_time_slot(slot, project_aliases) for slot in time_slots
            ],
            "fixed_assignments": [
                fixed_assignment
                for fixed_assignment in (
                    _anonymized_fixed_assignment(
                        item,
                        task_aliases=task_aliases,
                        quick_task_aliases=quick_task_aliases,
                    )
                    for item in fixed_assignments
                )
                if fixed_assignment is not None
            ],
            "tasks": fixture_tasks,
            "task_dependencies": _anonymized_task_dependencies(
                task_dependencies,
                task_aliases,
            ),
        }
    )


def dump_fixture_yaml(fixture: Mapping[str, Any]) -> str:
    """Serialize a fixture dict as dependency-free YAML."""

    return _dump_yaml_value(fixture).rstrip() + "\n"


def _anonymized_time_slot(
    slot: Mapping[str, Any],
    project_aliases: Mapping[str, str],
) -> dict[str, Any]:
    capacity_minutes = slot.get("capacity_minutes")
    if capacity_minutes is None and slot.get("capacity_hours") is not None:
        capacity_minutes = int(round(float(slot["capacity_hours"]) * 60))

    assigned_project_id = slot.get("assigned_project_id")
    if assigned_project_id is not None:
        assigned_project_id = project_aliases.get(str(assigned_project_id))

    return _without_none(
        {
            "index": slot.get("index"),
            "start": slot["start"],
            "end": slot["end"],
            "work_kind": slot.get("work_kind", slot.get("kind", "light_work")),
            "capacity_minutes": capacity_minutes,
            "assigned_project_id": assigned_project_id,
        }
    )


def _anonymized_fixed_assignment(
    assignment: Mapping[str, Any],
    *,
    task_aliases: Mapping[str, str],
    quick_task_aliases: Mapping[str, str],
) -> dict[str, Any] | None:
    task_id = str(assignment["task_id"])
    anonymized_task_id = task_aliases.get(task_id)
    if anonymized_task_id is None and task_id.startswith("quick_"):
        anonymized_task_id = quick_task_aliases.get(task_id.removeprefix("quick_"))
    if anonymized_task_id is None:
        return None

    duration_minutes = assignment.get("duration_minutes")
    if duration_minutes is None and assignment.get("duration_hours") is not None:
        duration_minutes = int(round(float(assignment["duration_hours"]) * 60))

    return _without_none(
        {
            "task_id": anonymized_task_id,
            "slot_index": int(assignment["slot_index"]),
            "duration_minutes": duration_minutes,
        }
    )


def _anonymized_task_dependencies(
    task_dependencies: Sequence[Any],
    task_aliases: Mapping[str, str],
) -> dict[str, list[str]]:
    dependencies: dict[str, list[str]] = {}
    for dependency in task_dependencies:
        task_id = _object_id(getattr(dependency, "task_id", None))
        depends_on_task_id = _object_id(getattr(dependency, "depends_on_task_id", None))
        if task_id not in task_aliases or depends_on_task_id not in task_aliases:
            continue
        dependencies.setdefault(task_aliases[task_id], []).append(
            task_aliases[depends_on_task_id]
        )
    return dependencies


def _actual_minutes_by_task_id(logs: Sequence[Any]) -> dict[str, int]:
    totals: dict[str, int] = {}
    for log in logs:
        task_id = _object_id(getattr(log, "task_id", None))
        totals[task_id] = totals.get(task_id, 0) + int(
            getattr(log, "actual_minutes", 0)
        )
    return totals


def _remaining_minutes(estimate_hours: Any, actual_minutes: int) -> int:
    return max(0, _estimate_minutes(estimate_hours) - actual_minutes)


def _estimate_minutes(estimate_hours: Any) -> int:
    if estimate_hours is None:
        return 0
    if isinstance(estimate_hours, Decimal):
        return int(round(float(estimate_hours) * 60))
    return int(round(float(estimate_hours) * 60))


def _build_aliases(items: Sequence[Any], prefix: str) -> dict[str, str]:
    return {
        _object_id(item): f"{prefix}_{index:03d}"
        for index, item in enumerate(sorted(items, key=_object_id), start=1)
    }


def _object_id(item: Any) -> str:
    if item is None:
        return ""
    if hasattr(item, "id"):
        return str(item.id)
    return str(item)


def _enum_value(value: Any, default: str) -> str:
    if value is None:
        return default
    return str(getattr(value, "value", value))


def _datetime_or_none(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _is_schedulable_status(status: Any) -> bool:
    return _enum_value(status, "").lower() not in {
        TaskStatus.COMPLETED.value,
        TaskStatus.CANCELLED.value,
    }


def _without_none(value: Mapping[str, Any]) -> dict[str, Any]:
    return {key: item for key, item in value.items() if item is not None}


def _coerce_uuid(value: str | UUID) -> UUID:
    return value if isinstance(value, UUID) else UUID(str(value))


def _dump_yaml_value(value: Any, indent: int = 0) -> str:
    pad = " " * indent
    if isinstance(value, Mapping):
        if not value:
            return "{}\n"
        lines = []
        for key, item in value.items():
            if _is_scalar(item):
                lines.append(f"{pad}{key}: {_dump_yaml_scalar(item)}")
            else:
                lines.append(f"{pad}{key}:")
                lines.append(_dump_yaml_value(item, indent + 2).rstrip())
        return "\n".join(lines) + "\n"
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        if not value:
            return "[]\n"
        lines = []
        for item in value:
            if _is_scalar(item):
                lines.append(f"{pad}- {_dump_yaml_scalar(item)}")
            elif isinstance(item, Mapping) and item:
                first_key, first_value = next(iter(item.items()))
                if _is_scalar(first_value):
                    lines.append(
                        f"{pad}- {first_key}: {_dump_yaml_scalar(first_value)}"
                    )
                    rest = dict(list(item.items())[1:])
                    if rest:
                        lines.append(_dump_yaml_value(rest, indent + 2).rstrip())
                else:
                    lines.append(f"{pad}- {first_key}:")
                    lines.append(_dump_yaml_value(first_value, indent + 4).rstrip())
                    rest = dict(list(item.items())[1:])
                    if rest:
                        lines.append(_dump_yaml_value(rest, indent + 2).rstrip())
            else:
                lines.append(f"{pad}-")
                lines.append(_dump_yaml_value(item, indent + 2).rstrip())
        return "\n".join(lines) + "\n"
    return f"{pad}{_dump_yaml_scalar(value)}\n"


def _is_scalar(value: Any) -> bool:
    if value is None or isinstance(value, str | int | float | bool):
        return True
    if isinstance(value, Mapping) and not value:
        return True
    return bool(
        isinstance(value, Sequence)
        and not isinstance(value, str | bytes | bytearray)
        and not value
    )


def _dump_yaml_scalar(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, Mapping):
        return "{}"
    if isinstance(value, Sequence) and not isinstance(value, str | bytes | bytearray):
        return "[]"
    return json.dumps(str(value), ensure_ascii=False)


def _parse_slot_arg(raw: str) -> dict[str, Any]:
    match = re.fullmatch(
        r"(?P<start>\d{1,2}:\d{2})-(?P<end>\d{1,2}:\d{2}):"
        r"(?P<work_kind>[^:]+)(?::(?P<capacity_hours>\d+(?:\.\d+)?))?",
        raw,
    )
    if match is None:
        raise argparse.ArgumentTypeError(
            "slots must use START-END:WORK_KIND or START-END:WORK_KIND:CAPACITY_HOURS"
        )
    slot: dict[str, Any] = {
        "start": match.group("start"),
        "end": match.group("end"),
        "work_kind": match.group("work_kind"),
    }
    if match.group("capacity_hours") is not None:
        slot["capacity_hours"] = float(match.group("capacity_hours"))
    return slot


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Export anonymized HumanCompiler tasks as a Scheduler fixture."
    )
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--date", required=True, dest="target_date")
    parser.add_argument(
        "--slot",
        action="append",
        type=_parse_slot_arg,
        required=True,
        help="START-END:WORK_KIND or START-END:WORK_KIND:CAPACITY_HOURS",
    )
    parser.add_argument("--output", type=Path)
    parser.add_argument("--metadata-name", default="humancompiler_anonymous_export")
    parser.add_argument(
        "--no-quick-tasks",
        action="store_true",
        help="Exclude active quick tasks from the exported fixture.",
    )
    args = parser.parse_args(argv)

    from humancompiler_api.database import db

    with Session(db.get_engine()) as session:
        fixture = export_anonymized_scheduler_fixture(
            session,
            user_id=args.user_id,
            target_date=args.target_date,
            time_slots=args.slot,
            include_quick_tasks=not args.no_quick_tasks,
            metadata_name=args.metadata_name,
        )

    output = dump_fixture_yaml(fixture)
    if args.output:
        args.output.write_text(output, encoding="utf-8")
    else:
        print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
