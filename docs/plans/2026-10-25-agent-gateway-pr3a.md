# Agent Gateway PR3a: Agent Read API の共通部分と projects / goals / tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェントトークンで読む `/api/agent/v1` を作り、差分取得の共通部分（`updated_since`、keyset `cursor`、`limit`）と、`/me`、projects、goals、tasks の一覧・個別取得を用意する。

**Architecture:** 差分取得は新しいモジュール `agent_pagination.py` にまとめる（cursor のエンコードとデコード、クエリパラメータの依存関数、`(updated_at, id)` の keyset で1ページ読む関数、レスポンスの `AgentPage`）。エンドポイントは新しいルーター `routers/agent_v1.py` に置き、認証は PR1 の `require_scope` / `get_agent_principal` を使う。所有の判定は、既存のサービスの `_get_user_filter` をそのまま使う。

**Tech Stack:** FastAPI 0.116 / Starlette 0.47、SQLModel（テストは SQLite in-memory）、Pydantic 2、pytest

**Spec:** `docs/design/agent-gateway.md`（「G2: Agent Read API」の「共通」「差分取得の仕様」「エンドポイント」、「セキュリティ」、「テスト」の Read API と移行の行）。トラッキング: masa10-f/HumanCompiler#360 の PR3 の節。続き: `docs/plans/2026-10-25-agent-gateway-pr3b.md`

## 決めたこと

- **PR3 を2つに分ける**（ユーザー確認済み）。PR3a は共通部分と `/me`、projects、goals、tasks。PR3b は quick-tasks、logs、work-sessions、context-notes、daily-plans、context export。PR3b は PR3a のマージ後に `main` から作る
- **マイグレーションはない**。`logs.updated_at`、トリガー、`(updated_at, id)` インデックスは 035 で本番に入っている
- **所有の判定は既存のサービスの `_get_user_filter(user_id)` を使う**（`project_service`、`goal_service`、`task_service`）。Web の API と同じ判定を1か所に保つため。spec の所有の表と同じ内容になっている
- **cursor の形式**: `{"u": "<updated_at を UTC の ISO 8601 で>", "i": "<id>"}` の JSON を URL-safe base64（`=` なし）にしたもの。中身は解釈しない前提だが、署名はしない（他人のデータには所有の条件で届かないので、改ざんされても困らない）
- **日時は UTC にそろえる**。`updated_since` はタイムゾーン付きで受けて UTC に変換してから使う。DB から読んだ naive な日時（SQLite）は UTC とみなして cursor に入れる
- **次のページの有無は `limit + 1` 件読んで判定する**。ちょうど `limit` 件で終わるときに、空のページを1回余計に返さないため
- **絞り込みに他人の ID を指定したとき**（`/tasks?project_id=<他人のもの>` など）は 404 ではなく空の一覧を返す。存在の有無を漏らさず、実装も所有の条件と絞り込みを AND するだけで済む
- **Goal と Task の `dependencies` は返す**（既存の `GoalResponse` / `TaskResponse` のとおり）。1件ごとに問い合わせが増えないよう、goals は `selectinload`、tasks は既存の `build_task_responses_with_dependencies` でまとめて読む
- **クライアント向けの指針は英語で OpenAPI の description に書く**（使い方ガイドは PR4）

## Global Constraints

- 作業ディレクトリは `apps/api`。テストは `uv run pytest`。プッシュ前のチェックは `CLAUDE.md` の「Backend Changes」（`ruff check . --fix`、`ruff format .`、`mypy src`、`bandit -r src -s B101`、`pytest -v`）
- commit は英語・Conventional Commits。`--amend` は使わない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 新しいファイルには SPDX ヘッダー（`.spdx-header-python.txt`）を付ける
- prefix は `/api/agent/v1`。`/me` 以外の各エンドポイントで `require_scope` を使う（`/me` は `get_agent_principal`）
- 返すデータは常に `principal.user_id` が所有するものに限る。個別取得で、所有していない ID と存在しない ID はどちらも 404
- `updated_since`: タイムゾーン付きの ISO 8601。`updated_at >= updated_since`。タイムゾーンがなければ 422
- `cursor`: デコードできない値、UUID でない `id`、タイムゾーンのない日時を含むものは 422（500 にしない）
- `limit`: 既定 100、最大 200（daily-plans だけは既定 7、最大 31。PR3b）
- 並び順は `(updated_at, id)` の昇順に固定。レスポンスは `{"items": [...], "next_cursor": "…" | null}`
- テストに JWT のような文字列を直接書かない（GitGuardian が検出する）。実行時に組み立てる
- preview 用の DB は作らない。PR はマージしない

## Review Focus

1. **最後のページがちょうど `limit` 件**: `next_cursor` が null になり、空のページを余計に返さないこと → Task 1 の `test_last_page_exactly_full_has_null_cursor`
2. **`updated_since` が UTC 以外のオフセット**（`+09:00`）: 同じ時刻の UTC 表記と同じ結果になり、境界の行（`updated_at == updated_since`）が含まれること → Task 1 の `test_updated_since_is_inclusive_and_offset_aware`
3. **base64 としては正しいが中身が壊れた cursor**（JSON が配列、キーがない、`i` が UUID でない、`u` が naive）: 500 ではなく 422 → Task 1 の `test_page_params_rejects_bad_cursor_with_422`
4. **絞り込みに他人の project / goal の ID を指定する**: 空の一覧で、他人のデータもエラーも返らないこと → Task 3 の `test_filters_with_other_users_parent_return_empty`
5. **Read API に Supabase の JWT を送る**: 401 になること（ユーザーのセッションでエージェントの API を使えない） → Task 2 の `test_me_rejects_supabase_jwt`

---

## File Structure

| ファイル | 役割 |
|---|---|
| Create `apps/api/src/humancompiler_api/agent_pagination.py` | cursor、`PageParams` と依存関数、`paginate`、`AgentPage` |
| Create `apps/api/src/humancompiler_api/routers/agent_v1.py` | `/api/agent/v1` のエンドポイント（PR3b でも追記する） |
| Modify `apps/api/src/humancompiler_api/models.py` | `AgentMeResponse` |
| Modify `apps/api/src/humancompiler_api/main.py` | `agent_v1` ルーターの登録 |
| Create `apps/api/tests/agent_api_helpers.py` | Read API のテストで共有する client、ユーザー、トークン、行の作成（PR3b でも使う） |
| Create `apps/api/tests/test_agent_pagination.py` | 共通部分のテスト |
| Create `apps/api/tests/test_agent_v1_planning.py` | `/me`、projects、goals、tasks のテスト |
| Modify `apps/api/tests/test_agent_audit.py`、`tests/test_hook_tokens.py` | 新しいルートに合わせた修正、移行トークンの 403 |
| Modify `docs/design/agent-gateway.md` | PR3 の分割と上の「決めたこと」 |

ブランチ: `feat/agent-read-api-core`（`main` から作る）

---

### Task 1: 差分取得の共通部分

**Files:**
- Create: `apps/api/src/humancompiler_api/agent_pagination.py`
- Test: `apps/api/tests/test_agent_pagination.py`

**Interfaces:**
- Produces（すべて `agent_pagination.py`）:
  - `DEFAULT_LIMIT = 100`、`MAX_LIMIT = 200`
  - `def encode_cursor(updated_at: datetime, row_id: UUID) -> str`（naive は UTC とみなす）
  - `def decode_cursor(cursor: str) -> tuple[datetime, UUID]`（壊れていれば `ValueError`。戻り値の日時は UTC の aware）
  - `@dataclass(frozen=True) class PageParams: updated_since: datetime | None; after: tuple[datetime, UUID] | None; limit: int`（日時はどちらも UTC の aware）
  - `def page_params(default_limit: int = DEFAULT_LIMIT, max_limit: int = MAX_LIMIT) -> Callable[..., PageParams]`。返す依存関数はクエリ `updated_since: datetime | None`、`cursor: str | None`、`limit: int = Query(default_limit, ge=1, le=max_limit)` を受け、タイムゾーンのない `updated_since` は `HTTPException(422, "updated_since must include a timezone")`、`decode_cursor` の `ValueError` は `HTTPException(422, "Invalid cursor")`
  - `def paginate(session: Session, statement: SelectOfScalar[Any], model: Any, params: PageParams) -> tuple[list[Any], str | None]`。`model` は `updated_at` と `id` の列を持つテーブルモデル。`statement` に `updated_at >= updated_since`、`or_(updated_at > u, and_(updated_at == u, id > i))`、`order_by(updated_at, id)`、`limit(limit + 1)` を足して読み、`limit` 件を超えたら最後に返す行から `next_cursor` を作る
  - `class AgentPage(BaseModel, Generic[ItemT]): items: list[ItemT]; next_cursor: str | None`

テストの行は `Project` を直接入れて `updated_at` を指定する（`paginate` はモデルに依存しない）。依存関数のテストは、`test_agent_auth.py` の `build_app` と同じく小さな `FastAPI()` に `Depends(page_params())` と `Depends(page_params(7, 31))` のエンドポイントを置いて呼ぶ。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_cursor_round_trips():
    # aware の UTC 日時と uuid4 → decode(encode(...)) が同じ値
    # naive の日時を渡すと UTC として戻る

@pytest.mark.parametrize("cursor", [...])
def test_decode_cursor_rejects_garbage(cursor):
    # "", "!!!", base64("[]"), base64('{"u": "2026-01-01T00:00:00+00:00"}')、
    # base64('{"u": "2026-01-01T00:00:00+00:00", "i": "nope"}')、
    # base64('{"u": "2026-01-01T00:00:00", "i": "<uuid>"}')（naive）→ すべて ValueError

def test_pages_follow_updated_at_then_id_without_gaps_or_duplicates(session):
    # 6 行。うち 3 行は同じ updated_at。limit=2 で next_cursor をたどる
    # → 連結した id の列が (updated_at, id) で並べたものと一致し、重複なし、最後の next_cursor は None

def test_last_page_exactly_full_has_null_cursor(session):
    # 4 行、limit=2 → 2 ページ目の next_cursor is None

def test_updated_since_is_inclusive_and_offset_aware(session):
    # updated_at = 2026-01-01T00:00:00Z の行
    # updated_since = 2026-01-01T09:00:00+09:00 → 含まれる
    # updated_since = 2026-01-01T00:00:00.000001+00:00 → 含まれない

def test_page_params_rejects_naive_updated_since_with_422():

def test_page_params_rejects_bad_cursor_with_422():
    # decode テストと同じ壊れた値をクエリに付ける → どれも 422、500 にならない

def test_page_params_limit_bounds():
    # 既定のエンドポイント: limit なし → 100、0 → 422、201 → 422、200 → 200
    # page_params(7, 31) のエンドポイント: limit なし → 7、32 → 422
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_pagination.py -v` → `ModuleNotFoundError: humancompiler_api.agent_pagination` で FAIL
- [ ] **Step 3: `agent_pagination.py` を実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add keyset pagination for the Agent Read API`

---

### Task 2: ルーター、`/me`、projects

**Files:**
- Create: `apps/api/src/humancompiler_api/routers/agent_v1.py`、`apps/api/tests/agent_api_helpers.py`、`apps/api/tests/test_agent_v1_planning.py`
- Modify: `apps/api/src/humancompiler_api/models.py`、`main.py`、`apps/api/tests/test_agent_audit.py`

**Interfaces:**
- Consumes: Task 1 の `page_params`、`paginate`、`AgentPage`、`PageParams`。`require_scope`、`get_agent_principal`、`AgentPrincipal`（`agent_auth.py`）。`project_service.get_project`、`project_service._get_user_filter`
- Produces:
  - `models.AgentMeResponse(BaseModel)`: `token_name: str`、`token_prefix: str`、`scopes: list[str]`（昇順）、`user_id: UUID`
  - `routers/agent_v1.py`: `router = APIRouter(prefix="/api/agent/v1", tags=["agent"])`、英語の定数 `INCREMENTAL_SYNC_GUIDE`（次回の `updated_since` は取得した最大の `updated_at` から 5 分引くこと、`(id, updated_at)` が同じ行は重複として捨てること、削除は差分に現れないので全件の ID の集合を比べること）を一覧のエンドポイントの `description` に入れる
  - `GET /me` → `AgentMeResponse`（`session.get(AgentToken, principal.token_id).name` を使う）
  - `GET /projects` → `AgentPage[ProjectResponse]`、クエリ `status: ProjectStatus | None`、スコープ `projects:read`
  - `GET /projects/{project_id}`（`project_id: UUID`）→ `ProjectResponse`、なければ `HTTPException(404, "Project not found")`
  - `tests/agent_api_helpers.py`: `client`、`use_session(session)`（`get_session` を上書き。テスト側の autouse fixture で外す）、`seed_user(session, user_id) -> UUID`、`issue_token(session, user_id, scopes: list[AgentScope], name="agent") -> str`（secret を返す）、`bearer(token) -> dict[str, str]`、`seed_project(session, owner_id, *, status=ProjectStatus.PENDING, updated_at=None) -> Project`、`seed_goal(session, project, *, status=GoalStatus.PENDING, updated_at=None) -> Goal`、`seed_task(session, goal, *, status=TaskStatus.PENDING, estimate_hours=Decimal("1"), updated_at=None) -> Task`

`main.py` では `agent_tokens.router` の隣に `app.include_router(agent_v1.router)` を足す（prefix はルーター側に持つ）。

`/api/agent/v1/tasks/{task_id}` ができるので、`test_agent_audit.py::test_unmatched_route_is_not_audited` のパスを `/api/agent/v1/no-such-route/{uuid4()}` に変える。

- [ ] **Step 1: 失敗するテストを書く**（`test_agent_v1_planning.py`。ユーザー A と B を作る）

```python
def test_me_returns_token_identity(session):
    # A の quick_tasks:write だけのトークン（読み取りスコープなし）→ 200
    # token_name、token_prefix、scopes == ["quick_tasks:write"]、user_id == A

def test_me_rejects_supabase_jwt(session):
    # header/payload/signature を base64url で実行時に組み立てた JWT 形式の文字列を Bearer で送る → 401

def test_list_projects_returns_only_own(session):
    # A に 2 件、B に 1 件。A のトークン → A の 2 件だけ、next_cursor is None

def test_list_projects_filters_by_status(session):

def test_get_project_of_other_user_or_missing_is_404(session):
    # B の project の ID、uuid4() → どちらも 404、detail == "Project not found"

def test_projects_require_projects_read_scope(session):
    # tasks:read だけのトークン → 一覧も個別取得も 403、detail == "Missing required scope: projects:read"

def test_agent_read_is_audited_with_route_template(session):
    # GET /api/agent/v1/projects/{id} → agent_audit_logs に 1 行
    # route == "/api/agent/v1/projects/{project_id}"、required_scope == "projects:read"、status_code == 200

def test_list_endpoints_document_incremental_sync():
    # app.openapi()["paths"]["/api/agent/v1/projects"]["get"]["description"] に "5 minutes" が入る
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_v1_planning.py -v` → `ModuleNotFoundError: agent_api_helpers` や 404 で FAIL
- [ ] **Step 3: ヘルパー、`AgentMeResponse`、ルーターを実装し、`main.py` に登録する。`test_agent_audit.py` のパスを直す**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS。`uv run pytest tests/test_agent_audit.py tests/test_agent_auth.py -v` も PASS
- [ ] **Step 5: Commit** — `feat(agent): Add /api/agent/v1 with /me and projects`

---

### Task 3: goals と tasks

**Files:**
- Modify: `apps/api/src/humancompiler_api/routers/agent_v1.py`
- Test: `apps/api/tests/test_agent_v1_planning.py`（追記）、`apps/api/tests/test_hook_tokens.py`（追記）

**Interfaces:**
- Consumes: Task 1、Task 2 のもの。`goal_service.get_goal` / `_get_user_filter`、`task_service.get_task` / `_get_user_filter`、`routers.tasks.build_task_responses_with_dependencies(session, tasks, owner_id) -> list[TaskResponse]`
- Produces:
  - `GET /goals` → `AgentPage[GoalResponse]`、クエリ `project_id: UUID | None`、`status: GoalStatus | None`、スコープ `goals:read`。statement に `selectinload(Goal.dependencies).selectinload(GoalDependency.depends_on_goal)` を付ける
  - `GET /goals/{goal_id}` → `GoalResponse`、なければ 404 `"Goal not found"`
  - `GET /tasks` → `AgentPage[TaskResponse]`、クエリ `project_id: UUID | None`（`Task.goal_id.in_(select(Goal.id).where(Goal.project_id == project_id))`）、`goal_id: UUID | None`、`status: TaskStatus | None`、スコープ `tasks:read`
  - `GET /tasks/{task_id}` → `TaskResponse`、なければ 404 `"Task not found"`

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_list_goals_returns_only_own_and_filters(session):
    # A の project 2 つに goal を置き、B にも goal を置く
    # 絞り込みなし → A の goal だけ。project_id → その project の goal だけ。status → 一致するものだけ

def test_list_tasks_returns_only_own_and_filters(session):
    # project_id、goal_id、status のそれぞれで絞り込み、B の task は出ない

def test_filters_with_other_users_parent_return_empty(session):
    # A のトークンで /goals?project_id=<B の project>、/tasks?project_id=<B>、/tasks?goal_id=<B の goal> → 200、items == []

def test_get_goal_and_task_of_other_user_or_missing_is_404(session):

def test_goal_and_task_responses_include_dependencies(session):
    # A の goal 間と task 間に依存を作る → 一覧と個別取得の dependencies に depends_on_* の id が入る
    # goal の estimate_hours は配下の task の見積もりの合計

def test_goals_and_tasks_require_their_scopes(session):
    # projects:read だけのトークン → /goals は "goals:read"、/tasks は "tasks:read" の 403
```

`test_hook_tokens.py` に追記（`insert_agent_token` で `hc_hook_` 形式の移行トークンを作る既存のテストと同じ準備）:

```python
def test_migrated_hook_token_cannot_read_tasks(session):
    # 同じ移行トークンで GET /api/agent/v1/tasks → 403、detail == "Missing required scope: tasks:read"
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_v1_planning.py tests/test_hook_tokens.py -v` → 新しいテストが 404 で FAIL
- [ ] **Step 3: goals と tasks のエンドポイントを実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add goals and tasks to the Agent Read API`

---

### Task 4: spec と #360 の更新、全体のチェック、PR

**Files:**
- Modify: `docs/design/agent-gateway.md`

- [ ] **Step 1: spec を更新する**
  - 「実装順序」の PR3 を PR3a（共通部分、`/me`、projects、goals、tasks）と PR3b（残りのエンドポイントと context export）に分ける
  - 「差分取得の仕様」: cursor の形式（署名しない理由）、日時を UTC にそろえること、絞り込みに他人の ID を指定したときは空の一覧になること
- [ ] **Step 2: Commit** — `docs(agent): Split PR3 and record Read API pagination decisions`
- [ ] **Step 3: バックエンドのチェックをすべて流す**（`apps/api`）
  Run: `ruff check . --fix && ruff format . && mypy src && bandit -r src -s B101 && uv run pytest -v`
  Expected: すべて成功
- [ ] **Step 4: push して PR を作る**（タイトル `feat(agent): Add Agent Read API core with projects, goals and tasks`、本文は英語。`Refs #360`）
  本文の **Deployment Notes**: マイグレーションはない。デプロイ後、`projects:read` のトークンで `GET /api/agent/v1/me` と `GET /api/agent/v1/projects?limit=1` を呼び、`next_cursor` をたどって2ページ目が取れることと、`agent_audit_logs` に `/api/agent/v1/projects` の行が入ることを確かめる
- [ ] **Step 5: #360 を更新する** — PR3 の節を PR3a / PR3b に分け、PR3a に PR へのリンクを足す。Decisions に「PR3 を2つに分ける」「絞り込みに他人の ID を指定したときは空の一覧」「cursor は署名しない」を理由付きで追記する
