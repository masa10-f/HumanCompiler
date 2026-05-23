# Scheduler Integration Notes

HumanCompiler currently has two scheduler-related layers:

- `humancompiler_optimizer.daily` / `weekly`: pure optimization models and
  OR-Tools solver entry points. These modules do not depend on database or API
  objects.
- `humancompiler_api.routers.scheduler`: FastAPI adapter code. It fetches user
  data, maps database models to optimizer inputs, applies ownership checks, and
  converts solver results back to API responses used by the web app.

The external `Scheduler` repository should grow a HumanCompiler-oriented
experimental API first. HumanCompiler should continue to keep database models
behind adapter code and pass only plain scheduling inputs into that package.

## Daily API Shape To Preserve

`POST /api/schedule/daily` should continue returning:

- `success`
- `date`
- `assignments`
- `unscheduled_tasks`
- `total_scheduled_hours`
- `optimization_status`
- `solve_time_seconds`
- `objective_value`
- `generated_at`

Each assignment should continue including the task identity, title, goal and
project IDs, slot index, assigned start time, duration, slot window, slot kind,
and `is_fixed`.

Each unscheduled task should continue including ID, title, remaining estimate,
priority, kind, due date, goal ID, and project ID.

## Current Gaps

- Daily scheduling currently returns slot assignments rather than true timeline
  blocks. Multiple tasks assigned to the same slot can share the same
  `start_time`.
- Regular task priority is not passed through to the daily optimizer yet. The
  adapter currently uses priority `3` for regular tasks while quick tasks pass
  their real priority.
- Deadline scoring is task-level for the target date and does not yet strongly
  explain why a task was placed earlier or later within the day.
- The daily response does not include unscheduled reasons or score breakdowns.

## Phase 0 Boundary

For the first integration phase, HumanCompiler should not import the external
`Scheduler` package. The immediate goal is to document the boundary and keep
the current API stable while the external package develops fixtures, review
commands, and a more human-like daily planning model.
