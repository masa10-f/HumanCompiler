# Agent Gateway PR3b: Agent Read API の残りのエンドポイントと context export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/agent/v1` に quick-tasks、logs、work-sessions、context-notes、daily-plans の一覧と、project / goal の context export を足し、spec の G2 をすべて実装する。

**Architecture:** PR3a の `routers/agent_v1.py` に追記する。一覧は PR3a の `agent_pagination.paginate` を使い、所有の判定は既存のサービスの `_get_user_filter` を使う。context notes だけは、`user_id` に加えて親（project / goal / task）の所有も確かめる条件をこのルーターに置く。daily plans は `AgentDailyPlanResponse` を返し、ページ内の schedule を1回の問い合わせで読む。context export は既存の `build_project_context_export` / `build_goal_context_export` と、`routers/context_export.py` の `get_export_options` / `ContextExportResponse` をそのまま使う。

**Tech Stack:** FastAPI 0.116 / Starlette 0.47、SQLModel（テストは SQLite in-memory）、Pydantic 2、pytest

**Spec:** `docs/design/agent-gateway.md`（「G2: Agent Read API」、「テスト」の Read API と daily plans の行）。前提: `docs/plans/2026-10-25-agent-gateway-pr3a.md`（PR3a がマージ済みであること）。トラッキング: masa10-f/HumanCompiler#360

## 決めたこと

- **ブランチは PR3a のマージ後に `main` から作る**
- **context note の所有**: `ContextNote.user_id == user_id` かつ、設定されている親ごとに `project_id IS NULL OR project_id IN (自分の project)`、`goal_id` と `task_id` も同様。親がどれも設定されていないノートは `user_id` だけで判定して返す
- **context notes の絞り込み**（`project_id`、`goal_id`、`task_id`）は、その列との一致だけを見る（project を指定しても、配下の goal や task に付いたノートは含めない）。Web の notes API と同じ
- **work sessions の `task`（`TaskSummary`）は返す**。1件ごとに問い合わせが増えないよう `selectinload(WorkSession.task)` を付ける
- **daily plans の一覧は文書がある日だけ**を返す（schedule だけある日は返さない）。`date_from > date_to` は 422 にせず空の一覧
- **`AgentDailyPlanResponse` は `routers/agent_v1.py` に置く**（`routers/daily_plans.py` の `DailyPlanResponse` を継承し、`id: UUID` と `updated_at: datetime` を必須にする）。`date` は `document.date.isoformat()`、`document` は `DailyPlanDocumentV1.model_validate(document.document_json)`
- **context export の他人の ID と存在しない ID**は、既存の `ResourceNotFoundError` がそのまま 404 になる
- **埋め込む値は `updated_at` を進めない**（PR3a と同じ方針）: daily plan の `schedule`（書き込み経路が 5 か所以上ある）と work session の `task` の要約は、変わっても親の `updated_at` は進まない。`INCREMENTAL_SYNC_GUIDE` とは別に、daily-plans の説明に「schedule の変更を拾うには日付の範囲で読み直す」と書き、spec にも書く

## Global Constraints

- 作業ディレクトリは `apps/api`。テストは `uv run pytest`。プッシュ前のチェックは `CLAUDE.md` の「Backend Changes」
- commit は英語・Conventional Commits。`--amend` は使わない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 各エンドポイントで `require_scope` を使う。スコープは quick-tasks が `quick_tasks:read`、logs が `logs:read`、work-sessions が `work_sessions:read`、context-notes が `notes:read`、daily-plans が `daily_plans:read`、context export が `context:read`
- 返すデータは常に `principal.user_id` が所有するものに限る。所有の判定は spec の表のとおり
- 一覧の `limit` は既定 100、最大 200。daily-plans だけは既定 7、最大 31（`page_params(7, 31)`）
- 一覧のレスポンスは PR3a の `AgentPage`。並び順は `(updated_at, id)` の昇順
- テストに JWT のような文字列を直接書かない
- preview 用の DB は作らない。PR はマージしない
- `apps/api/src` で `assert` を使わない（CI の bandit は B101 を除外しない）

## Review Focus

1. **親が1つも設定されていない context note**: `user_id` が自分なら返り、他人なら返らないこと → Task 2 の `test_note_without_parent_is_returned_to_its_owner_only`
2. **schedule のない日の daily plan**: `schedule` が null で返り、他の日の schedule が混ざらないこと → Task 3 の `test_daily_plan_schedule_matches_its_own_date`
3. **`date_from` が `date_to` より後**: 200 で空の一覧 → Task 3 の `test_daily_plans_with_reversed_range_are_empty`
4. **絞り込みに他人の task の ID を指定する**（`/logs?task_id=`、`/work-sessions?task_id=`）: 空の一覧 → Task 1 の `test_task_filters_with_other_users_task_return_empty`
5. **context export のオプションが範囲外**（`period_days=0`）: 既存の API と同じく 422 → Task 4 の `test_context_export_validates_options`

---

## File Structure

| ファイル | 役割 |
|---|---|
| Modify `apps/api/src/humancompiler_api/routers/agent_v1.py` | 6 つの一覧と 2 つの context export、`AgentDailyPlanResponse` |
| Modify `apps/api/tests/agent_api_helpers.py` | `seed_quick_task`、`seed_log`、`seed_work_session`、`seed_note`、`seed_daily_plan`、`seed_schedule` |
| Create `apps/api/tests/test_agent_v1_records.py` | 追加するエンドポイントのテスト |
| Modify `docs/design/agent-gateway.md` | 上の「決めたこと」 |

ブランチ: `feat/agent-read-api-records`（PR3a のマージ後に `main` から作る）

---

### Task 1: quick-tasks、logs、work-sessions

**Files:**
- Modify: `apps/api/src/humancompiler_api/routers/agent_v1.py`、`apps/api/tests/agent_api_helpers.py`
- Test: `apps/api/tests/test_agent_v1_records.py`

**Interfaces:**
- Consumes: PR3a の `page_params`、`paginate`、`AgentPage`、`require_scope`、`agent_api_helpers`（`client`、`use_session`、`seed_user`、`issue_token`、`bearer`、`seed_project`、`seed_goal`、`seed_task`）。`quick_task_service._get_user_filter`、`log_service._get_user_filter`、`work_session_service._get_user_filter`
- Produces:
  - `GET /quick-tasks` → `AgentPage[QuickTaskResponse]`、クエリ `status: TaskStatus | None`
  - `GET /logs` → `AgentPage[LogResponse]`、クエリ `task_id: UUID | None`
  - `GET /work-sessions` → `AgentPage[WorkSessionResponse]`、クエリ `task_id: UUID | None`、statement に `selectinload(WorkSession.task)`
  - ヘルパー: `seed_quick_task(session, owner_id, *, status=TaskStatus.PENDING, updated_at=None) -> QuickTask`、`seed_log(session, task, *, updated_at=None) -> Log`、`seed_work_session(session, user_id, task, *, updated_at=None) -> WorkSession`

- [ ] **Step 1: 失敗するテストを書く**（ユーザー A と B を作る）

```python
def test_list_quick_tasks_returns_only_own_and_filters_by_status(session):

def test_list_logs_returns_only_own_and_filters_by_task(session):
    # A の task 2 つに log、B の task に log → A の log だけ。task_id → その task の log だけ

def test_list_work_sessions_returns_only_own_and_filters_by_task(session):
    # items[*]["task"]["id"] がその session の task_id と一致する

def test_task_filters_with_other_users_task_return_empty(session):
    # /logs?task_id=<B の task>、/work-sessions?task_id=<B の task> → items == []

def test_edited_log_appears_in_incremental_sync(session):
    # updated_at = 2026-01-01T00:00Z の log。updated_since=2026-01-02T00:00Z → items == []
    # log_service.update_log(...) で内容を変える → 同じ updated_since で、その log が 1 件返る

@pytest.mark.parametrize("path, scope", [
    ("/api/agent/v1/quick-tasks", "quick_tasks:read"),
    ("/api/agent/v1/logs", "logs:read"),
    ("/api/agent/v1/work-sessions", "work_sessions:read"),
])
def test_record_lists_require_their_scopes(session, path, scope):
    # projects:read だけのトークン → 403、detail == f"Missing required scope: {scope}"
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_v1_records.py -v` → 404 で FAIL
- [ ] **Step 3: ヘルパーと 3 つの一覧を実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add quick tasks, logs and work sessions to the Agent Read API`

---

### Task 2: context-notes

**Files:**
- Modify: `apps/api/src/humancompiler_api/routers/agent_v1.py`、`apps/api/tests/agent_api_helpers.py`
- Test: `apps/api/tests/test_agent_v1_records.py`（追記）

**Interfaces:**
- Consumes: Task 1 のもの。`project_service._get_user_filter`、`goal_service._get_user_filter`、`task_service._get_user_filter`
- Produces:
  - `def _owned_note_filter(user_id: UUID) -> ColumnElement[bool]`（上の「決めたこと」の条件。`Project.id`、`Goal.id`、`Task.id` を各サービスの条件で選ぶ副問い合わせを使う）
  - `GET /context-notes` → `AgentPage[ContextNoteResponse]`、クエリ `project_id`、`goal_id`、`task_id`（どれも `UUID | None`）
  - ヘルパー: `seed_note(session, user_id, *, project=None, goal=None, task=None, updated_at=None) -> ContextNote`

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_list_notes_returns_only_own_and_filters_by_parent(session):
    # A の project / goal / task にノート、B にもノート → A のものだけ
    # project_id → project に付いたノートだけ（配下の goal / task のノートは含まない）。goal_id、task_id も同様

def test_note_with_foreign_parent_is_not_returned(session):
    # user_id は A だが project が B のもの、goal が B のもの、task が B のもの、の 3 件 → どれも返らない
    # project_id=<B の project> で絞り込んでも返らない

def test_note_without_parent_is_returned_to_its_owner_only(session):
    # 親なしのノートを A と B に 1 件ずつ → A のトークンでは A の 1 件だけ

def test_notes_require_notes_read_scope(session):
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_v1_records.py -k note -v` → 404 で FAIL
- [ ] **Step 3: `_owned_note_filter` と一覧を実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add context notes to the Agent Read API`

---

### Task 3: daily-plans

**Files:**
- Modify: `apps/api/src/humancompiler_api/routers/agent_v1.py`、`apps/api/tests/agent_api_helpers.py`
- Test: `apps/api/tests/test_agent_v1_records.py`（追記）

**Interfaces:**
- Consumes: Task 1 のもの。`routers.daily_plans.DailyPlanResponse`、`DailyPlanDocumentV1`
- Produces:
  - `class AgentDailyPlanResponse(DailyPlanResponse): id: UUID; updated_at: datetime`
  - `GET /daily-plans` → `AgentPage[AgentDailyPlanResponse]`、クエリ `date_from: date | None`、`date_to: date | None`、`Depends(page_params(7, 31))`。ページの行を読んだ後、`Schedule.user_id == user_id` かつ `Schedule.date.in_([datetime.combine(d, time.min) for d in ページの日付])` を1回で読み、日付で対応させる（`routers/daily_plans._get_schedule` と同じ日付の表し方）
  - ヘルパー: `seed_daily_plan(session, user_id, day: date, *, updated_at=None) -> DailyPlanDocument`（`document_json` は `DailyPlanDocumentV1().model_dump(mode="json")`）、`seed_schedule(session, user_id, day: date, plan_json: dict) -> Schedule`

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_daily_plans_always_have_id_and_updated_at(session):
    # A の文書 3 件 → 各 item の id と updated_at が None でない。B の文書は返らない

def test_daily_plans_filter_by_date_range_and_default_limit(session):
    # 10 日分 → limit なしで 7 件と next_cursor。date_from / date_to の両端を含む。limit=32 → 422

def test_daily_plans_with_reversed_range_are_empty(session):  # date_from > date_to → 200、items == []

def test_daily_plan_schedule_matches_its_own_date(session):
    # 2 日分の文書。schedule は 1 日目だけ → 1 日目の schedule は seed した plan_json、2 日目は None

def test_daily_plan_schedules_are_loaded_in_one_query(session):
    # 31 日分の文書と schedule。engine の before_cursor_execute で文を集め、
    # limit=31 の 1 回の呼び出しで "FROM schedules" を含む文がちょうど 1 つ

def test_daily_plans_require_daily_plans_read_scope(session):
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_v1_records.py -k daily -v` → 404 で FAIL
- [ ] **Step 3: `AgentDailyPlanResponse` と一覧を実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add daily plans to the Agent Read API`

---

### Task 4: context export

**Files:**
- Modify: `apps/api/src/humancompiler_api/routers/agent_v1.py`
- Test: `apps/api/tests/test_agent_v1_records.py`（追記）

**Interfaces:**
- Consumes: `build_project_context_export`、`build_goal_context_export`（`ai/context_export.py`）、`get_export_options`、`ContextExportResponse`（`routers/context_export.py`）
- Produces:
  - `GET /context-export/projects/{project_id}` → `ContextExportResponse`、`options: Annotated[ContextExportOptions, Depends(get_export_options)]`、スコープ `context:read`
  - `GET /context-export/goals/{goal_id}` → 同上

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_context_export_returns_markdown_for_own_project_and_goal(session):
    # A の project と goal → 200、markdown に project と goal のタイトルが入る

def test_context_export_of_other_user_or_missing_is_404(session):
    # B の project / goal、uuid4() → すべて 404

def test_context_export_validates_options(session):  # period_days=0 → 422

def test_context_export_requires_context_read_scope(session):
    # projects:read、goals:read、tasks:read、notes:read を持つが context:read のないトークン → 403
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_v1_records.py -k context_export -v` → 404 で FAIL
- [ ] **Step 3: 2 つのエンドポイントを実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add context export to the Agent Read API`

---

### Task 5: spec と #360 の更新、全体のチェック、PR

**Files:**
- Modify: `docs/design/agent-gateway.md`

- [ ] **Step 1: spec を更新する** — 「共通」に context note の親なしの扱いと絞り込みの意味、work sessions の `task` を含めること、daily plans は文書がある日だけ返すこと、`date_from > date_to` は空の一覧になることを書く
- [ ] **Step 2: Commit** — `docs(agent): Record Read API decisions for notes and daily plans`
- [ ] **Step 3: バックエンドのチェックをすべて流す**（`apps/api`）
  Run: `ruff check . --fix && ruff format . && mypy src && bandit -r src && uv run pytest -v`
  Expected: すべて成功
- [ ] **Step 4: push して PR を作る**（タイトル `feat(agent): Add remaining Agent Read API endpoints and context export`、本文は英語。`Refs #360`）
  本文の **Deployment Notes**: マイグレーションはない。デプロイ後、`daily_plans:read` と `context:read` を持つトークンで `GET /api/agent/v1/daily-plans` と `GET /api/agent/v1/context-export/projects/{id}` を呼び、200 になることを確かめる
- [ ] **Step 5: #360 を更新する** — PR3b に PR へのリンクを足し、Decisions に「親のない context note は `user_id` だけで判定する」「daily plans は文書がある日だけ」を理由付きで追記する
