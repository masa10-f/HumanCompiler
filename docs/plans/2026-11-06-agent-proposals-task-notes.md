# Agent Proposals: Task Notes and Goal Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a `task` proposal carry a note (an agent-ready prompt), and let a `goal` proposal carry up to 10 tasks, each with its own note (#412). The inbox shows the notes and lets the user edit them and remove tasks before accepting.

**Architecture:**
- The payload schemas in `proposal_payloads.py` gain `note_markdown` on tasks and `tasks` on goals. No migration: payloads are JSONB and the kinds do not change.
- `proposal_service._materialise` creates the task note, and for a goal each task and its note, in the accept transaction that already exists (one commit at the end; any failure rolls everything back).
- The note body goes through the same conversion and heading as `note_append`, by reusing `create_note` and `append_agent_markdown`.
- On the web, `proposal-payload-view.tsx` shows the notes collapsed (`<details>`) as plain text. `proposal-edit.ts` and the edit form gain a note field for tasks and a per-task editor for goals, with remove and restore buttons.

**Tech Stack:** FastAPI, SQLModel, Pydantic v2, pytest (SQLite in-memory via the root `conftest.py` `session` fixture); Next.js 15, React 18, Jest + Testing Library.

**Spec:** `docs/design/agent-proposals.md`, section 「Task のノートと Goal の下の Task（2026-11-06 に追加、#412）」 and the `goal` / `task` rows of 「種類ごとの payload」. Background: ResearchDistillator `docs/design/r3-proposals.md`, section 「HumanCompiler 側に要る追加（G3 の拡張）」.

**Branch:** `feat/g3-task-notes` from `main` (ef0e2f2 or later).

## Global Constraints

- No migration, no new Python or npm dependency.
- `note_markdown`: optional, 1–20000 characters, on `task` payloads and on each goal task. A missing note or one that is only whitespace creates no note.
- `tasks` on a `goal` payload: optional, at most 10 items. An empty list is normalised to `null` (so `[]` and a missing key dump the same). 11 items is 422.
- Each goal task has exactly the task fields minus `goal_id`: `title` (1–200, required), `description` (≤1000), `estimate_hours` (required, >0, 5 digits, 2 decimals), `due_date`, `work_type`, `priority` (1–5), `note_markdown`. `extra="forbid"`, so a `goal_id` inside an item is 422.
- A goal task's `due_date` is never filled from the goal's `due_date`.
- `result` stays `{type: "goal", id}` for a goal and `{type: "task", id}` for a task.
- The note heading and conversion are exactly those of `note_append`: `append_agent_markdown(note, row.agent_name, markdown)` on a note made by `create_note(session, user_id, NoteTarget(task_id=...))`.
- Web: agent text is plain text (`whitespace-pre-wrap`), never `dangerouslySetInnerHTML`. UI copy is Japanese; code, comments, commits and the PR are English.
- No `assert` in `apps/api/src`. New files start with the SPDX header (`.spdx-header-python.txt` / `.spdx-header-typescript.txt`).
- **Backend checks before each commit, from `apps/api`:** `uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run bandit -r src -q && uv run pytest tests/test_proposal_payloads.py tests/test_proposal_decisions.py tests/test_agent_proposals_api.py tests/test_proposals_router.py -q`.
- **Web checks before each commit, from `apps/web`:** `pnpm type-check && pnpm lint && pnpm test -- src/components/proposals src/lib/__tests__/proposal-edit.test.ts`.
- **Commits:** Conventional Commits in English, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never `--amend`, rebase, reset or force push.

## Exact copy (Japanese)

| Key | Text |
|---|---|
| note summary (view) | `ノート（{N} 文字）` where N is the note's length |
| goal tasks row label (view) | `Task` |
| note field label (edit) | `ノート（Markdown）` |
| goal task fieldset legend (edit) | `Task {i}` (1-based) |
| remove button | `この Task を外す` |
| restore button | `元に戻す` |
| removed task line | `外す: {title}` |

## Review Focus

1. **Proposals stored before this change** (payload without `note_markdown` / `tasks`) must still accept as `accepted`, not `edited`, and the edit form must not send a payload when nothing changed. Tests: Task 1 `test_legacy_payload_without_new_keys_accepts_unedited`; Task 3 `sends a plain accept for a legacy task payload without note_markdown`.
2. **Raw HTML and `javascript:` links in a note** must be neutralised, as for `note_append`. Test: Task 1 `test_task_note_neutralises_raw_html_and_js_links`.
3. **One bad task inside a goal** (e.g. an edited `estimate_hours` of 0) must create nothing: no goal, no tasks, no notes, proposal still pending. Test: Task 1 `test_goal_with_invalid_edited_task_creates_nothing`.
4. **A note that is only whitespace** must not create an empty-looking note with just a heading. Test: Task 1 `test_whitespace_only_note_creates_no_note`.
5. **A removed goal task with empty required fields** must not block the submit button, and removing every task must send `tasks: null` and create the goal only. Tests: Task 3 `a removed task with an empty title does not block submit`, Task 1 `test_goal_with_all_tasks_removed_creates_goal_only`.

---

### Task 1: Backend — schemas and accept

**Files:**
- Modify: `apps/api/src/humancompiler_api/proposal_payloads.py`
- Modify: `apps/api/src/humancompiler_api/proposal_service.py` (`_create_input`, `_materialise`)
- Test: `apps/api/tests/test_proposal_payloads.py`, `apps/api/tests/test_proposal_decisions.py`, `apps/api/tests/test_agent_proposals_api.py`

**Interfaces:**
- Produces (Python):
  - `class _TaskFields(_Payload)`: `title`, `description`, `estimate_hours`, `due_date`, `work_type`, `priority`, `note_markdown: str | None = Field(default=None, min_length=1, max_length=20000)`. Same field definitions as today's `TaskProposalPayload`.
  - `class TaskProposalPayload(_TaskFields)`: adds `goal_id: UUID`.
  - `class GoalTaskItem(_TaskFields)`: no extra fields.
  - `GoalProposalPayload.tasks: list[GoalTaskItem] | None = Field(default=None, max_length=10)`, with a `field_validator("tasks", mode="before")` that turns `[]` into `None`.
  - `proposal_service._create_input(model, parsed, exclude: set[str] | None = None)`.
  - `proposal_service._create_task_note(session: Session, user_id: UUID, agent_name: str, task_id: UUID, markdown: str | None) -> ContextNote | None` — returns None and writes nothing when `markdown` is None or `markdown.strip() == ""`.
- Produces (JSON, consumed by Tasks 2 and 3): `payload.note_markdown` on task payloads; `payload.tasks` (array or `null`) on goal payloads, each item with the fields above.

- [ ] **Step 1: Write the failing payload tests** in `tests/test_proposal_payloads.py`:
  - `test_task_note_markdown_length_limits`: `note_markdown` of `"x" * 20000` passes; `"x" * 20001` and `""` raise `ValidationError`.
  - `test_goal_tasks_accepts_up_to_ten`: 10 items `{"title": "t", "estimate_hours": 1}` pass; 11 raise.
  - `test_goal_tasks_empty_list_normalises_to_none`: `normalize_payload(GOAL, {..., "tasks": []})["tasks"] is None` and equals the dump without the key.
  - `test_goal_task_rejects_goal_id_and_requires_estimate`: an item with `goal_id` raises; an item without `estimate_hours` raises.
  - `test_goal_task_due_date_is_normalised_like_task`: item `due_date: "2026-12-01"` dumps as `"2026-11-30T15:00:00Z"`.

- [ ] **Step 2: Run** `uv run pytest tests/test_proposal_payloads.py -q` — expected: the new tests FAIL.

- [ ] **Step 3: Implement the schemas** in `proposal_payloads.py` as in Interfaces. Existing tests (`MINIMAL_PAYLOADS`, extra-field checks) must keep passing unchanged.

- [ ] **Step 4: Run** the same command — expected: PASS.

- [ ] **Step 5: Write the failing accept tests** in `tests/test_proposal_decisions.py` (use `make_proposal`, `accept`, `count`, `seed_*`, `agent_append_heading`, `markdown_to_note_html`, `tokyo_today` already in the file):
  - `test_accept_task_with_note_creates_note`: task payload with `note_markdown: "## Do\n\nIt."` → one `ContextNote` with `task_id == result.result_id`, `user_id == USER_A`, `content == agent_append_heading(AGENT, tokyo_today()) + markdown_to_note_html("## Do\n\nIt.")`, `content_type == "html"`; `result.result_type == "task"`; status `accepted`.
  - `test_whitespace_only_note_creates_no_note`: `note_markdown: "  \n "` → task created, `count(session, ContextNote) == 0`.
  - `test_task_note_neutralises_raw_html_and_js_links`: `note_markdown: "<script>x</script> [a](javascript:alert(1))"` → note content contains neither `"<script"` nor `"javascript:"`.
  - `test_edit_clearing_task_note_creates_no_note_and_is_edited`: accept with the payload where `note_markdown` is `None` → no note, status `edited`.
  - `test_accept_goal_with_tasks_creates_tasks_and_notes`: goal with `due_date: "2026-12-01"` and two tasks (first with a note, second without, neither with a due date) → one goal; two tasks with `goal_id == goal.id`, titles in payload order, `due_date is None`; one note on the first task only; `result.result_type == "goal"`, `result.result_id == goal.id`.
  - `test_goal_with_invalid_edited_task_creates_nothing`: edited payload where `tasks[1].estimate_hours == 0` → `HTTPException` 422; `count` of `Goal`, `Task`, `ContextNote` all 0; `reload(...).status == "pending"`.
  - `test_goal_with_all_tasks_removed_creates_goal_only`: edited payload with `tasks: None` → goal created, `count(session, Task) == 0`, status `edited`.
  - `test_goal_edit_removing_one_task_is_edited`: payload with the first of two tasks removed → one task (the second), status `edited`.
  - `test_legacy_payload_without_new_keys_accepts_unedited`: store a `task` row whose `payload` is a dict built by hand **without** `note_markdown` (bypass `normalize_payload`; set the row's fields directly as `make_proposal` does) → accept with no body → status `accepted`, no note. Same for a `goal` row without `tasks`.

- [ ] **Step 6: Write the failing intake test** in `tests/test_agent_proposals_api.py`, following the file's existing POST helper: `test_post_goal_with_tasks_stores_normalised_tasks` — POST a `goal` with one task that has `note_markdown` → 201, stored `payload["tasks"][0]["note_markdown"]` equals what was sent and `payload["tasks"][0]["estimate_hours"] == 1.0`.

- [ ] **Step 7: Run** `uv run pytest tests/test_proposal_decisions.py tests/test_agent_proposals_api.py -q` — expected: the new tests FAIL (the intake test may already pass after Step 3; that is fine).

- [ ] **Step 8: Implement accept** in `proposal_service.py`:
  - `_create_input(..., exclude)` passes `exclude` to `parsed.model_dump(exclude_none=True, exclude=exclude)`.
  - `TASK`: build with `exclude={"note_markdown"}`, then `_create_task_note(session, user_id, row.agent_name, task.id, parsed.note_markdown)`.
  - `GOAL`: build the goal with `exclude={"tasks"}`; then for each item in `parsed.tasks or []`, in order, validate `TaskCreate` from `{**item.model_dump(exclude_none=True, exclude={"note_markdown"}), "goal_id": goal.id}` (a `ValidationError` becomes the same 422 as `_create_input`), `task_service.build(...)`, then `_create_task_note(...)`.
  - `_create_task_note` uses `create_note(session, user_id, NoteTarget(task_id=task_id))` and `append_agent_markdown(note, agent_name, markdown)`, then `session.add(note)` and `session.flush()`.
  - Use `isinstance(parsed, TaskProposalPayload)` / `isinstance(parsed, GoalProposalPayload)` to reach the new fields (mypy), not `assert`.

- [ ] **Step 9: Run** the full backend checks from Global Constraints — expected: all PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/humancompiler_api/proposal_payloads.py apps/api/src/humancompiler_api/proposal_service.py apps/api/tests/test_proposal_payloads.py apps/api/tests/test_proposal_decisions.py apps/api/tests/test_agent_proposals_api.py
git commit -m "feat(proposals): Add task notes and tasks inside goal proposals"
```

---

### Task 2: Web — show notes and goal tasks

**Files:**
- Modify: `apps/web/src/components/proposals/proposal-payload-view.tsx`
- Test: `apps/web/src/components/proposals/__tests__/proposal-card.test.tsx`

**Interfaces:**
- Consumes: the JSON fields from Task 1 (`payload.note_markdown`, `payload.tasks`).
- Produces: `function NoteDetails({ markdown }: { markdown: unknown }): ReactNode` (renders nothing when the text is empty), exported for reuse in Task 3's removed-task line if wanted.

- [ ] **Step 1: Write the failing tests** in `proposal-card.test.tsx`, using the file's existing `makeProposal`-style helper:
  - `renders a task note collapsed as plain text`: task payload with `note_markdown: "## 手順\n<b>x</b>"` → `screen.getByText('ノート（14 文字）')` exists (the summary); the text `"## 手順\n<b>x</b>"` is in the document as text (`getByText` with a function matcher on `textContent`); the enclosing `details` element has no `open` attribute; `document.querySelector('b')` is null.
  - `renders the tasks of a goal with their notes`: goal payload with two tasks (titles `A`, `B`; `A` has a note) → both titles visible, exactly one `ノート（…文字）` summary.
  - `renders a goal without tasks as before`: goal payload with `tasks: null` → no `Task` row label.

- [ ] **Step 2: Run** `pnpm test -- src/components/proposals/__tests__/proposal-card.test.tsx` — expected: the new tests FAIL.

- [ ] **Step 3: Implement** in `proposal-payload-view.tsx`:
  - `NoteDetails`: `<details><summary>ノート（{N} 文字）</summary><div className="mt-1 whitespace-pre-wrap break-words rounded border p-2 font-mono text-xs">{text}</div></details>`; `N` is `text.length`.
  - `task`: after `workFields(payload)`, a `Row label="ノート"` holding `NoteDetails` (the row hides itself when the note is empty).
  - `goal`: after `workFields(payload)`, when `asRecords(payload.tasks)` is non-empty, `Row label="Task"` holding an `<ol className="list-decimal space-y-2 pl-5">`; each `<li>` is a nested `<dl>` with `workFields(item)` and the note row.

- [ ] **Step 4: Run** the web checks from Global Constraints — expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/proposals/proposal-payload-view.tsx apps/web/src/components/proposals/__tests__/proposal-card.test.tsx
git commit -m "feat(inbox): Show task notes and the tasks of goal proposals"
```

---

### Task 3: Web — edit notes, remove and restore goal tasks

**Files:**
- Modify: `apps/web/src/lib/proposal-edit.ts`
- Modify: `apps/web/src/components/proposals/proposal-edit-form.tsx`
- Create: `apps/web/src/components/proposals/goal-task-items-editor.tsx`
- Test: `apps/web/src/lib/__tests__/proposal-edit.test.ts`, `apps/web/src/components/proposals/__tests__/proposal-edit-form.test.tsx`

**Interfaces:**
- Consumes: the JSON fields from Task 1.
- Produces (TypeScript, in `proposal-edit.ts`):
  - `EDITABLE_FIELDS.task` gains `'note_markdown'` (last).
  - `export const GOAL_TASK_FIELDS = ['title', 'description', 'estimate_hours', 'due_date', 'work_type', 'priority', 'note_markdown'] as const;`
  - `export const GOAL_TASK_REQUIRED_FIELDS: readonly string[] = ['title', 'estimate_hours'];`
  - `export interface TaskItemState { values: FormValues; removed: boolean }`
  - `export function initialTaskItems(payload: Record<string, unknown>): TaskItemState[]` — one entry per object in `payload.tasks` (none when it is not an array), `removed: false`.
  - `export function buildEditedTasks(originalTasks: Record<string, unknown>[], initial: TaskItemState[], current: TaskItemState[]): Record<string, unknown>[] | null` — null when no item is removed and no field changed; otherwise the kept items in order, each a copy of its original with only changed fields replaced.
  - `buildEditedPayload(kind, original, initial, current, tasks?: { initial: TaskItemState[]; current: TaskItemState[] })` — when `buildEditedTasks` returns an array, sets `payload.tasks` to it, or to `null` when it is empty; returns null only when neither the fields nor the tasks changed.
  - The private `toPayloadValue` takes the required-field list instead of the kind, so goal tasks use `GOAL_TASK_REQUIRED_FIELDS`.
- Produces (React): `GoalTaskItemsEditor({ items, onChange, disabled }: { items: TaskItemState[]; onChange: (next: TaskItemState[]) => void; disabled: boolean })` in `goal-task-items-editor.tsx`. The field controls move out of `EditFields` into an exported `FieldControl({ id, field, value, onChange, disabled })` in `proposal-edit-form.tsx` (or a small sibling module if that avoids a circular import), used by both.

- [ ] **Step 1: Write the failing helper tests** in `proposal-edit.test.ts`:
  - `reads goal tasks into item states` — two tasks → two states, `removed: false`, numbers as strings, missing note `''`.
  - `buildEditedTasks returns null when nothing changed`.
  - `buildEditedTasks drops a removed task and keeps the others unchanged` — removed index 0 → `[originalTasks[1]]` (deep-equal, including fields not in the form).
  - `buildEditedTasks replaces only the changed note` — change note of task 0 → its other fields equal the original.
  - `buildEditedTasks sends null for a cleared optional field of a task`.
  - `buildEditedPayload sends tasks null when every task is removed`.
  - `buildEditedPayload includes note_markdown for a task` — changed note → `payload.note_markdown` is the new text; cleared → `null`.

- [ ] **Step 2: Run** `pnpm test -- src/lib/__tests__/proposal-edit.test.ts` — expected: FAIL.

- [ ] **Step 3: Implement the helpers** in `proposal-edit.ts` as in Interfaces.

- [ ] **Step 4: Run** the same command — expected: PASS.

- [ ] **Step 5: Write the failing form tests** in `proposal-edit-form.test.tsx`, using the file's `makeProposal`, `renderWithClient`, `submit()` and `mockAccept`:
  - `edits the note of a task proposal` — change `ノート（Markdown）` → accept called with a payload whose `note_markdown` is the new text and whose other fields are unchanged.
  - `sends a plain accept for a legacy task payload without note_markdown` — payload without the key, submit untouched → accept body `{}`.
  - `removes a task from a goal proposal and sends the rest` — goal with tasks `A`, `B`; click the first `この Task を外す`; submit → `payload.tasks` is `[B]`.
  - `restores a removed task` — remove then `元に戻す`; submit → body `{}`.
  - `removing every task sends tasks null`.
  - `disables submit while a kept task lacks a title` — clear task `A`'s title → submit disabled.
  - `a removed task with an empty title does not block submit` — clear `A`'s title, then remove `A` → submit enabled; payload `tasks` is `[B]`.

- [ ] **Step 6: Run** `pnpm test -- src/components/proposals/__tests__/proposal-edit-form.test.tsx` — expected: the new tests FAIL.

- [ ] **Step 7: Implement the form**:
  - `FIELD_SPECS.note_markdown = { label: 'ノート（Markdown）', control: 'textarea', rows: 12 }`.
  - `EditFields` keeps `taskItems` state (from `initialTaskItems(original)`, plus a frozen copy as the initial value) when `kind === 'goal'`, renders `GoalTaskItemsEditor` after the goal fields, includes `{ initial, current: taskItems }` in `buildEditedPayload`, and adds to `canSubmit`: every item with `removed === false` has non-blank `GOAL_TASK_REQUIRED_FIELDS`.
  - `GoalTaskItemsEditor`: for a kept item, a `<fieldset>` with legend `Task {i}`, one labelled control per `GOAL_TASK_FIELDS` entry (required ones marked as in `FormField`), and an outline button `この Task を外す`. For a removed item, one line `外す: {title}` with a ghost button `元に戻す`. Labels must stay unique per item (use `useId` plus the index).

- [ ] **Step 8: Run** the web checks from Global Constraints — expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/proposal-edit.ts apps/web/src/lib/__tests__/proposal-edit.test.ts apps/web/src/components/proposals/proposal-edit-form.tsx apps/web/src/components/proposals/goal-task-items-editor.tsx apps/web/src/components/proposals/__tests__/proposal-edit-form.test.tsx
git commit -m "feat(inbox): Edit task notes and remove tasks from goal proposals"
```

---

## After the tasks

- Final whole-branch review, then the full suites: `cd apps/api && uv run pytest -q` and `cd apps/web && pnpm test`.
- Open the PR (`Closes #412`), no migration. Deployment notes: none beyond the normal deploy.
- Manual check after deploy (user or me with the test token `~/.config/humancompiler/proposal-test-token`): send a `task` with a note and a `goal` with two tasks; in the inbox, open the notes, edit one note, remove one task, accept; confirm the created tasks and notes.
