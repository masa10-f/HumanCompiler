# Scheduler Phase 1 Payload Notes

Phase 1 originally kept HumanCompiler runtime behavior unchanged. HumanCompiler
now uses the PyPI package `humancompiler-scheduler` for daily scheduling while
preserving the public API response shape. This document records the payload that
HumanCompiler sends today and the equivalent Scheduler Human daily fixture
shape.

## Current Daily Schedule Request

`POST /api/schedule/daily` keeps the existing request shape:

```json
{
  "date": "2026-05-20",
  "task_source": {
    "type": "all_tasks"
  },
  "time_slots": [
    {
      "start": "09:00",
      "end": "12:00",
      "kind": "focused_work",
      "capacity_hours": 2.5
    },
    {
      "start": "13:00",
      "end": "16:00",
      "kind": "study",
      "capacity_hours": 2.5
    },
    {
      "start": "16:30",
      "end": "18:00",
      "kind": "light_work"
    }
  ],
  "preferences": {},
  "solver_config": {
    "kind_match_score": 8,
    "project_switch_penalty": 4
  },
  "fixed_assignments": [
    {
      "task_id": "task-standup-notes",
      "slot_index": 1,
      "duration_hours": 0.5
    }
  ]
}
```

The API adapter expands this request with database task data before calling the
current optimizer. Regular tasks and quick tasks are both converted to
`SchedulerTask`; quick task IDs are prefixed with `quick_`.

## Equivalent External Scheduler Fixture

The same scheduling intent can be represented in the external Scheduler repo as
an editable YAML fixture:

```yaml
date: "2026-05-20"
metadata:
  name: humancompiler_payload_sample

time_slots:
  - index: 0
    start: "09:00"
    end: "12:00"
    work_kind: focused_work
    capacity_minutes: 150
  - index: 1
    start: "13:00"
    end: "16:00"
    work_kind: study
    capacity_minutes: 150
  - index: 2
    start: "16:30"
    end: "18:00"
    work_kind: light_work

fixed_assignments:
  - task_id: task-standup-notes
    slot_index: 1
    duration_minutes: 30

tasks:
  - id: task-proposal
    title: Draft product proposal
    remaining_minutes: 90
    priority: 1
    work_kind: focused_work
    due_at: "2026-05-22T17:00:00"
    project_id: project-alpha
    goal_id: goal-launch
    source: task
  - id: quick-inbox
    title: Clear inbox and small replies
    remaining_minutes: 30
    priority: 4
    work_kind: light_work
    source: quick_task

task_dependencies:
  task-proposal:
    - task-research
```

## Input Mapping

| HumanCompiler field | External Scheduler fixture field | Notes |
| --- | --- | --- |
| `DailyScheduleRequest.date` | `date` | Same calendar day. |
| `time_slots[].start` / `end` | `time_slots[].start` / `end` | Same `HH:MM` strings. |
| `time_slots[].kind` | `time_slots[].work_kind` | Values map directly: `light_work`, `focused_work`, `study`. |
| `time_slots[].capacity_hours` | `time_slots[].capacity_minutes` | Convert hours to minutes. If omitted, slot duration is used. |
| `time_slots[].assigned_project_id` | `time_slots[].assigned_project_id` | Project-specific slot constraint. |
| `fixed_assignments[].task_id` | `fixed_assignments[].task_id` | Same task identifier after quick task prefixing. |
| `fixed_assignments[].slot_index` | `fixed_assignments[].slot_index` | Same zero-based slot index. |
| `fixed_assignments[].duration_hours` | `fixed_assignments[].duration_minutes` | Convert hours to minutes. |
| regular `Task.id` | `tasks[].id` | UUID string from HumanCompiler. |
| quick task ID | `tasks[].id` | Prefix with `quick_`, matching current API adapter behavior. |
| task title | `tasks[].title` | Safe to anonymize for exported fixtures later. |
| estimate minus actual logged hours | `tasks[].remaining_minutes` | Current API already computes remaining hours for regular tasks. |
| `Task.priority` / `QuickTask.priority` | `tasks[].priority` | Quick task priority is already passed. Regular task priority is still a known gap in the current adapter. |
| `work_type` | `tasks[].work_kind` | Falls back to title-based kind inference only when regular tasks lack `work_type`. |
| `due_date` | `tasks[].due_at` | Use ISO datetime when present. |
| task goal | `tasks[].goal_id` | Regular tasks only. |
| goal project | `tasks[].project_id` | Derived from the task goal for regular tasks. |
| task dependencies | `task_dependencies` | Map dependent task ID to prerequisite task IDs. |

## Output Mapping

| Current API response field | External Scheduler result field | Notes |
| --- | --- | --- |
| `success` | report status | HumanCompiler should continue returning the current boolean when integrated later. |
| `date` | fixture `date` | Same requested date. |
| `assignments[].task_id` | `plan.blocks[].task_id` | Same task ID. |
| `assignments[].slot_index` | `plan.blocks[].slot_index` | Same slot index. |
| `assignments[].start_time` | `plan.blocks[].start` | External timeline blocks have concrete sequential start times. |
| `assignments[].duration_hours` | `plan.blocks[].duration_minutes` | Convert minutes to hours. |
| `assignments[].is_fixed` | `plan.blocks[].is_fixed` | Same meaning. |
| `unscheduled_tasks[]` | `unscheduled_tasks[]` | External result adds `reason`; current API does not expose it yet. |
| `optimization_status` | `plan.status` | Exact status values do not need to match during Phase 1. |
| `objective_value` | `score_breakdown[]` | External review output is richer than the current single objective value. |

## Current Gaps For Later Phases

- Weekly task selection has not moved to `humancompiler-scheduler` yet because
  version `0.1.0` only exposes Human daily scheduling contracts.
- The current daily API does not expose unscheduled reasons, score breakdowns,
  or constraint violations.
- Daily assignments now come from Scheduler timeline blocks, so tasks within
  the same slot receive sequential start times.
- Persisted schedule data keeps the existing `plan_json` shape.
