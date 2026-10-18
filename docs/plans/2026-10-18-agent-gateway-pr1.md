# Agent Gateway PR1: AgentToken の基盤と hook の移行 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** スコープ付きの `AgentToken` を導入し、既存の hook token をそこへ移行する。`POST /api/hooks/quick-tasks` と `/api/user/hook-tokens` は、外から見た挙動を変えずに新しいトークンで動かす。

**Architecture:** migration 035 で `agent_tokens` を作って `hook_tokens` をコピーし、あわせて PR3 の差分取得に必要な `logs.updated_at`、`updated_at` トリガー、`(updated_at, id)` インデックスを入れる。認証は新しいモジュール `agent_auth.py` の FastAPI 依存関数（`get_agent_principal` / `require_scope`）に集める。hook のエンドポイントと、トークン管理の互換アダプタは `AgentTokenService` だけを使う。

**Tech Stack:** FastAPI、SQLModel（テストは SQLite in-memory）、PostgreSQL（Supabase。マイグレーションのテストは CI の postgres:16）、pytest、psycopg2

**Spec:** `docs/design/agent-gateway.md`（G1 と「実装順序」の PR1）。トラッキング: masa10-f/HumanCompiler#360

## Global Constraints

- 作業ディレクトリは `apps/api`。テストは `uv run pytest`。プッシュ前のチェックは `CLAUDE.md` の「Backend Changes」（`ruff check . --fix`、`ruff format .`、`mypy src`、`bandit -r src -s B101`、`pytest -v`）
- commit は英語・Conventional Commits。`--amend` は使わない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 新しいファイルには SPDX ヘッダー（`.spdx-header-python.txt`）を付ける
- トークン形式: `hc_agent_<public_id>_<secret>`。`public_id = secrets.token_urlsafe(6)`（常に 8 文字）、`secret = secrets.token_urlsafe(32)`。表示用 prefix は `hc_agent_<public_id>`（17 文字）。列は `VARCHAR(32)`
- 照合は SHA-256 のハッシュだけで行う。`hc_hook_` 形式の移行済みトークンもそのまま有効
- スコープは作成後に変更しない。失効はキャッシュせず、リクエストごとに DB を見る
- `last_used_at` は、前回の値から **5 分以上**たっているときだけ更新する
- エージェント用エンドポイントは Supabase JWT を受け付けない
- migration 035 は**追加だけ**にして旧コードと互換にする（テーブル・列・トリガー・インデックス・COMMENT）。`agent_audit_logs` は 035 に**含めない**（PR2 の 036。#360 の Decisions）
- 035 / 035 rollback のオブジェクト参照は、すべて `public.` で修飾する（Postgres テストが `public.` をテスト用スキーマに置き換えるため）
- PR1 以降のコードは `hook_tokens` を読み書きしない。`HookToken` モデルと `HookToken*` スキーマは PR4 まで残す
- 互換アダプタでトークンを作るときは、`AgentTokenService` の生成ロジックを使う（`HookTokenService` の 16 文字への切り詰めは流用しない）。呼び出し元がなくなる `HookTokenService` と `hook_token_service` は PR1 で削除する

## Review Focus

1. **移行済みの `hc_hook_` トークン**: 035 がコピーした行（prefix 16 文字、`scopes = {quick_tasks:write}`）で、2 種類の hook ヘッダーのどちらでも quick task が作れること → Task 5 の `test_migrated_hook_token_works_with_both_headers`
2. **DB に未知のスコープがある行**（将来のスコープ、または rollback → 再適用の後）: 認証が 500 にならず、既知のスコープでは通ること → Task 4 の `test_unknown_stored_scope_does_not_break_auth`
3. **`last_used_at` が naive datetime で返る場合**（SQLite、`TIMESTAMP` として読まれた値）: 比較で `TypeError` にならないこと → Task 3 の `test_touch_last_used_handles_naive_datetime`
4. **Bearer 以外の `Authorization`**（`Basic …`、`Bearer ` の後が空）: 500 にならず、次のヘッダーを見るか 401 になること → Task 4 の `test_non_bearer_authorization_falls_through`
5. **他人のトークン ID の失効**（互換アダプタの `DELETE`）: 404 になり、他人のトークンは有効なままであること → Task 5 の `test_revoke_other_users_token_returns_404`

---

## File Structure

| ファイル | 役割 |
|---|---|
| Create `apps/api/migrations/035_add_agent_tokens.sql` / `035_add_agent_tokens_rollback.sql` | スキーマ変更と hook token のコピー／書き戻し |
| Create `apps/api/tests/test_agent_tokens_migration_postgres.py` | 035 と rollback を、隔離したスキーマの Postgres で確かめる |
| Modify `.github/workflows/notebook-search.yml` | 上のテストを既存の Postgres ジョブで実行する |
| Modify `apps/api/src/humancompiler_api/models.py` | `AgentScope`、`AgentToken`、`Log.updated_at`、`LogResponse.updated_at` |
| Modify `apps/api/src/humancompiler_api/services.py` | `AgentTokenService` を追加し、`HookTokenService` を削除する |
| Create `apps/api/src/humancompiler_api/agent_auth.py` | トークンの抽出、prefix の抽出、`AgentPrincipal`、`get_agent_principal`、`require_scope` |
| Modify `apps/api/src/humancompiler_api/routers/hooks.py` | `require_scope(AgentScope.QUICK_TASKS_WRITE)` に切り替える |
| Modify `apps/api/src/humancompiler_api/routers/hook_tokens.py` | `agent_tokens` を読み書きする互換アダプタにする |
| Create `apps/api/tests/test_agent_tokens.py` / `test_agent_auth.py`、Modify `tests/test_hook_tokens.py` | SQLite でのユニットテスト・API テスト |
| Create `apps/api/tests/test_log_updated_at.py` | 作業ログの `updated_at` |
| Modify `apps/api/migrations/README.md`、`docs/design/agent-gateway.md` | 035 の説明。`agent_audit_logs` を 036（PR2）に移したことを spec に反映する |

ブランチ: `feat/agent-tokens-foundation`（`main` から作る）

---

### Task 1: 作業ログに `updated_at` を追加する（モデルとレスポンス）

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py:611-621`（`Log`）、`:1342-1350`（`LogResponse`）
- Test: `apps/api/tests/test_log_updated_at.py`

**Interfaces:**
- Produces: `Log.updated_at: datetime | None`（`default_factory=lambda: datetime.now(UTC)`。他のモデルと同じ形）、`LogResponse.updated_at: datetime`（必須。`created_at` と同じ形の serializer を付ける）

- [ ] **Step 1: 失敗するテストを書く**（`session` fixture と `LogService` を直接使う。User → Project → Goal → Task を作ってからログを作る）

```python
def test_new_log_has_updated_at(session): ...
    log = log_service.create_log(session, LogCreate(task_id=task.id, actual_minutes=30), user_id)
    assert log.updated_at is not None
    assert "updated_at" in LogResponse.model_validate(log).model_dump(mode="json")

def test_editing_log_advances_updated_at(session): ...
    before = log.updated_at
    updated = log_service.update_log(session, log.id, user_id, LogUpdate(comment="edited"))
    assert updated.updated_at > before
```

（`create_log` の正確な名前と引数は `services.py` の `LogService` に合わせる。`BaseService.update` は `hasattr(entity, "updated_at")` のときに値を進めるので、更新側のコード変更は要らない）

- [ ] **Step 2: 実行して失敗を確認する**
  Run: `uv run pytest tests/test_log_updated_at.py -v` → `AttributeError` / `KeyError: updated_at` で FAIL

- [ ] **Step 3: `Log` と `LogResponse` に `updated_at` を追加する**

- [ ] **Step 4: 実行して成功を確認する。既存のログ関連のテストも流す**
  Run: `uv run pytest tests/test_log_updated_at.py tests/test_log_service_batch.py tests/test_log_task_status.py tests/test_work_sessions_pause_resume.py -v` → PASS

- [ ] **Step 5: Commit** — `feat(logs): Expose updated_at on work logs`

---

### Task 2: migration 035 と rollback

**Files:**
- Create: `apps/api/migrations/035_add_agent_tokens.sql`、`apps/api/migrations/035_add_agent_tokens_rollback.sql`
- Create: `apps/api/tests/test_agent_tokens_migration_postgres.py`
- Modify: `.github/workflows/notebook-search.yml`、`apps/api/migrations/README.md`

**Interfaces:**
- Produces: テーブル `public.agent_tokens`（列は spec の「データモデル: `agent_tokens`」のとおり）、`public.logs.updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`。Task 3 のモデルはこの定義に合わせる

**035 の中身（この順で）:**
1. 事前確認の `DO $$` ブロック（`022_add_capacity_triage.sql` と同じ形）: `public.users`、`public.hook_tokens`、`public.logs`、`public.quick_tasks`、`public.context_notes`、`public.daily_plan_documents`、`public.projects`、`public.goals`、`public.tasks`、`public.work_sessions` と、関数 `public.update_updated_at_column()` があること
2. `public.agent_tokens` の作成。`scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0)`、`token_hash CHAR(64) NOT NULL UNIQUE`、`token_prefix VARCHAR(32) NOT NULL`、`created_at` / `updated_at` は `TIMESTAMPTZ NOT NULL DEFAULT NOW()`。インデックス・RLS・REVOKE・列単位の GRANT・COMMENT は `024_add_hook_tokens.sql` と同じ形（ポリシー名 `agent_tokens_own_metadata`。GRANT は `token_hash` を除く全列）。トリガー `update_agent_tokens_updated_at`
3. spec の「既存 hook の移行」の `INSERT … SELECT … ON CONFLICT (id) DO NOTHING`（テーブル名は `public.` で修飾する）
4. spec の `logs.updated_at` の3文（追加 → 埋め戻し → DEFAULT と NOT NULL）
5. `public.logs` / `quick_tasks` / `context_notes` / `daily_plan_documents` に `update_<table>_updated_at` トリガー（`DROP TRIGGER IF EXISTS` の後に `CREATE TRIGGER … BEFORE UPDATE … EXECUTE FUNCTION public.update_updated_at_column()`）
6. `CREATE INDEX IF NOT EXISTS idx_<table>_updated_at_id ON public.<table>(updated_at, id)`。対象は projects、goals、tasks、quick_tasks、logs、work_sessions、context_notes、daily_plan_documents
7. `COMMENT ON TABLE public.hook_tokens IS 'DEPRECATED: migrated to agent_tokens (035). Not read or written since the Agent Gateway PR1; dropped in a later migration.'`

**rollback の中身（この順で）:**
1. `UPDATE public.hook_tokens h SET revoked_at = a.revoked_at, updated_at = NOW() FROM public.agent_tokens a WHERE a.id = h.id AND a.revoked_at IS NOT NULL AND h.revoked_at IS NULL`
2. 6 のインデックス、5 のトリガー、`public.agent_tokens` を DROP（`IF EXISTS`）
3. `hook_tokens` の COMMENT を 024 の値に戻す
4. `logs.updated_at` は列も DEFAULT も残す（spec のとおり）

- [ ] **Step 1: 失敗する Postgres テストを書く**

既存の `tests/test_daily_plan_search_postgres.py` の形にそろえる（`NOTEBOOK_TEST_POSTGRES_URL` がなければ skip、`psycopg2`、`migration_statements()` で文を分割し `public.` を `"<schema>".` に置き換えて実行、最後は `connection.rollback()` で何も残さない）。セットアップでは次を作る。
- ロール `anon` / `authenticated`（`to_regrole(...) IS NULL` のときだけ作る）と、スキーマ `auth` と `auth.uid()`（`to_regprocedure('auth.uid()') IS NULL` のときだけ `SELECT NULL::uuid` を返す関数として作る）。Supabase の DB に向けても既存の定義を上書きしない
- テスト用スキーマに、関数 `update_updated_at_column()`（`NEW.updated_at = NOW(); RETURN NEW;`）と、035 が触る列だけを持つ最小のテーブル（users、projects、goals、tasks、work_sessions、logs〔001 と同じ列〕、quick_tasks、context_notes、daily_plan_documents、hook_tokens〔024 と同じ列〕）

テストの名前と確認すること:

```python
def test_035_copies_hook_tokens_including_revoked_and_null_timestamps():
    # hook_tokens: 有効1行、失効済み1行、created_at/updated_at が NULL の1行
    # → agent_tokens に 3 行。id/user_id/name/token_hash/token_prefix/last_used_at/revoked_at が一致
    # → scopes == ['quick_tasks:write']、失効済みの行は revoked_at が入ったまま、NULL だった時刻は NOT NULL で埋まる

def test_035_backfills_logs_updated_at_and_keeps_old_inserts_working():
    # created_at ありの行 → updated_at == created_at、created_at が NULL の行 → updated_at IS NOT NULL
    # 035 の後に updated_at を指定しない INSERT（旧コード）→ updated_at に値が入る

def test_035_triggers_advance_updated_at():
    # logs / quick_tasks / context_notes / daily_plan_documents の各行を updated_at = '2000-01-01' にしてから別の列を UPDATE
    # → updated_at > '2000-01-01'

def test_035_hides_token_hash_from_authenticated():
    # has_column_privilege('authenticated', '"<schema>".agent_tokens', 'token_hash', 'SELECT') is False
    # 同 'name' は True、has_table_privilege('anon', ..., 'SELECT') is False

def test_035_can_be_applied_twice():
    # 035 を2回流してもエラーにならず、agent_tokens の行数が変わらない
    # （手動適用が schema_migrations に記録されていないと、起動時の migration_manager がもう一度流すため）

def test_035_rollback_writes_back_revocations():
    # 035 → agent_tokens で有効だった行に revoked_at を入れる → rollback
    # → 該当の hook_tokens.revoked_at IS NOT NULL（旧コードでも 401 になる）
    # → to_regclass('"<schema>".agent_tokens') IS NULL、logs.updated_at 列は残っている
```

- [ ] **Step 2: ローカルの Postgres で実行して失敗を確認する**
  Run: `docker run --rm -d --name hc-pg -e POSTGRES_USER=notebook_test -e POSTGRES_PASSWORD=notebook_test -e POSTGRES_DB=notebook_test -p 55432:5432 postgres:16`、その後 `NOTEBOOK_TEST_POSTGRES_URL=postgresql://notebook_test:notebook_test@localhost:55432/notebook_test uv run pytest tests/test_agent_tokens_migration_postgres.py -v`
  Expected: `FileNotFoundError: …035_add_agent_tokens.sql` で FAIL（Docker が使えなければ、この手順と Step 4 は CI の結果で確かめ、そのことを報告する）

- [ ] **Step 3: 035 と rollback を書く**（上の「035 の中身」「rollback の中身」のとおり）

- [ ] **Step 4: 実行して成功を確認する**（Step 2 と同じコマンド → 6 passed）。`NOTEBOOK_TEST_POSTGRES_URL` なしで `uv run pytest tests/test_agent_tokens_migration_postgres.py` → 6 skipped

- [ ] **Step 5: CI と README を更新する**
  - `notebook-search.yml` の `paths` に `apps/api/migrations/035*` と `apps/api/tests/test_agent_tokens_migration_postgres.py` を足し、`Check agent token migration and rollback` という step で `uv run pytest -q tests/test_agent_tokens_migration_postgres.py` を実行する
  - `migrations/README.md` の一覧に 035 を追加する。内容: `agent_tokens` の作成と `hook_tokens` のコピー、`logs.updated_at`、トリガー、インデックス。旧コードと互換。**適用からデプロイ完了までは、トークンを作成・失効させない**。rollback は失効を `hook_tokens` に書き戻すが、移行後に作ったトークンは使えなくなる

- [ ] **Step 6: Commit** — `feat(db): Add agent_tokens and copy hook tokens (migration 035)`

---

### Task 3: `AgentScope`、`AgentToken` モデル、`AgentTokenService`

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`（`HookToken` の直後）
- Modify: `apps/api/src/humancompiler_api/services.py`（`HookTokenService` の位置。末尾のインスタンス群に `agent_token_service` を追加）
- Test: `apps/api/tests/test_agent_tokens.py`

**Interfaces:**
- Produces:
  - `class AgentScope(StrEnum)`: `PROJECTS_READ = "projects:read"`、`GOALS_READ = "goals:read"`、`TASKS_READ = "tasks:read"`、`QUICK_TASKS_READ = "quick_tasks:read"`、`LOGS_READ = "logs:read"`、`WORK_SESSIONS_READ = "work_sessions:read"`、`NOTES_READ = "notes:read"`、`DAILY_PLANS_READ = "daily_plans:read"`、`CONTEXT_READ = "context:read"`、`QUICK_TASKS_WRITE = "quick_tasks:write"`
  - `class AgentToken(SQLModel, table=True)`、`__tablename__ = "agent_tokens"`。列は Task 2 のテーブルと同じ。`scopes: list[str]` は `sa_column=Column(ARRAY(Text()).with_variant(JSON(), "sqlite"), nullable=False)`（`ARRAY` は `sqlalchemy` から import。SQLite のテストでも `create_all` できるようにするため）。`User` とのリレーションは付けない
  - `class AgentTokenService`: 定数 `NAMESPACE = "hc_agent_"`、`PUBLIC_ID_BYTES = 6`、`LAST_USED_INTERVAL = timedelta(minutes=5)`
    - `generate_token(cls) -> tuple[str, str]`（token, prefix。切り詰めはしない）
    - `hash_token(token: str) -> str`（staticmethod、SHA-256 hex）
    - `create_token(self, session: Session, user_id: str | UUID, name: str, scopes: Sequence[AgentScope], description: str | None = None) -> tuple[AgentToken, str]`。`scopes` が空なら `ValueError`。重複は除き、保存する順序は `AgentScope` の定義順
    - `list_active_tokens(self, session, user_id) -> list[AgentToken]`（`revoked_at IS NULL`、`created_at` 降順・`id` 昇順）
    - `revoke_token(self, session, token_id: str | UUID, user_id: str | UUID) -> AgentToken`。自分の有効なトークンでなければ `ResourceNotFoundError("AgentToken", …)`
    - `get_active_token_by_secret(self, session, token: str) -> AgentToken | None`
    - `touch_last_used(self, session, agent_token: AgentToken, now: datetime | None = None) -> bool`。`last_used_at` が None か、`now - last_used_at >= LAST_USED_INTERVAL` のときだけ更新して commit し、True を返す。naive な値は UTC とみなして比べる
  - モジュール変数 `agent_token_service = AgentTokenService()`

- [ ] **Step 1: 失敗するテストを書く**（`session` fixture、User を1件作る）

```python
def test_generated_token_format():
    token, prefix = AgentTokenService.generate_token()
    assert prefix.startswith("hc_agent_") and len(prefix) == 17
    assert token.startswith(prefix + "_")

def test_create_token_stores_only_hash(session):
    model, token = agent_token_service.create_token(session, USER_ID, "laptop", [AgentScope.TASKS_READ, AgentScope.PROJECTS_READ, AgentScope.TASKS_READ])
    assert model.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert model.scopes == ["projects:read", "tasks:read"]
    assert agent_token_service.get_active_token_by_secret(session, token).id == model.id

def test_create_token_rejects_empty_scopes(session):
    with pytest.raises(ValueError): agent_token_service.create_token(session, USER_ID, "x", [])

def test_revoked_token_is_not_found_immediately(session):
    # revoke_token の直後に get_active_token_by_secret → None、list_active_tokens → []

def test_revoke_other_users_token_raises(session):
    # 別ユーザーの token_id → ResourceNotFoundError、そのトークンは有効なまま

def test_touch_last_used_throttles_to_five_minutes(session):
    # now=t0 → True、t0+4m59s → False（値は t0 のまま）、t0+5m → True

def test_touch_last_used_handles_naive_datetime(session):
    # last_used_at = datetime(2026, 10, 18, 0, 0)（tzinfo なし）、now = 同日 00:06 UTC → True
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_tokens.py -v` → `ImportError: cannot import name 'AgentScope'` で FAIL
- [ ] **Step 3: `AgentScope`、`AgentToken`、`AgentTokenService`、`agent_token_service` を実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS。`uv run pytest tests/test_hook_tokens.py -v` もまだ PASS すること（`HookTokenService` は Task 5 まで残す）
- [ ] **Step 5: Commit** — `feat(agent): Add AgentToken model and service`

---

### Task 4: `agent_auth.py`（トークンの抽出、prefix の抽出、principal、スコープ）

**Files:**
- Create: `apps/api/src/humancompiler_api/agent_auth.py`
- Test: `apps/api/tests/test_agent_auth.py`

**Interfaces:**
- Consumes: `AgentScope`、`agent_token_service`（Task 3）、`database.get_session`
- Produces:
  - `extract_agent_token(request: Request) -> str`。順序は `Authorization: Bearer <token>` → `X-HumanCompiler-Agent-Token` → `X-HumanCompiler-Hook-Token`。Bearer 以外のスキームや空の値は無視して次を見る。見つからなければ 401（`detail="Agent token required"`、`WWW-Authenticate: Bearer`）
  - `extract_token_prefix(token: str) -> str | None`。`^(hc_agent_|hc_hook_)([A-Za-z0-9_-]{8})_` に一致すれば `namespace + public_id` を返し、一致しなければ None。`_` で分割しない（PR2 の監査ログで使う）
  - `@dataclass(frozen=True) class AgentPrincipal`: `token_id: UUID`、`user_id: UUID`、`scopes: frozenset[str]`、`token_prefix: str`。DB の値を `AgentScope` に変換しない（未知のスコープで落ちないようにするため）
  - `get_agent_principal(request: Request, session: Annotated[Session, Depends(get_session)]) -> AgentPrincipal`。ハッシュで有効なトークンを引き、なければ 401（`detail="Invalid agent token"`）。`touch_last_used` を呼び、`request.state.agent_principal` に置く
  - `require_scope(scope: AgentScope) -> Callable[..., AgentPrincipal]`。返す依存関数は、`get_agent_principal` を使う前に `request.state.required_scope = scope.value` を記録し、`scope.value not in principal.scopes` なら 403（`detail=f"Missing required scope: {scope.value}"`）

- [ ] **Step 1: 失敗するテストを書く**

テスト専用の `FastAPI()` に `GET /needs-tasks`（`require_scope(AgentScope.TASKS_READ)`）と `GET /needs-hook`（`require_scope(AgentScope.QUICK_TASKS_WRITE)`）を置き、`request.state.required_scope` と `principal.user_id` を返す。`get_session` は `session` fixture で上書きする。

```python
def test_extract_token_prefix_handles_underscores_in_public_id():
    assert extract_token_prefix("hc_agent_a_b_c_d__secret") == "hc_agent_a_b_c_d_"
    assert extract_token_prefix("hc_hook_AbCd-123_secret") == "hc_hook_AbCd-123"
    for bad in ["invalid-token", "hc_agent_short", "eyJhbGciOi.eyJzdWIi.sig", ""]:
        assert extract_token_prefix(bad) is None

def test_generated_token_prefix_round_trips():  # 100 回生成して extract_token_prefix(token) == prefix

@pytest.mark.parametrize("header", ["Authorization", "X-HumanCompiler-Agent-Token", "X-HumanCompiler-Hook-Token"])
def test_all_token_headers_are_accepted(header): ...  # 200、required_scope == "tasks:read"

def test_non_bearer_authorization_falls_through():
    # Authorization: Basic xxx + X-HumanCompiler-Agent-Token: <valid> → 200
    # Authorization: "Bearer " のみ → 401

def test_missing_invalid_and_revoked_tokens_are_401():  # ヘッダーなし、"invalid-token"、失効済み

def test_supabase_jwt_is_rejected():  # Bearer に JWT 形式の文字列 → 401

def test_missing_scope_is_403_with_scope_name():
    # quick_tasks:write だけのトークンで /needs-tasks → 403、detail に "tasks:read"

def test_unknown_stored_scope_does_not_break_auth():
    # scopes = ["quick_tasks:write", "proposals:write"] の行を直接 INSERT → /needs-hook 200、/needs-tasks 403

def test_successful_request_sets_last_used_at():
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_auth.py -v` → `ModuleNotFoundError: humancompiler_api.agent_auth` で FAIL
- [ ] **Step 3: `agent_auth.py` を実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Add agent token authentication and scope checks`

---

### Task 5: hook のエンドポイントと互換アダプタを AgentToken に切り替える

**Files:**
- Modify: `apps/api/src/humancompiler_api/routers/hooks.py`、`routers/hook_tokens.py`
- Modify: `apps/api/src/humancompiler_api/services.py`（`HookTokenService`、`hook_token_service` と、使われなくなった import を削除）
- Test: `apps/api/tests/test_hook_tokens.py`

**Interfaces:**
- Consumes: `require_scope`、`AgentPrincipal`（Task 4）、`agent_token_service`（Task 3）
- Produces: `POST /api/hooks/quick-tasks` の URL・ヘッダー・成功時のレスポンスは変わらない。`/api/user/hook-tokens` のリクエストとレスポンスの形（`HookTokenCreate` / `HookTokenResponse` / `HookTokenCreatedResponse`）も変わらない

実装の要点:
- `hooks.py`: `_extract_hook_token` を消し、`principal: Annotated[AgentPrincipal, Depends(require_scope(AgentScope.QUICK_TASKS_WRITE))]` を受け取る。`quick_task_service.create_quick_task(session, task_data, principal.user_id)`。`last_used_at` の更新は `get_agent_principal` に任せる。ログ出力はタスク ID とユーザー ID だけ（今と同じ）
- `hook_tokens.py`:
  - GET: `list_active_tokens` のうち、`set(scopes) == {"quick_tasks:write"}` のものだけを返す
  - POST: `create_token(session, user_id, token_data.name, [AgentScope.QUICK_TASKS_WRITE])`
  - DELETE: `revoke_token`（自分の有効なトークンでなければ 404）

- [ ] **Step 1: テストを更新し、新しいテストを書く**
  - 既存のテストは `HookToken` ではなく `AgentToken` を見るように直す。作成時の確認は `startswith("hc_agent_")`、`len(token_prefix) == 17`、保存されたトークンの `scopes == ["quick_tasks:write"]`
  - 追加:

```python
def test_migrated_hook_token_works_with_both_headers(session):
    # 035 がコピーした行と同じ形で INSERT: token = "hc_hook_AbCdEfGh_" + secret、token_prefix = "hc_hook_AbCdEfGh"、scopes=["quick_tasks:write"]
    # Authorization: Bearer と X-HumanCompiler-Hook-Token の両方で 201

def test_hook_rejects_token_without_quick_tasks_write(session):
    # scopes=["tasks:read"] のトークン → 403、QuickTask は作られない

def test_hook_token_list_shows_only_hook_only_tokens(session):
    # {quick_tasks:write} と {quick_tasks:write, tasks:read} を作る → 一覧は前者だけ

def test_revoke_other_users_token_returns_404(session):
    # 別ユーザーのトークン ID を DELETE → 404。そのトークンで /api/hooks/quick-tasks → 201

def test_hook_token_service_is_removed():
    assert not hasattr(services, "hook_token_service")
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_hook_tokens.py -v` → prefix の確認などで FAIL
- [ ] **Step 3: `hooks.py` と `hook_tokens.py` を切り替え、`HookTokenService` を削除する**
- [ ] **Step 4: 実行して成功を確認する** — `uv run pytest tests/test_hook_tokens.py tests/test_agent_auth.py tests/test_agent_tokens.py -v` → PASS。`grep -rn "hook_token_service\|HookTokenService" src` → 出力なし
- [ ] **Step 5: Commit** — `feat(hooks): Authenticate hooks and hook token API with agent tokens`

---

### Task 6: spec の更新、全体のチェック、PR

**Files:**
- Modify: `docs/design/agent-gateway.md`

- [ ] **Step 1: spec を更新する**
  - 「マイグレーション」: 035 から `agent_audit_logs` を外し、「`036_add_agent_audit_logs.sql`（PR2）」の項を作る。中身は今の 2 と、#360 で PR2 に振り分けた `REVOKE ALL … FROM anon, authenticated` → 必要な列だけ `GRANT SELECT`
  - rollback の手順の番号（「上の 1〜3 と 5〜6」）を、035 の新しい番号に合わせる
  - 「実装順序」の PR1 から「`agent_audit_logs`」への言及を外し、PR2 に「migration 036」を足す
  - 「状態」の行を `承認済み（実装: #360）` にする
- [ ] **Step 2: Commit** — `docs(agent): Move agent_audit_logs to migration 036 in the spec`
- [ ] **Step 3: バックエンドのチェックをすべて流す**（`apps/api`）
  Run: `ruff check . --fix && ruff format . && mypy src && bandit -r src -s B101 && uv run pytest -v`
  Expected: すべて成功。Web は変更していないが、`/api/user/hook-tokens` の形を変えていないことの確認として `pnpm --filter web test -- settings` も流す
- [ ] **Step 4: push して PR を作る**（タイトル `feat(agent): Add AgentToken foundation and migrate hook tokens`、本文は英語。`Refs #360`）
  本文の **Deployment Notes** に次を書く:
  1. マージの前に `035_add_agent_tokens.sql` を本番 DB に手動で適用する（旧コードと互換）
  2. 確認用 SQL: `SELECT count(*) FROM hook_tokens;` と `SELECT count(*) FROM agent_tokens;` が一致すること、`SELECT count(*) FROM logs WHERE updated_at IS NULL;` が 0 であること
  3. 適用してからデプロイが終わるまでは、hook token を作成・失効させない
  4. デプロイ後、既存の hook（`hc_hook_…`）で quick task が作れることを確かめる
  5. 戻すときは、`035_add_agent_tokens_rollback.sql` を旧コードへのロールバックの**後に**流す。移行後に作ったトークンは使えなくなる
- [ ] **Step 5: #360 の PR1 のチェックリストを、PR へのリンクと一緒に更新する**
