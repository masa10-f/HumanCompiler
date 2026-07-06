# Scheduler Integration Notes

HumanCompiler currently keeps scheduling code behind one API adapter layer:

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

## Current State And Gaps

- Daily scheduling now adapts HumanCompiler data into Scheduler's Human daily
  fixture and uses the timeline daily solver through `plan_daily_schedule`.
- The API still returns the existing assignment-shaped response so the web app
  contract stays stable, but each assignment is backed by Scheduler timeline
  blocks with concrete `start_time` and duration.
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

Weekly task selection imports `humancompiler_scheduler.human` weekly selection
APIs directly. HumanCompiler requires the Scheduler package release that
contains those APIs and does not fall back to the legacy internal weekly
optimizer. The weekly API no longer uses OpenAI priority extraction; task
selection uses deterministic priority, deadline, remaining-hours, recurring
task, capacity, dependency, and project-allocation inputs.

The scheduler tuning endpoint returns only user-tunable defaults and visible
controls. Internal or misleading solver fields such as fixed-assignment and
dependency-unlock scores are intentionally not exposed to the web UI. With
`humancompiler-scheduler[cp-sat]>=0.3.0`, the preference UI maps user-facing choices to
block-generation parameters such as `min_block_minutes`,
`block_granularity_minutes`, and `max_candidate_block_minutes`.
