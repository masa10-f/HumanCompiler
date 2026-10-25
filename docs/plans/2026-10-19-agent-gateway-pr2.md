# Agent Gateway PR2: 監査ログ、rate limit、トークン管理 API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/api/agent/*` と `/api/hooks/*` へのトークン付きリクエストを `agent_audit_logs` に記録し、トークン単位と認証失敗の rate limit をかけ、スコープ付きトークンを作成・一覧・失効できる管理 API `/api/user/agent-tokens` を用意する。

**Architecture:** migration 037 で `agent_audit_logs` を作る。記録は新しいモジュール `agent_audit.py` の pure ASGI ミドルウェアで行い、応答を送り終えてから `run_in_threadpool` で1行 INSERT する。rate limit は新しいモジュール `agent_rate_limit.py`（`limits` の in-memory moving window）に置き、`agent_auth.get_agent_principal` から呼ぶ。管理 API は `routers/agent_tokens.py` に置き、PR1 の `AgentTokenService` を使う。

**Tech Stack:** FastAPI 0.116 / Starlette 0.47、SQLModel（テストは SQLite in-memory）、`limits` 5.6、APScheduler、PostgreSQL 16（マイグレーションのテストのみ）、pytest、psycopg2

**Spec:** `docs/design/agent-gateway.md`（「監査ログの書き込み」「Rate limit」「トークン管理 API」「`037_add_agent_audit_logs.sql`」「テスト」）。トラッキング: masa10-f/HumanCompiler#360 の PR2 の節

## 決めたこと（spec からの変更点。Task 6 で spec と #360 に反映する）

- **IP 単位の上限（spec の段階 1、300/分）は実装しない**。`DefaultRateLimitMiddleware` の 200/分（IP 単位、全リクエスト）が先にかかるため。rate limit はトークン単位と認証失敗の2段にする（ユーザー確認済み）
- **トークンのヘッダーがない 401 は、認証失敗の回数に含めない**。監査ログに記録しない方針とそろえる。総量は既定の 200/分で抑えられる（ユーザー確認済み）
- **`authenticated` に GRANT する列は 11 列すべて**（`client_ip` と `route` を含む）。RLS で自分の行しか見えないこと、表に secret がないこと、管理 API が同じ列を同じユーザーに返すことが理由。`client_ip` は、漏れたトークンが知らない IP から使われていないかを本人が確かめるのに使う。テーブル単位の GRANT ではなく列単位にして、将来の列が自動で見えないようにする
- **監査ログは pure ASGI ミドルウェアで、`await self.app(...)` が返った後に書く**。最後の body を送り終えた後なので、`response.background = BackgroundTask(...)` と同じく応答を待たせない。`BaseHTTPMiddleware` を使わずに済み、`call_next` の例外も同じ `try/finally` で扱える（例外のときだけは、外側の `ServerErrorMiddleware` が 500 を返す前に書くことになる。頻度が低いので許容する）
- **トークン単位の上限の 429 は記録する**（`user_id` があり本人に見える。総量は既定の 200/分で抑えられる）。記録しないのは、認証失敗の上限の 429 と、既定の上限の 429（監査のミドルウェアまで届かない）
- 認証失敗の上限にかかった IP からは、正しいトークンでも 429 になる（spec の「以後 429」のとおり。ハッシュで照合する前に判定するため）
- 認証失敗の上限の 429 に `Retry-After` を付けるため、`exceptions.http_exception_handler` が `HTTPException.headers` を捨てている点を直す（PR1 の 401 の `WWW-Authenticate` も、本体のアプリでは捨てられていた）

## Global Constraints

- 作業ディレクトリは `apps/api`。テストは `uv run pytest`。プッシュ前のチェックは `CLAUDE.md` の「Backend Changes」（`ruff check . --fix`、`ruff format .`、`mypy src`、`bandit -r src -s B101`、`pytest -v`）
- commit は英語・Conventional Commits。`--amend` は使わない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 新しいファイルには SPDX ヘッダー（`.spdx-header-python.txt`）を付ける
- migration 037 は**追加だけ**にして旧コードと互換にし、**2回流しても壊れない**ようにする（`IF NOT EXISTS`、`DROP POLICY IF EXISTS`）。オブジェクト参照はすべて `public.` で修飾する。`DO` ブロックは `$$` ではなく `DO '...'`（中のクォートは2重）で書く
- 監査ログには、リクエストボディ、クエリの値、トークンの secret を記録しない。`route` はテンプレート（一致しなければ `<unmatched>`）。`token_prefix` は認証済みなら principal の値、未認証なら `extract_token_prefix()` に一致した場合だけ
- 監査ログの対象は `scope["path"]` が `/api/agent/` か `/api/hooks/` で始まる HTTP リクエストのうち、トークンのヘッダーがあるもの（`extract_agent_token` が 401 を出さないもの）だけ
- 監査ログの書き込みに失敗しても応答は変えない（`logger.exception` で出力する）
- rate limit の値: トークン単位 `120 per minute`（キーは検証済みの `token_id`）、認証失敗 `20 per minute`（キーは `get_client_ip(request)`）。どちらも moving window、in-memory
- 新しい rate limit はテスト環境では無効（`settings.environment != "test"`）。テストでは `agent_rate_limiter.enabled` を明示的に `True` にし、`reset()` で数をリセットする
- 監査ログの保持は 90 日。既存の APScheduler に1日1回のジョブを足す
- `require_scope` は、認証する前に `request.state.required_scope` を記録する順序を保つ
- テストに JWT のような文字列を直接書かない（GitGuardian が検出する）。必要なら実行時に組み立てる
- preview 用の DB は作らない。本番 DB への手動適用はユーザーが行う。PR はマージしない

## Review Focus

1. **監査ログの DB 書き込みが失敗する**（接続切れなど）: hook の応答は 201 のままで、エラーがログに出ること → Task 2 の `test_audit_write_failure_does_not_fail_response`
2. **エンドポイントの中で想定外の例外が起きる**: 500 として1行記録され、例外は従来どおり 500 の応答になること → Task 2 の `test_unhandled_exception_is_audited_as_500`
3. **形式の正しいトークンにボディやクエリで秘密らしい値を混ぜる**: どの列にも secret、ボディ、クエリの値が入らないこと → Task 2 の `test_audit_row_never_contains_secret_body_or_query`
4. **認証失敗の上限にかかった IP が、さらに偽のトークンを送り続ける**: 429 は記録されず、行数が増えないこと → Task 4 の `test_auth_failure_429_is_not_audited`
5. **自分のトークンを失効させた後に、その監査ログを見る**: 失効済みでも自分のトークンなら 200 で返り、他人のトークンは 404 になること → Task 5 の `test_audit_logs_for_revoked_own_token_are_listed`、`test_audit_logs_for_other_users_token_returns_404`

---

## File Structure

| ファイル | 役割 |
|---|---|
| Create `apps/api/migrations/037_add_agent_audit_logs.sql` / `037_add_agent_audit_logs_rollback.sql` | `agent_audit_logs` の作成と削除 |
| Create `apps/api/tests/postgres_migration_helpers.py` | 035 のテストにある `migration_statements` / `run_migration` / `create_supabase_objects` を移す（037 のテストと共有する） |
| Modify `apps/api/tests/test_agent_tokens_migration_postgres.py` | 上のヘルパーを import する |
| Create `apps/api/tests/test_agent_audit_logs_migration_postgres.py` | 037 と rollback を、隔離したスキーマの Postgres で確かめる |
| Modify `.github/workflows/notebook-search.yml`、`apps/api/migrations/README.md` | 037 のテストを CI で流す。037 の説明 |
| Modify `apps/api/src/humancompiler_api/models.py` | `AgentAuditLog`、`AGENT_SCOPE_DESCRIPTIONS`、管理 API のスキーマ |
| Create `apps/api/src/humancompiler_api/agent_audit.py` | 監査ミドルウェア、書き込み、保持期間の削除、トークンごとの一覧 |
| Create `apps/api/src/humancompiler_api/agent_rate_limit.py` | トークン単位と認証失敗の rate limit |
| Modify `apps/api/src/humancompiler_api/agent_auth.py` | rate limit の呼び出し、`SKIP_AUDIT_STATE` |
| Modify `apps/api/src/humancompiler_api/exceptions.py` | `http_exception_handler` が `exc.headers` を返すようにする |
| Modify `apps/api/src/humancompiler_api/main.py` | 監査ミドルウェアの登録、`agent_tokens` ルーターの登録 |
| Modify `apps/api/src/humancompiler_api/scheduler/notification_scheduler.py` | 保持ジョブ |
| Modify `apps/api/src/humancompiler_api/services.py` | `AgentTokenService.get_owned_token` |
| Create `apps/api/src/humancompiler_api/routers/agent_tokens.py` | `/api/user/agent-tokens` |
| Create `apps/api/tests/test_agent_audit.py` / `test_agent_rate_limit.py` / `test_agent_tokens_api.py` | SQLite でのテスト |
| Modify `docs/design/agent-gateway.md` | 上の「決めたこと」を反映する |

ブランチ: `feat/agent-audit-rate-limits`（`main` から作る）

---

### Task 1: migration 037 と rollback

**Files:**
- Create: `apps/api/migrations/037_add_agent_audit_logs.sql`、`037_add_agent_audit_logs_rollback.sql`
- Create: `apps/api/tests/postgres_migration_helpers.py`、`apps/api/tests/test_agent_audit_logs_migration_postgres.py`
- Modify: `apps/api/tests/test_agent_tokens_migration_postgres.py`、`.github/workflows/notebook-search.yml`、`apps/api/migrations/README.md`

**Interfaces:**
- Produces: テーブル `public.agent_audit_logs`。Task 2 のモデルはこの定義に合わせる

**037 の中身（この順で）:**
1. ヘッダーのコメント（035 と同じ形: 追加だけで旧コードと互換、2回流してよい、`DO` を単引用符で書く理由）
2. 事前確認の `DO '...'`: `public.users` と `public.agent_tokens` があること（なければ「Apply 035_add_agent_tokens.sql before 037_add_agent_audit_logs.sql.」）
3. `CREATE TABLE IF NOT EXISTS public.agent_audit_logs`。列は spec の「データモデル: `agent_audit_logs`」のとおり: `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`、`token_id UUID REFERENCES public.agent_tokens(id) ON DELETE SET NULL`、`user_id UUID REFERENCES public.users(id) ON DELETE CASCADE`、`token_prefix VARCHAR(32)`、`method VARCHAR(10) NOT NULL`、`route VARCHAR(200) NOT NULL`、`required_scope VARCHAR(50)`、`status_code SMALLINT NOT NULL`、`duration_ms INTEGER NOT NULL`、`client_ip VARCHAR(45)`、`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`
4. `idx_agent_audit_logs_user_created ON (user_id, created_at DESC)`、`idx_agent_audit_logs_token_created ON (token_id, created_at DESC)`（`IF NOT EXISTS`）
5. RLS を有効にし、`DROP POLICY IF EXISTS` の後に `agent_audit_logs_own_rows`（`FOR SELECT TO authenticated USING (auth.uid()::text = user_id::text)`。035 と同じ形）
6. `REVOKE ALL ON public.agent_audit_logs FROM anon, authenticated` の後に、11 列すべてを列単位で `GRANT SELECT (...) TO authenticated`
7. テーブルと主な列の COMMENT（`route` は「Route template; never contains IDs, query values or bodies」、`token_prefix` は「Validated display prefix; NULL when the presented token is malformed」）

rollback: `DROP TABLE IF EXISTS public.agent_audit_logs;`。コメントに「旧 API に戻した後に流す。035 の rollback より先に流す（`agent_tokens` を参照しているため）」と書く。

- [ ] **Step 1: ヘルパーを移す**
  `test_agent_tokens_migration_postgres.py` の `migration_statements`、`run_migration`、`create_supabase_objects` を `tests/postgres_migration_helpers.py` に移し、035 のテストは `from tests.postgres_migration_helpers import ...` で使う。`NOTEBOOK_TEST_POSTGRES_URL=... uv run pytest tests/test_agent_tokens_migration_postgres.py -v` → 6 passed のまま

- [ ] **Step 2: 失敗する Postgres テストを書く**（035 のテストと同じ fixture の形。セットアップでは `create_supabase_objects` の後に、テスト用スキーマへ最小のテーブル `users (id UUID PRIMARY KEY)` と `agent_tokens (id UUID PRIMARY KEY, user_id UUID REFERENCES users(id) ON DELETE CASCADE)` を作る）

```python
def test_037_creates_table_and_indexes(db):
    # information_schema.columns の列名の集合 == spec の 11 列
    # pg_indexes に idx_agent_audit_logs_user_created と idx_agent_audit_logs_token_created がある

def test_037_can_be_applied_twice(db):
    # 2回流してもエラーにならず、入れておいた1行が残る

def test_037_grants_select_only_on_listed_columns(db):
    # 11 列それぞれ has_column_privilege('authenticated', tbl, col, 'SELECT') is True
    # has_table_privilege('authenticated', tbl, 'INSERT') / 'UPDATE' / 'DELETE' is False
    # has_any_column_privilege('anon', tbl, 'SELECT') is False
    # pg_class.relrowsecurity is True、pg_policies に agent_audit_logs_own_rows がある

def test_037_deleting_user_deletes_their_audit_rows(db):
    # user と token と行を入れ、users を DELETE → 行が消える

def test_037_deleting_token_keeps_row_with_null_token_id(db):
    # agent_tokens を DELETE → 行は残り token_id IS NULL

def test_037_rollback_drops_table(db):
    # rollback → to_regclass('"<schema>".agent_audit_logs') IS NULL
```

- [ ] **Step 3: ローカルの Postgres で実行して失敗を確認する**
  Docker はないので、scratchpad の Python 3.12 venv に `pgserver` を入れ、同梱の `initdb -D <dir> -U notebook_test --auth=trust`、`pg_ctl -D <dir> -o "-p 55432 -c unix_socket_directories='' -c listen_addresses=localhost" -l <log> start`、`createdb -h localhost -p 55432 -U notebook_test notebook_test` で起動する
  Run: `NOTEBOOK_TEST_POSTGRES_URL=postgresql://notebook_test@localhost:55432/notebook_test uv run pytest tests/test_agent_audit_logs_migration_postgres.py -v`
  Expected: `FileNotFoundError: …037_add_agent_audit_logs.sql` で FAIL

- [ ] **Step 4: 037 と rollback を書く**（上の「037 の中身」のとおり）

- [ ] **Step 5: 実行して成功を確認する** — Step 3 と同じコマンドで 6 passed。035 のテストも 6 passed。`NOTEBOOK_TEST_POSTGRES_URL` なしでは skipped

- [ ] **Step 6: CI と README を更新する**
  - `notebook-search.yml` の `paths` に `apps/api/migrations/037*`、`apps/api/tests/test_agent_audit_logs_migration_postgres.py`、`apps/api/tests/postgres_migration_helpers.py` を足し、`Check agent audit log migration and rollback` という step で `uv run pytest -q tests/test_agent_audit_logs_migration_postgres.py` を実行する
  - `migrations/README.md` の一覧に 037 を追加する。内容: `agent_audit_logs` の作成。追加だけで旧コードと互換。rollback は旧 API に戻した後、035 の rollback より先に流す

- [ ] **Step 7: Commit** — `feat(db): Add agent_audit_logs (migration 037)`

---

### Task 2: `AgentAuditLog` モデルと監査ミドルウェア

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`（`AgentToken` の直後）
- Create: `apps/api/src/humancompiler_api/agent_audit.py`
- Modify: `apps/api/src/humancompiler_api/agent_auth.py`（定数の追加だけ）、`main.py`
- Test: `apps/api/tests/test_agent_audit.py`

**Interfaces:**
- Consumes: `extract_agent_token`、`extract_token_prefix`、`AgentPrincipal`（`agent_auth.py`）、`resolve_client_ip`（`client_ip.py`）、`db.get_engine()`
- Produces:
  - `class AgentAuditLog(SQLModel, table=True)`、`__tablename__ = "agent_audit_logs"`。列は Task 1 と同じ。`id` は `AgentToken.id` と同じ形、`token_id: UUID | None = SQLField(default=None, foreign_key="agent_tokens.id", ondelete="SET NULL")`、`user_id: UUID | None = SQLField(default=None, foreign_key="users.id", ondelete="CASCADE")`、`created_at: datetime = SQLField(default_factory=lambda: datetime.now(UTC))`
  - `agent_auth.SKIP_AUDIT_STATE = "skip_agent_audit"`（`request.state` の属性名。Task 4 が設定し、ミドルウェアが読む）
  - `agent_audit.AUDITED_PATH_PREFIXES = ("/api/agent/", "/api/hooks/")`、`UNMATCHED_ROUTE = "<unmatched>"`
  - `agent_audit.session_factory: Callable[[], Session]`（既定は `lambda: Session(db.get_engine())`。テストで差し替える）
  - `def write_audit_log(entry: AgentAuditLog) -> None`（`session_factory()` で開いて add・commit。例外はそのまま出す）
  - `class AgentAuditMiddleware`（pure ASGI。`__init__(self, app: ASGIApp)`、`async __call__(scope, receive, send)`）

ミドルウェアの手順:
1. `scope["type"] != "http"`、またはパスが対象外なら、そのまま `self.app` に渡す
2. `Request(scope)` で `extract_agent_token` を呼び、`HTTPException` ならヘッダーなしとして記録せずに渡す
3. `send` を包んで `http.response.start` の `status` を拾い、`time.monotonic()` で時間を測る
4. `try: await self.app(scope, receive, wrapped_send)` / `finally:` で、`scope.get("state", {})` から `SKIP_AUDIT_STATE` が真なら書かない。それ以外は `AgentAuditLog` を組み立てる（status が拾えていなければ 500、`route` は `getattr(scope.get("route"), "path", None) or UNMATCHED_ROUTE`、principal があればその `token_id` / `user_id` / `token_prefix`、なければ `extract_token_prefix(token)`、`required_scope` は state から、`client_ip` は `resolve_client_ip(scope)`）、`await run_in_threadpool(write_audit_log, entry)` を `try/except Exception` で包んで `logger.exception("Failed to write agent audit log")`

`main.py`: `app.add_middleware(AgentAuditMiddleware)` を `configure_rate_limiting(app)` の**直前**に置き、既定の rate limit より内側にする（コメントで「既定の 429 は記録されない」と書く）。

テストの準備: `test_hook_tokens.py` と同じく本体の `app` と `get_session` の上書きを使う。fixture で `monkeypatch.setattr(agent_audit, "session_factory", lambda: Session(session.get_bind()))`。行は `session.expire_all()` の後に `select(AgentAuditLog)` で読む。トークンは `agent_token_service.create_token` で作る。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_successful_hook_request_is_audited(session):
    # quick_tasks:write のトークンで POST /api/hooks/quick-tasks → 201、行は1つ
    # token_id/user_id/token_prefix がトークンと一致、method == "POST"
    # route == "/api/hooks/quick-tasks"、required_scope == "quick_tasks:write"
    # status_code == 201、duration_ms >= 0、client_ip == "testclient"

def test_invalid_token_is_audited_with_prefix_only_when_well_formed(session):
    # "hc_agent_AbCdEfGh_" + "x" * 43（DB にない）→ 401、token_prefix == "hc_agent_AbCdEfGh"、user_id/token_id は None、required_scope == "quick_tasks:write"
    # "not-a-token" → 401、token_prefix is None

def test_missing_scope_is_audited_as_403(session):  # tasks:read だけのトークン → 403 の行、user_id あり

def test_request_without_token_header_is_not_audited(session):  # ヘッダーなし → 401、行は 0

def test_unmatched_route_is_recorded_as_placeholder(session):
    # GET /api/agent/v1/tasks/<uuid4> に有効なトークン → 404、route == "<unmatched>"、どの列にもその UUID が入らない

def test_audit_row_never_contains_secret_body_or_query(session):
    # POST /api/hooks/quick-tasks?note=query-marker、body の title="body-marker"
    # → 行のすべての列の値（str にして）に、トークン全体、secret 部分、"query-marker"、"body-marker" が含まれない

def test_paths_outside_agent_prefixes_are_not_audited(session):
    # get_current_user を上書きした状態で、有効なトークンを付けて GET /api/agentic と GET /api/user/hook-tokens → 行は 0

def test_unhandled_exception_is_audited_as_500(session, monkeypatch):
    # hooks.quick_task_service.create_quick_task を RuntimeError にする、TestClient(app, raise_server_exceptions=False)
    # → 応答 500、行の status_code == 500

def test_audit_write_failure_does_not_fail_response(session, monkeypatch, caplog):
    # session_factory を例外にする → 201、caplog に "Failed to write agent audit log"

def test_audit_middleware_runs_inside_default_rate_limit():
    classes = [m.cls for m in app.user_middleware]  # [0] が最も外側
    assert classes.index(AgentAuditMiddleware) > classes.index(DefaultRateLimitMiddleware)
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_audit.py -v` → `ImportError: cannot import name 'AgentAuditLog'` で FAIL
- [ ] **Step 3: `AgentAuditLog`、`SKIP_AUDIT_STATE`、`agent_audit.py` を実装し、`main.py` に登録する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS。`uv run pytest tests/test_hook_tokens.py tests/test_agent_auth.py -v` も PASS
- [ ] **Step 5: Commit** — `feat(agent): Record agent requests in agent_audit_logs`

---

### Task 3: 90 日の保持ジョブ

**Files:**
- Modify: `apps/api/src/humancompiler_api/agent_audit.py`、`scheduler/notification_scheduler.py`
- Test: `apps/api/tests/test_agent_audit.py`（追記）

**Interfaces:**
- Consumes: `AgentAuditLog`、`session_factory`（Task 2）
- Produces:
  - `agent_audit.AUDIT_LOG_RETENTION = timedelta(days=90)`
  - `def purge_expired_audit_logs(session: Session, now: datetime | None = None) -> int`（`created_at < now - AUDIT_LOG_RETENTION` の行を1文の DELETE で消して commit し、件数を返す）
  - `notification_scheduler.purge_expired_agent_audit_logs()`（async。`with session_factory() as session:` で上を呼ぶ。例外は他のジョブと同じく `logger.error` で出して投げない）。`start_notification_scheduler` に `"interval", days=1, id="agent_audit_log_retention"` で登録し、モジュールの docstring と開始時のログに追記する

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_purge_deletes_rows_older_than_90_days(session):
    # now 固定。created_at = now-91d / now-89d の2行 → 戻り値 1、残るのは now-89d の行

def test_retention_job_is_registered_daily(monkeypatch):
    # get_scheduler() の start を no-op にして start_notification_scheduler()
    # job = get_scheduler().get_job("agent_audit_log_retention")、job.trigger.interval == timedelta(days=1)
    # 後片付けで追加したジョブを remove する

async def test_retention_job_swallows_errors(monkeypatch, caplog):
    # session_factory を例外にして await purge_expired_agent_audit_logs() → 例外なし、caplog にエラー
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_audit.py -k "purge or retention" -v` → `ImportError` で FAIL
- [ ] **Step 3: `purge_expired_audit_logs` とジョブを実装する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS
- [ ] **Step 5: Commit** — `feat(agent): Purge agent audit logs after 90 days`

---

### Task 4: トークン単位と認証失敗の rate limit

**Files:**
- Create: `apps/api/src/humancompiler_api/agent_rate_limit.py`
- Modify: `apps/api/src/humancompiler_api/agent_auth.py`（`get_agent_principal`）、`exceptions.py`（`http_exception_handler`）
- Test: `apps/api/tests/test_agent_rate_limit.py`

**Interfaces:**
- Consumes: `get_client_ip`（`client_ip.py`）、`SKIP_AUDIT_STATE`（Task 2）、`settings.environment`
- Produces:
  - `TOKEN_LIMIT = parse("120 per minute")`、`AUTH_FAILURE_LIMIT = parse("20 per minute")`
  - `class AgentRateLimiter`: `MemoryStorage` と `MovingWindowRateLimiter` を持つ。属性 `enabled: bool`（既定 `settings.environment != "test"`）
    - `hit_token(self, token_id: UUID) -> int | None`: 1回数え、上限を超えたら `Retry-After` の秒数（`get_window_stats` の `reset_time - time.time()` を切り上げ、最小 1。`rate_limiter.py` と同じ計算）、超えなければ None
    - `auth_failure_retry_after(self, client_ip: str) -> int | None`: 数えずに確かめる（`test`）。上限に達していれば秒数
    - `record_auth_failure(self, client_ip: str) -> None`: 1回数える
    - `reset(self) -> None`
    - `enabled` が False のときは、どれも何もせず None を返す
  - モジュール変数 `agent_rate_limiter = AgentRateLimiter()`
  - `get_agent_principal` の新しい順序:
    1. `extract_agent_token`（ヘッダーなしの 401 は数えない）
    2. `auth_failure_retry_after(get_client_ip(request))` が秒数を返したら、`setattr(request.state, SKIP_AUDIT_STATE, True)` して 429（`detail="Too many failed agent authentication attempts"`、`headers={"Retry-After": str(秒数)}`）。ハッシュでの照合はしない
    3. ハッシュで照合し、なければ `record_auth_failure` してから 401
    4. principal を作って `request.state.agent_principal` に置く（429 も principal 付きで記録されるように、ここで置く）
    5. `hit_token(principal.token_id)` が秒数を返したら 429（`detail="Agent token rate limit exceeded"`、`Retry-After`）
    6. `touch_last_used`
  - `http_exception_handler` は `JSONResponse(..., headers=getattr(exc, "headers", None))` にする

テストの準備: fixture で `monkeypatch.setattr(agent_rate_limiter, "enabled", True)`、前後で `agent_rate_limiter.reset()`。既定の limiter はテスト環境で無効のままなので、120 回を超えるリクエストでも既定の 200/分にはかからない。Task 2 と同じく本体の `app` と `session_factory` の差し替えを使う。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_token_limit_allows_120_per_minute_then_429(session):
    # 同じトークンで POST /api/hooks/quick-tasks を 120 回 → すべて 201、121 回目 → 429、int(Retry-After) >= 1

def test_token_limit_is_per_token(session):  # A を使い切った後、同じ IP から B → 201

def test_token_limit_429_is_audited_with_token(session):  # 最後の行が status 429、token_id == A

def test_auth_failure_limit_blocks_ip_after_20_failures(session):
    # 毎回違う偽の prefix（f"hc_agent_{i:08d}_" + "x" * 43）で 20 回 → すべて 401、21 回目 → 429 と Retry-After
    # その後、同じ IP から有効なトークン → 429

def test_auth_failure_429_is_not_audited(session):
    # 偽のトークンで 20 回失敗（401）→ さらに 2 回（429）→ 行は 20（401 の分だけ）

def test_missing_header_does_not_count_as_auth_failure(session):
    # ヘッダーなしで 25 回 → すべて 401、その後に有効なトークン → 201

def test_changing_forwarded_for_does_not_reset_auth_failures(session):
    # 毎回違う X-Forwarded-For と Fly-Client-IP（FLY_APP_NAME は未設定）で 20 回失敗 → 21 回目は 429

def test_limits_are_inactive_when_disabled(session, monkeypatch):
    # enabled=False で 25 回失敗 → すべて 401

def test_http_exception_headers_reach_the_client(session):
    # ヘッダーなしで POST /api/hooks/quick-tasks → 401 と WWW-Authenticate: Bearer（本体のアプリ経由）
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_rate_limit.py -v` → `ModuleNotFoundError: humancompiler_api.agent_rate_limit` で FAIL
- [ ] **Step 3: `agent_rate_limit.py` を実装し、`get_agent_principal` と `http_exception_handler` を直す**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS。`uv run pytest tests/test_agent_auth.py tests/test_agent_audit.py tests/test_hook_tokens.py tests/test_error_handlers.py tests/test_main.py -v` も PASS
- [ ] **Step 5: Commit** — `feat(agent): Rate limit agent tokens and failed authentication`

---

### Task 5: トークン管理 API `/api/user/agent-tokens`

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`（`HookTokenCreatedResponse` の直後にスキーマ、`AgentScope` の直後に説明）
- Modify: `apps/api/src/humancompiler_api/services.py`（`AgentTokenService`）
- Modify: `apps/api/src/humancompiler_api/agent_audit.py`
- Create: `apps/api/src/humancompiler_api/routers/agent_tokens.py`
- Modify: `apps/api/src/humancompiler_api/main.py`（import と `app.include_router(agent_tokens.router)`）
- Test: `apps/api/tests/test_agent_tokens_api.py`

**Interfaces:**
- Consumes: `agent_token_service`（PR1）、`AgentAuditLog`（Task 2）、`get_current_user`
- Produces:
  - `AGENT_SCOPE_DESCRIPTIONS: dict[AgentScope, str]`（すべてのスコープを持つ。文言は spec のスコープの表から取る。`context:read` は「context export（Markdown）の取得。ノート、タスク、作業履歴、日次ノートをまとめて読むため、実質的に広い読み取り権限になる」）
  - `AgentTokenCreate(BaseModel)`: `name: str = Field(min_length=1, max_length=100)`（`HookTokenCreate` と同じ strip と空文字の検証）、`description: str | None = Field(default=None, max_length=500)`（strip して空なら None）、`scopes: list[AgentScope] = Field(min_length=1)`。未知のスコープは pydantic の enum 検証で 422 になる
  - `AgentTokenResponse(BaseModel)`: `id`、`name`、`description`、`scopes: list[str]`、`token_prefix`、`last_used_at`、`created_at`、`updated_at`（`from_attributes`、日時の serializer は `HookTokenResponse` と同じ）。`token_hash` は持たない
  - `AgentTokenCreatedResponse(AgentTokenResponse)`: `token: str`
  - `AgentScopeInfo(BaseModel)`: `scope: str`、`description: str`
  - `AgentAuditLogResponse(BaseModel)`: `id`、`token_id`、`token_prefix`、`method`、`route`、`required_scope`、`status_code`、`duration_ms`、`client_ip`、`created_at`（日時の serializer は同上）
  - `AgentTokenService.get_owned_token(self, session, token_id: str | UUID, user_id: str | UUID) -> AgentToken`: 失効済みも含めて自分のトークンを返す。他人のものや存在しないものは `ResourceNotFoundError("AgentToken", …)`
  - `agent_audit.list_audit_logs_for_token(session: Session, token_id: UUID, user_id: UUID, limit: int) -> list[AgentAuditLog]`: `token_id` と `user_id` の両方で絞り、`created_at` 降順・`id` 降順
  - ルーター（`prefix="/api/user/agent-tokens"`、`tags=["agent-tokens"]`、すべて `get_current_user`）。`hook_tokens.py` と同じく、一覧と作成は `""` と `"/"`（`include_in_schema=False`）の両方:
    - `GET ""` → `list[AgentTokenResponse]`（`list_active_tokens`）
    - `POST ""` → 201 `AgentTokenCreatedResponse`（`create_token(session, user_id, name, scopes, description)`）
    - `GET "/scopes"` → `list[AgentScopeInfo]`（`AgentScope` の定義順）
    - `DELETE "/{token_id}"` → 204（`revoke_token`。他人のもの・失効済み・存在しないものは 404）
    - `GET "/{token_id}/audit-logs"` → `list[AgentAuditLogResponse]`（`limit: int = Query(50, ge=1, le=200)`。`get_owned_token` で 404 を判定してから一覧）

テストの準備: `test_hook_tokens.py` と同じく `get_session` と `get_current_user` を上書きする。監査ログの行は `session` に直接 INSERT する。

- [ ] **Step 1: 失敗するテストを書く**

```python
def test_create_returns_secret_once_and_list_hides_it(session):
    # POST {name: " laptop ", description: "MacBook", scopes: ["tasks:read", "projects:read"]} → 201
    # token は "hc_agent_" で始まり、name == "laptop"、scopes == ["projects:read", "tasks:read"]
    # GET → 1件、"token" と "token_hash" のキーがない

def test_create_rejects_unknown_or_empty_scopes(session):
    # scopes=["proposals:write"] → 422、scopes=[] → 422、AgentToken は 0 行

def test_create_rejects_blank_name_and_long_description(session):  # name="  " → 422、description="x"*501 → 422

def test_revoke_makes_token_invalid_immediately(session):
    # quick_tasks:write で作成 → DELETE 204 → そのトークンで POST /api/hooks/quick-tasks → 401、GET の一覧から消える

def test_revoke_other_users_token_returns_404(session):  # 他人のトークンは有効なまま

def test_scopes_lists_every_scope_with_description():
    # GET /scopes → [s["scope"] for s in body] == [s.value for s in AgentScope]
    # context:read の description に "広い読み取り権限" が入る

def test_audit_logs_returns_newest_rows_for_own_token(session):
    # 自分のトークン A に3行、B に1行 → GET /{A}/audit-logs?limit=2 → A の新しい2行が降順、"route" と "client_ip" を含む

def test_audit_logs_limit_bounds(session):
    # limit=0 → 422、limit=201 → 422、55 行入れて limit なし → 50 行

def test_audit_logs_for_revoked_own_token_are_listed(session):  # 失効後も 200

def test_audit_logs_for_other_users_token_returns_404(session):
```

- [ ] **Step 2: 実行して失敗を確認する** — `uv run pytest tests/test_agent_tokens_api.py -v` → 404（ルーターがない）や `ImportError` で FAIL
- [ ] **Step 3: スキーマ、`get_owned_token`、`list_audit_logs_for_token`、ルーターを実装し、`main.py` に登録する**
- [ ] **Step 4: 実行して成功を確認する** — 同じコマンドで PASS。`uv run pytest tests/test_agent_tokens.py tests/test_hook_tokens.py -v` も PASS
- [ ] **Step 5: Commit** — `feat(agent): Add agent token management API`

---

### Task 6: spec の更新、全体のチェック、PR

**Files:**
- Modify: `docs/design/agent-gateway.md`

- [ ] **Step 1: spec を更新する**
  - 「Rate limit」: 3段を2段（トークン単位、認証失敗）に書き直す。IP 単位の制御は `DefaultRateLimitMiddleware`（200/分、全リクエスト）が担うと書く。認証失敗は「ハッシュで照合する前に判定する」「ヘッダーがない 401 は数えない」「上限にかかった IP は正しいトークンでも 429」。`auth.py:42` の `_check_rate_limit` への言及を消す（#359 で削除済み）。「クライアント IP について」の #358 の前提は済んだことにする
  - 「監査ログの書き込み」: 応答を送り終えた後に書くこと、例外は 500 として記録すること、記録しない 429（既定の上限、認証失敗の上限）と記録する 429（トークン単位）、ミドルウェアを既定の rate limit の内側に置くこと
  - 「データモデル: `agent_audit_logs`」と「`037_add_agent_audit_logs.sql`」: `authenticated` に GRANT する列（11 列すべて）とその理由
  - 「テスト」の Rate limit の行: 「偽の prefix を毎回変えても IP 単位の上限で 429」を「認証失敗の上限で 429」に、ヘッダーなしは数えないことを足す
- [ ] **Step 2: Commit** — `docs(agent): Update the spec for PR2 rate limit and audit decisions`
- [ ] **Step 3: バックエンドのチェックをすべて流す**（`apps/api`）
  Run: `ruff check . --fix && ruff format . && mypy src && bandit -r src -s B101 && uv run pytest -v`。Postgres のテスト（035、037）は pgserver で流す
  Expected: すべて成功
- [ ] **Step 4: push して PR を作る**（タイトル `feat(agent): Add audit log, rate limits and token management API`、本文は英語。`Refs #360`）
  本文の **Deployment Notes**:
  1. マージの前に `037_add_agent_audit_logs.sql` を本番 DB に手動で適用する（新しいテーブルだけなので旧コードと互換。2回流してもよい）
  2. 確認用 SQL: `SELECT to_regclass('public.agent_audit_logs');` が NULL でないこと、`SELECT has_column_privilege('authenticated', 'public.agent_audit_logs', 'client_ip', 'SELECT'), has_table_privilege('authenticated', 'public.agent_audit_logs', 'INSERT'), has_any_column_privilege('anon', 'public.agent_audit_logs', 'SELECT');` が `t, f, f`
  3. デプロイ後、既存の hook で quick task を1件作り、`SELECT route, status_code, token_prefix FROM agent_audit_logs ORDER BY created_at DESC LIMIT 1;` に `/api/hooks/quick-tasks`、201 が入ること
  4. rate limit のカウンタは in-memory なので、デプロイや再起動でリセットされる（マシン1台の前提）
  5. 戻すときは、旧コードに戻した**後に** `037_add_agent_audit_logs_rollback.sql` を流す。035 も戻す場合は 037 を先に戻す
- [ ] **Step 5: #360 を更新する** — PR2 のチェックリストに PR へのリンクを足し、Decisions に「IP 単位の段はやめて既定の 200/分に任せる」「ヘッダーなしの 401 は認証失敗に数えない」「`authenticated` には 11 列すべてを GRANT する」を理由付きで追記する
