# Agent Writes PR1 (REST writes, change log, web note lock) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an agent token create and update Goals, Tasks, task dependencies and context notes directly through `/api/agent/v1`. Every write is recorded with its before and after values in a new `agent_changes` table. The web note editor stops silently overwriting changes made elsewhere.

**Architecture:**
- **Storage.** Migration 040 adds `agent_changes`, plus the three proposal kinds PR2 will use. Four scopes are added: `goals:write`, `tasks:write`, `notes:write` and `writes:unconfirmed`.
- **Logic.** A new `agent_write_service.py` holds all write logic. For each write it does the following in one transaction:
  1. checks ownership;
  2. locks the row and compares `expected_updated_at`;
  3. decides whether the change is destructive;
  4. applies the change;
  5. records it.
- **HTTP.** A new router `routers/agent_writes.py` exposes the service over REST. In PR1, a destructive change without `writes:unconfirmed` gets 403. PR2 will turn it into a proposal instead.
- **Web.** The web note PUT gains an optional `expected_updated_at`. The `useNote` hook serializes its saves and sends that value. The note page shows a conflict banner on 409.

**Tech Stack:**
- Backend: FastAPI, SQLModel, Pydantic 2, pytest (SQLite in memory; Postgres for the migration test).
- Frontend: Next.js 15, React 18, TypeScript strict, Jest + Testing Library.

**Spec:** `docs/design/agent-mcp.md`. This plan implements its PR1: the sections 「操作と、確認が要る操作」, 「スコープとプリセット」 (scopes only; presets are PR3), 「Agent API の書き込み」 (except 「確認するモードの提案」 and 「ノートの形式」's read-side conversion, which are PR2/PR3), 「Web のノート保存の楽観ロック」, 「変更の記録と取り消し」's data model and retention (the page and revert are PR4), and 「マイグレーション」.

**Branch:** `feat/g4-agent-writes` (it already holds the design commit 5952aca).

## Global Constraints

- **Migration 040** is applied by the user by hand before merge.
  - Additive only, and compatible with the code deployed before it.
  - Safe to run twice.
  - The `DO` body is single-quoted (not `$$`); the migration manager splits on semicolons outside quotes.
  - Follow `039_add_agent_proposals.sql`: dependency checks, RLS, grants, comments, a rollback file.
- **Ownership.** Every write goes through ownership checks on the token owner (`principal.user_id`). A missing ID and another user's ID give the same 404, for every referenced ID: the target, the parent goal or project, `depends_on` and the new `goal_id`.
- **Atomicity.** Each write, including its `agent_changes` row, is one transaction. Any failure leaves nothing written: no entity, no dependency, no change row.
- **Optimistic lock.**
  - Every update and every note replace requires `expected_updated_at`.
  - Compare it with the stored `updated_at` after locking the row (`with_for_update()`, a no-op on SQLite). Normalize naive values to UTC first; SQLite returns naive values.
  - On a mismatch, return 409 with `detail = {"message": "Changed since you read it; read it again and retry", "current_updated_at": <iso UTC>}`, and write nothing.
- **Destructive (消える操作).** A change is destructive when it does any of the following:
  - sets `status` to `cancelled` (Goal or Task);
  - sets `description` to a value different from the stored one (Goal or Task, including clearing it);
  - sets `memo` to a value different from the stored one (Task);
  - sets `goal_id` to a different goal (Task);
  - is a note replace;
  - removes a dependency.

  Appends (`memo_append`, note append) are never destructive. Without `writes:unconfirmed`, a request containing any destructive change gets 403 with `detail = "This change needs the writes:unconfirmed scope"`, and nothing is written. This includes a PATCH that mixes ordinary and destructive fields.
- **No-op updates.** A PATCH whose fields all equal the stored values returns 200 with the entity, records no change and does not bump `updated_at`.
- **Responses.**
  - Writes return the existing response models: `GoalResponse`, `TaskResponse`, `ContextNoteResponse`. Creates return 201.
  - Request models forbid extra fields.
  - `due_date` uses `proposal_payloads.DueDate`: a bare date means 00:00 JST, and a datetime needs an offset.
- **Logging.**
  - No `assert` in `apps/api/src`; CI runs bandit without `-s B101`.
  - No email addresses and no token values in logs or error details.
- **Tests and files.**
  - New files start with the SPDX header (`.spdx-header-python.txt` / `.spdx-header-typescript.txt`).
  - Fake tokens in tests are built from repeated characters (`"hc_agent_" + "p" * 8`). Tests never call real external APIs.
- **Language.** UI strings are Japanese, exactly as in the copy table. Code, comments, commits and the PR are English.
- **Checks before each backend commit, from `apps/api`:** `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run bandit -r src -q && uv run pytest <changed test files> -q`.
- **Checks before each web commit, from `apps/web`:** `pnpm type-check && pnpm lint && pnpm test -- <changed test paths>`.
- **Commits.** Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, rebase, reset or force push.

## Exact copy (Japanese)

| Key | Text |
|---|---|
| scope `goals:write` | `Goal の作成・更新` |
| scope `tasks:write` | `Task の作成・更新と依存関係の追加・削除` |
| scope `notes:write` | `Project / Goal / Task のノートへの追記と書き換え` |
| scope `writes:unconfirmed` | `中止・書き換え・移動・依存関係の削除を、承認なしで実行する（強い権限）` |
| note conflict banner | `このノートは、開いた後に別の場所（エージェントなど）で更新されました。` |
| note conflict: reload button | `最新を読み込む` |
| note conflict: reload hint | `この画面で保存していない変更は消えます` |
| note conflict: overwrite button | `この内容で上書き` |

## Review Focus

1. **A stale `expected_updated_at`**, e.g. the user edited the task in the browser after the agent read it. Expected: 409 with the current `updated_at`, nothing changed, no `agent_changes` row. Tested in Tasks 2, 4 and 5.
2. **Another user's ID in any position**: target, `project_id`, `goal_id`, `depends_on`, a move target or a note target. Expected: the same 404 as a missing ID, and nothing written. Tested in Tasks 2, 3 and 4.
3. **A PATCH that mixes an ordinary change with a destructive one, from a token without `writes:unconfirmed`.** Expected: 403, and neither change is applied. Tested in Task 2.
4. **A Task created with a `depends_on` that is circular or foreign.** Expected: 422 or 404, no task created, no dependency, no change row. Tested in Task 3.
5. **Two quick web edits in a row while the first save is still in flight.** Expected: no false 409; the second save waits for the first and uses its new `updated_at`. A browser tab opened before an agent's append gets the conflict banner instead of silently overwriting. Tested in Task 5.

---

### Task 1: Migration 040, the `AgentChange` model and the new scopes

**Files:**
- Create: `apps/api/migrations/040_add_agent_writes.sql`, `apps/api/migrations/040_add_agent_writes_rollback.sql`
- Create: `apps/api/tests/test_agent_writes_migration_postgres.py` (pattern: `tests/test_agent_proposals_migration_postgres.py` and `tests/postgres_migration_helpers.py`)
- Modify: `.github/workflows/notebook-search.yml`: add `apps/api/migrations/040*` and the new test file to the path filters, plus a run step like the one for 039.
- Modify: `apps/api/src/humancompiler_api/models.py`:
  - add the `AgentScope` members, their `AGENT_SCOPE_DESCRIPTIONS`, and `writes:unconfirmed` in `AGENT_BROAD_SCOPES`;
  - add the `AgentChangeActor`, `AgentChangeEntity` and `AgentChangeAction` StrEnums and the `AgentChange` table model.
- Modify: `apps/api/src/humancompiler_api/scheduler/notification_scheduler.py`: in `purge_expired_agent_audit_logs`, also purge `agent_changes` older than 365 days. Do it through a new `agent_changes_purge(session, now) -> int` in a new `apps/api/src/humancompiler_api/agent_changes.py`.
- Test: `apps/api/tests/test_agent_changes.py` (new), `apps/api/tests/test_agent_tokens_api.py` (scopes list).

**Interfaces:**
- **Produces:**
  - `AgentScope.GOALS_WRITE = "goals:write"`, `TASKS_WRITE = "tasks:write"`, `NOTES_WRITE = "notes:write"`, `WRITES_UNCONFIRMED = "writes:unconfirmed"`.
  - `AgentChangeActor`: `agent`, `user`.
  - `AgentChangeEntity`: `goal`, `task`, `context_note`, `task_dependency`.
  - `AgentChangeAction`: `create`, `update`, `append`, `replace`, `revert`.
  - `AgentChange` (table `agent_changes`), with these columns. The id uses `default_factory=uuid4`. Every datetime is aware UTC.
    - `id`, `user_id`, `actor`, `agent_token_id: UUID | None`, `agent_name: str | None`, `proposal_id: UUID | None`;
    - `entity_type`, `entity_id`, `project_id: UUID | None`, `goal_id: UUID | None`;
    - `action`, `before: dict | None` (JSON), `after: dict` (JSON), `destructive: bool`;
    - `reverts_change_id: UUID | None`, `reverted_at: datetime | None`, `created_at`.
  - `agent_changes.purge_expired_changes(session: Session, now: datetime | None = None) -> int` with `RETENTION_DAYS = 365`.

**The table, in SQL:**
- Columns as above. `before`, `after` and `proposal_id` have no foreign key. `agent_token_id` references `agent_tokens(id) ON DELETE SET NULL`, and `user_id` references `users(id) ON DELETE CASCADE`.
- CHECK constraints on `actor`, `entity_type` and `action` with exactly the values above.
- A CHECK `actor <> 'user' OR (agent_token_id IS NULL AND agent_name IS NULL)`.
- A CHECK `action <> 'revert' OR reverts_change_id IS NOT NULL`.
- Indexes: `(user_id, created_at)`, `(entity_type, entity_id)`, `(user_id, project_id, created_at)`, `(user_id, goal_id, created_at)`.
- RLS on, with a SELECT policy for `authenticated` on `user_id = auth.uid()` and grants as in 039.

**Proposal kinds.** In the same migration, drop and recreate `ck_agent_proposals_kind` with the three extra values `goal_change`, `task_change` and `note_replace`. Use `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`, then `ADD CONSTRAINT`. Keep the `result_type` CHECK unchanged; the design's values are enough.

**The rollback** drops `agent_changes` and restores the 7-kind CHECK. The restore fails if rows with the new kinds exist. Document that in the rollback header.

- [ ] **Step 1: Write the failing tests.**
  - **`test_agent_changes.py`:**
    - `test_agent_change_defaults` checks that a new `AgentChange(...)` has a UUID `id` before any flush and that `created_at` is aware UTC.
    - `test_purge_expired_changes` checks that rows 366 days old are deleted, rows 364 days old are kept, and the count is returned.
  - **`test_agent_tokens_api.py`:**
    - the `/api/user/agent-tokens/scopes` response lists the four new scopes with the exact copy above;
    - `writes:unconfirmed` is the only new scope with `broad: true`.
  - **The Postgres migration test:**
    - 040 applies twice;
    - a row with each allowed enum value inserts;
    - a bad `actor`, `entity_type` or `action` is rejected;
    - `actor='user'` with an `agent_name` is rejected;
    - `revert` without `reverts_change_id` is rejected;
    - an `agent_proposals` row with kind `task_change` inserts after 040;
    - the rollback runs and removes the table.
- [ ] **Step 2: Run them.** Run `uv run pytest tests/test_agent_changes.py tests/test_agent_tokens_api.py -q`. Expected: FAIL. The Postgres test is skipped without `NOTEBOOK_TEST_POSTGRES_URL`; run it locally if a Postgres is available, or rely on CI.
- [ ] **Step 3: Implement** the migration, the rollback, the models and the purge, and wire the purge into the existing daily job (one log line with the count).
- [ ] **Step 4: Run** the backend checks with the test files above. Expected: PASS.
- [ ] **Step 5: Commit** with the message `feat(api): Add agent_changes and the agent write scopes (migration 040)`.

---

### Task 2: Goal and Task create and update over the Agent API

**Files:**
- Create: `apps/api/src/humancompiler_api/agent_write_service.py`
- Create: `apps/api/src/humancompiler_api/agent_write_models.py` (request models)
- Create: `apps/api/src/humancompiler_api/routers/agent_writes.py`, and include it in `main.py` next to the other agent routers.
- Test: `apps/api/tests/test_agent_writes_api.py` (new; use `tests/agent_api_helpers.py`: `client`, `issue_token`, `bearer`, `seed_user`, `seed_project`, `seed_goal`, `seed_task`, `use_session`)

**Interfaces:**
- **Consumes** from Task 1: `AgentScope.*_WRITE`, `AgentChange`, the enums.
- **Produces** in `agent_write_models.py`. Every model uses `ConfigDict(extra="forbid")`. The limits are the same as `GoalUpdate` / `TaskUpdate` in `models.py`.
  - `AgentGoalCreate(project_id: UUID, title, description: str | None = None, due_date: DueDate = None)`
  - `AgentGoalUpdate(expected_updated_at: datetime, title?, description?, due_date?, status: GoalStatus?)`
  - `AgentTaskCreate(goal_id: UUID, title, estimate_hours: Decimal (>0, 5,2), description?, due_date: DueDate, priority: int 1..5?, work_type: WorkType?, depends_on: list[UUID] = [] (max 20, no duplicates))`. `depends_on` is consumed in Task 3; Task 2 accepts the field and Task 3 implements it.
  - `AgentTaskUpdate(expected_updated_at, title?, description?, memo?, memo_append: str (1..2000)?, estimate_hours?, due_date?, status: TaskStatus?, priority?, work_type?, goal_id: UUID?)`. `memo` and `memo_append` together give 422. A `memo_append` that would make `memo` longer than 2000 gives 422.
  - "Set to null" is allowed for `description`, `memo`, `due_date`, `priority` and `work_type`. The model must tell an unset field from an explicit `null`; use `model_fields_set`.
- **Produces** in `agent_write_service.py`. Each function commits on success, rolls back on any error, and raises `HTTPException`.
  - `create_goal(session: Session, principal: AgentPrincipal, data: AgentGoalCreate) -> Goal`
  - `update_goal(session, principal, goal_id: UUID, data: AgentGoalUpdate) -> Goal`
  - `create_task(session, principal, data: AgentTaskCreate) -> Task`
  - `update_task(session, principal, task_id: UUID, data: AgentTaskUpdate) -> Task`
  - `record_change(session, principal, *, entity_type, entity_id, action, before, after, destructive, project_id, goal_id) -> AgentChange`. It flushes without committing, writes `actor=agent`, `agent_token_id=principal.token_id`, and copies the token's current name into `agent_name`. Tasks 3 and 4 reuse it.
  - `require_destructive_allowed(principal) -> None`, which raises the 403 from Global Constraints. Tasks 3 and 4 reuse it.
  - `check_expected_updated_at(stored: datetime, expected: datetime) -> None`, which raises the 409. Tasks 3 and 4 reuse it.
- **Routes** in `routers/agent_writes.py`, prefix `/api/agent/v1`:
  - `POST /goals` (201, `goals:write`)
  - `PATCH /goals/{goal_id}` (`goals:write`)
  - `POST /tasks` (201, `tasks:write`)
  - `PATCH /tasks/{task_id}` (`tasks:write`)

  Responses are `GoalResponse` / `TaskResponse`, built the same way as the read endpoints in `routers/agent_v1.py`: reload with the dependencies loaded.

**Behaviour:**
- **Ownership:**
  - Goals: `goal_service.get_goal`. Projects: `project_service.get_project`. Tasks: `task_service.get_task`.
  - Map "not found" and "not owned" to 404 `"Goal not found"`, `"Project not found"` and `"Task not found"`.
- **Status transitions:** `update_goal` validates them with `goal_service._validate_status_transition` (422 as today).
- **Writes inside the shared transaction:** use `BaseService.build` for creates, and set attributes directly for updates. Do not call the service methods that commit (`create`, `update`).
- **`updated_at`:** set it to `datetime.now(UTC)` on every real change.
- **The change row** records only the fields that changed. `before` and `after` are dicts of field → JSON value (`jsonable_encoder`; Decimal as a string is fine). A create has `before=None`, and `after` holds every field the request set. `memo_append` is recorded as `action=update`, with `after={"memo_append": text}` and `before={"memo_length": n}`.
- **Parents on the change row:**
  - A goal sets `project_id` = its project and `goal_id` = itself.
  - A task sets `goal_id` = its goal after the change and `project_id` = that goal's project.
  - On a move, `before` holds the old `goal_id`.

- [ ] **Step 1: Write the failing tests** in `test_agent_writes_api.py`.
  - `test_write_scopes_required`: a token without `goals:write` / `tasks:write` gets 403 on each route.
  - `test_create_goal_and_task`:
    - each returns 201 with the entity;
    - the entity belongs to the owner;
    - one `agent_changes` row exists with `action=create`, `destructive=false`, the right `project_id`/`goal_id`, `agent_name` equal to the token name, and `before` None.
  - `test_create_under_foreign_or_missing_parent_is_404`: a foreign `project_id` and a random `project_id` both give `404 "Project not found"`. The same holds for `goal_id` on a task. Nothing is created.
  - `test_update_ordinary_fields`:
    - a PATCH of `title`, `estimate_hours`, `due_date: "2026-12-01"` and `status: "completed"` returns 200 with the new values;
    - `due_date` is stored as `2026-11-30T15:00:00Z`;
    - one change row has `before`/`after` holding exactly those fields, and `destructive=false`.
  - `test_update_requires_expected_updated_at`: leaving it out gives 422.
  - `test_stale_expected_updated_at_is_409`: the body has `message` and `current_updated_at`, the entity is unchanged, and there is no change row.
  - `test_noop_update`: the same values give 200, no change row, and `updated_at` unchanged.
  - `test_destructive_without_unconfirmed_is_403`, one case for each of:
    - task `status: cancelled`;
    - task `description` changed;
    - task `memo` changed;
    - task `goal_id` moved;
    - goal `status: cancelled`;
    - goal `description` cleared to null.
    Each gives 403 with the exact detail and writes nothing.
  - `test_mixed_patch_without_unconfirmed_writes_nothing`: `title` plus `status: cancelled` gives 403, and the title is unchanged.
  - `test_destructive_with_unconfirmed`: the same changes with a token holding `writes:unconfirmed` give 200, with change rows that have `destructive=true`. The move's change row has `before.goal_id` set to the old goal and `goal_id` set to the new one.
  - `test_move_to_foreign_goal_is_404`.
  - `test_memo_append_is_ordinary`: it appends to the memo with a newline separator, and the change row has `memo_append`. `memo` and `memo_append` together give 422.
  - `test_goal_invalid_status_transition_is_422`.
  - `test_other_users_task_is_404`.
  - `test_change_row_agent_name_and_token`.
- [ ] **Step 2: Run** `uv run pytest tests/test_agent_writes_api.py -q`. Expected: FAIL (404 from the missing routes).
- [ ] **Step 3: Implement** the models, the service functions and the router.
  - **Locking:** load the row with `with_for_update()`, compare `expected_updated_at`, then decide which fields really changed (`new != stored`). If the destructive set is non-empty, call `require_destructive_allowed`.
- [ ] **Step 4: Run** the backend checks with `tests/test_agent_writes_api.py`. Also run `tests/test_agent_v1_records.py` and `tests/test_agent_proposals_api.py` for regressions.
- [ ] **Step 5: Commit** with the message `feat(api): Let agent tokens create and update goals and tasks`.

---

### Task 3: Task dependencies, both at creation and on their own

**Files:**
- Modify: `apps/api/src/humancompiler_api/agent_write_service.py` and `agent_write_models.py`, plus `routers/agent_writes.py`.
- Test: `apps/api/tests/test_agent_writes_api.py` (add tests).

**Interfaces:**
- **Consumes:** `record_change`, `require_destructive_allowed` and `check_expected_updated_at` from Task 2; `AgentTaskCreate.depends_on` from Task 2.
- **Produces:**
  - `AgentDependencyCreate(depends_on_task_id: UUID)`, with extra fields forbidden.
  - `add_task_dependency(session, principal, task_id: UUID, depends_on_task_id: UUID) -> Task`.
  - `remove_task_dependency(session, principal, task_id: UUID, depends_on_task_id: UUID) -> Task`.
  - Routes:
    - `POST /tasks/{task_id}/dependencies` (201, `tasks:write`).
    - `DELETE /tasks/{task_id}/dependencies/{depends_on_task_id}` (200, `tasks:write`).
  - Both return the updated `TaskResponse`.

**Behaviour:**
- **Checks.** Use the same checks as `task_service.add_task_dependency`, but without its commit:
  - both tasks owned, else 404 `"Task not found"` / `"Dependency task not found"`;
  - a task cannot depend on itself (422 `"Task cannot depend on itself"`);
  - no cycle, via `services._dependency_path_exists` (422 `"Creating this dependency would create a circular dependency"`);
  - an existing pair is a no-op 200 with no change row.
  - Use 422, not the existing 400, so agents get one validation status. Keep the detail strings.
- **Timestamps.** Adding or removing advances the dependent task's `updated_at`, the same as `_touch`.
- **Change rows.**
  - `entity_type=task_dependency`;
  - `entity_id` = the `TaskDependency` id;
  - `action` = `create` when adding, `update` when removing, with `after={"removed": true}` and `before={"task_id":…, "depends_on_task_id":…}`;
  - `destructive` = true when removing;
  - `goal_id`/`project_id` = those of the dependent task.
- **Removing** is destructive, so it calls `require_destructive_allowed`. It does not take `expected_updated_at`: a dependency has no meaningful version, and removing an absent pair is a 404 `"Dependency not found"`.
- **`create_task` with `depends_on`.**
  - Create the task, then add each dependency with the same checks, all in the one transaction.
  - Any failure (foreign task 404, cycle 422) rolls everything back.
  - Record one `create` change row for the task, with `after` including `depends_on`, and one `create` row per dependency.

- [ ] **Step 1: Write the failing tests.**
  - `test_create_task_with_depends_on`: the dependencies exist, and the response's dependency summary lists them.
  - `test_create_task_with_foreign_depends_on_creates_nothing`: 404, no task, no dependency, no change row.
  - `test_add_dependency_cycle_is_422`: set up an existing A→B (A depends on B). Adding B→A with `POST /tasks/B/dependencies` gives 422 with the cycle message, and no change row is written.
  - `test_add_dependency_on_itself_is_422`.
  - `test_create_task_duplicate_depends_on_is_422`: a duplicate id in `depends_on` is rejected by the model. A new task cannot form a cycle at creation, so this is the creation-time validation case.
  - `test_add_dependency_is_ordinary`: works without `writes:unconfirmed`, writes a change row, and bumps `updated_at`.
  - `test_add_existing_dependency_is_noop`.
  - `test_remove_dependency_needs_unconfirmed`:
    - without the scope: 403, and the dependency stays;
    - with it: 200, the dependency is gone, and the change row has `destructive=true`.
  - `test_remove_missing_dependency_is_404`.
  - `test_dependency_on_foreign_task_is_404`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the backend checks with `tests/test_agent_writes_api.py` and `tests/test_dependency_cycle_detection.py`.
- [ ] **Step 5: Commit** with the message `feat(api): Let agent tokens add and remove task dependencies`.

---

### Task 4: Append to and replace context notes

**Files:**
- Modify: `apps/api/src/humancompiler_api/agent_write_service.py`, `agent_write_models.py`, `routers/agent_writes.py`.
- Modify: `apps/api/src/humancompiler_api/routers/agent_proposals.py`. Generalize `BodyCappedRoute` so the cap is a parameter, e.g. a factory `body_capped_route(max_bytes: int) -> type[APIRoute]`. Keep the proposals cap at 64 KB and its 413 detail text unchanged. Use a 512 KB cap for the note routes.
- Test: `apps/api/tests/test_agent_writes_api.py` (add tests).

**Interfaces:**
- **Consumes:**
  - from Task 2: `record_change`, `require_destructive_allowed`, `check_expected_updated_at`;
  - from `note_markdown`: `markdown_to_note_html`, `append_html`, `agent_append_heading`;
  - from `proposal_service`: `APP_TIMEZONE`.
- **Produces:**
  - `NoteTargetKind = Literal["projects", "goals", "tasks"]`.
  - `AgentNoteAppend(content_markdown: str, 1..20000)`.
  - `AgentNoteReplace(expected_updated_at: datetime | None, content_markdown: str, 0..100000)`. `expected_updated_at` may be null only when the note does not exist yet.
  - `append_note(session, principal, kind: NoteTargetKind, target_id: UUID, data) -> ContextNote`.
  - `replace_note(session, principal, kind, target_id, data) -> ContextNote`.
  - Routes, under the 512 KB body cap:
    - `POST /context-notes/{kind}/{target_id}/append` (`notes:write`);
    - `PUT /context-notes/{kind}/{target_id}` (`notes:write`).
  - Both return `ContextNoteResponse`.

**Behaviour:**
- **Ownership.** The target is checked with the project, goal or task services; a foreign or missing target gives 404 `"Project not found"` / `"Goal not found"` / `"Task not found"`.
- **The note row.** Find or create the note the same way as `proposal_service._append_to_note`: lock the row, create it if missing with `content_type="html"`, and map an `IntegrityError` to 409.
- **Append.**
  - Prepend `agent_append_heading(token name, JST today)`, exactly like G3's `note_append`.
  - The change row has `action=append`, `before={"length": len(old_html)}`, `after={"appended_html": block}` and `destructive=false`.
- **Replace.**
  - Convert with `markdown_to_note_html`. An empty markdown gives an empty note.
  - Compare `expected_updated_at`. If the note does not exist and `expected_updated_at` is null, create it. If the note exists and the value is null, return 409 with `current_updated_at`.
  - Destructive, so it calls `require_destructive_allowed`.
  - The change row has `action=replace`, `before={"content": old_html}`, `after={"content": new_html}` and `destructive=true`.
- **Parents on the change row:** a project note sets `project_id`; a goal note sets `goal_id` and its project; a task note sets the task's `goal_id` and project.
- **Agent-supplied markdown** never reaches the HTML unconverted: raw HTML is disabled in `note_markdown`.

- [ ] **Step 1: Write the failing tests.**
  - `test_append_note_creates_and_appends`, for each of the three kinds:
    - the first append creates the note;
    - the second append keeps the first;
    - the heading has the token name;
    - one change row per append.
  - `test_append_escapes_raw_html`: `<script>x</script>` in the markdown is not raw HTML in the stored note.
  - `test_replace_note_needs_unconfirmed`: 403 without the scope, with the note unchanged.
  - `test_replace_note`: with the scope and the right `expected_updated_at`, the content is replaced and the change row holds the old and new HTML. A stale value gives 409. A null value on an existing note gives 409.
  - `test_note_on_foreign_target_is_404`, for each kind.
  - `test_note_append_too_long_is_422`, and `test_note_body_over_cap_is_413`, with a raw body over 512 KB.
  - `test_proposals_body_cap_unchanged`: a proposals POST over 64 KB still gives 413 with the old detail.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the backend checks with `tests/test_agent_writes_api.py`, `tests/test_agent_proposals_api.py` and `tests/test_note_markdown.py`.
- [ ] **Step 5: Commit** with the message `feat(api): Let agent tokens append to and replace context notes`.

---

### Task 5: Optimistic lock for the web note editor

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`: add `ContextNoteUpdate.expected_updated_at: datetime | None = None`.
- Modify: `apps/api/src/humancompiler_api/routers/notes.py`: the three `update_*_note` handlers.
- Modify: `apps/web/src/types/context-note.ts`, `apps/web/src/hooks/use-notes.ts`, `apps/web/src/components/notes/note-page-layout.tsx`.
- Test:
  - `apps/api/tests/test_notes_optimistic_lock.py` (new; find the existing notes router tests or the auth-override pattern in `tests/test_proposals_router.py`);
  - `apps/web/src/hooks/__tests__/use-notes.test.ts` (new);
  - `apps/web/src/components/notes/__tests__/note-page-layout.test.tsx` (new).

**Interfaces:**
- **Consumes:** `agent_write_service.check_expected_updated_at` from Task 2. It gives the same 409 body: `{"message", "current_updated_at"}`.
- **Produces** (web):
  - `ContextNoteUpdate.expected_updated_at?: string` (TypeScript).
  - `useNote` returns, in addition to today's fields:
    - `conflict: boolean`;
    - `reloadLatest: () => Promise<void>`, which refetches, clears `conflict` and drops the pending local content;
    - `overwrite: () => Promise<void>`, which saves the latest local content without `expected_updated_at` and clears `conflict`.

**Behaviour:**
- **Backend:**
  - If `expected_updated_at` is set and differs from the stored `updated_at`, return 409 and write nothing.
  - If it is not set, keep today's behaviour, so the old web build and the overwrite path keep working.
  - The handler must not write `expected_updated_at` onto the note. Exclude it from the `setattr` loop.
- **The hook:**
  - It keeps `baseUpdatedAtRef`, set from every fetch and every successful save response.
  - Saves are serialized: a save that starts while another is in flight waits for it, then sends the `updated_at` that save returned. Use a promise chain in a ref; this is what prevents a false 409 between two quick edits.
  - On a 409 from `ApiError` (check how `lib/api.ts` exposes the status), set `conflict = true`.
  - While `conflict` is true, debounced saves are not sent; the latest content is kept in `latestContentRef`.
  - Other errors behave as today.
- **The page.**
  - When `conflict` is true, `NotePageLayout` shows an amber alert above the panel with the banner text and two buttons, both disabled while a save is in flight:
    - `最新を読み込む`, with its hint text under it;
    - `この内容で上書き`.
  - After `reloadLatest`, the panel must show the reloaded content. Remount `ContextNotePanel` with a `key` that changes on reload, e.g. a reload counter, because the editor reads `content` only on mount.

- [ ] **Step 1: Write the failing tests.**
  - **Backend:**
    - `expected_updated_at` equal to the stored value gives 200 and a new `updated_at`;
    - a different value gives 409 with the note unchanged;
    - no value gives 200 (today's behaviour);
    - the field is never stored.
    - Cover all three kinds.
  - **Hook:**
    - The first save sends the fetched `updated_at`.
    - Two `updateNoteImmediate` calls back to back: the second request waits for the first, then sends the first response's `updated_at`. Mock `notesApi` with a deferred promise.
    - A 409 sets `conflict`, and later `updateNote` calls send nothing.
    - `reloadLatest` refetches and clears `conflict`.
    - `overwrite` sends the latest content without `expected_updated_at`.
  - **Page:**
    - with the hook mocked to `conflict: true`, the banner and both buttons render with the exact copy;
    - the buttons call `reloadLatest` / `overwrite`;
    - with `conflict: false` there is no banner.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the backend checks with `tests/test_notes_optimistic_lock.py`, and the web checks with `src/hooks/__tests__/use-notes.test.ts src/components/notes`.
- [ ] **Step 5: Commit** with the message `feat(notes): Stop the web editor from overwriting changes made elsewhere`.

---

## After the tasks (controller, not a task)

- **Full suites:** run `uv run pytest -q` in `apps/api` and `pnpm test` in `apps/web`.
- **PR body, Deployment Notes:**
  - the user applies migration 040 before merging;
  - no new secrets;
  - no preset yet, so a token for these routes is made by picking the scopes by hand;
  - `writes:unconfirmed` is shown as a broad scope.
- **Manual check after deploy.** With a token that has `goals:write`, `tasks:write`, `notes:write` and the reads:
  1. Create a test Goal and Task with `curl`, PATCH the task to `completed`, and append to the project note.
  2. Check that a PATCH to `cancelled` gives 403.
  3. In the browser, open the project note before the append and type afterwards. The conflict banner should appear.

  The test token file stays under `~/.config/humancompiler/`. Clean up afterwards.
