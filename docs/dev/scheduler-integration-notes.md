# Scheduler Integration Notes

HumanCompiler currently has two scheduler-related layers:

- `humancompiler_optimizer.daily` / `weekly`: pure optimization models and
  OR-Tools solver entry points. These modules do not depend on database or API
  objects.
- `humancompiler_api.routers.scheduler`: FastAPI adapter code. It fetches user
  data, maps database models to optimizer inputs, applies ownership checks, and
  converts solver results back to API responses used by the web app.

The external `Scheduler` repository now provides the PyPI package
`humancompiler-scheduler`. HumanCompiler keeps database models behind adapter
code and passes only plain scheduling inputs into that package.

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
- Regular task priority is now passed through to the daily optimizer and to
  unscheduled task response data. The remaining priority work is manual app
  validation that same-condition priority `1` tasks are favored over priority
  `5` tasks.
- Deadline scoring is task-level for the target date and does not yet strongly
  explain why a task was placed earlier or later within the day.
- The daily response does not include unscheduled reasons or score breakdowns.

## Runtime Boundary

Daily scheduling imports `humancompiler_scheduler.human` and maps existing API
task/slot request data into `HumanDailyFixture`. `POST /api/schedule/daily`
keeps the existing response shape for the web app, while the backend uses
Scheduler's timeline daily solver and accepts optional `solver_config`
overrides.

Weekly task selection still uses the existing HumanCompiler weekly optimizer
because `humancompiler-scheduler==0.1.0` does not yet expose a weekly selection
API. Keep the weekly adapter isolated so it can move once Scheduler publishes a
weekly contract.
