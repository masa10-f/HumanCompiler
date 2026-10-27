# Agent Gateway: `hook_tokens` テーブルの削除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PR1（035）で `agent_tokens` にコピーし、PR4b（#392）でコードからも参照がなくなった `hook_tokens` テーブルを、マイグレーション 038 で削除する。

**Architecture:** SQL のマイグレーションを1つ足すだけで、アプリのコードは変えない。038 は前提を確かめてから `DROP TABLE` する。rollback は作らない（ユーザーの判断、2026-10-27）。そのため 038 の後は 035 の rollback もできなくなり、そのことを README と spec に書く。

**Tech Stack:** PostgreSQL 16（Supabase）、migration_manager、pytest（`NOTEBOOK_TEST_POSTGRES_URL` の Postgres テスト）

**Spec:** `docs/design/agent-gateway.md`（「範囲外」「既存 hook の移行」「マイグレーション」「実装順序」）。トラッキング: masa10-f/HumanCompiler#360 の「Later」

## 着手の条件

- PR4b（#392）が本番にデプロイされている（2026-10-26 の v158 で確認済み）。それより前のコードには `HookToken` モデルがあるが、PR1 以降はテーブルを読み書きしていないので、038 の適用で壊れることはない
- ブランチは `main` から作る: `refactor/drop-hook-tokens-table`

## 決めたこと

- **rollback は作らない**（ユーザーの判断）。`038_drop_hook_tokens_rollback.sql` は置かない。`migration_manager.rollback_migration("038_...")` は「Rollback file not found」で止まる
- **`CASCADE` を付けない**。`hook_tokens` に依存するビューなどが本番にあれば、黙って一緒に消さずに、マイグレーションを失敗させる。インデックス、RLS ポリシー、GRANT、COMMENT はテーブルと一緒に消える
- **前提チェック**: `hook_tokens` があって `agent_tokens` がない（035 が未適用）なら、`RAISE EXCEPTION` で止める。コピーされていないトークンを消さないため。035 と同じく `DO '...'` の形で書く（中の `'` は `''`）
- **2回目の適用は何もしない**（`DROP TABLE IF EXISTS`。両方のテーブルがない環境でも通る）。手で適用した 038 は `schema_migrations` に記録されないため、次の起動時に migration_manager がもう一度流す
- **035 は変えない**。035 は `hook_tokens` がないと止まるが、本番では記録済みで再実行されない。新しい DB では 024 → 035 → 038 の順に流れる。適用済みのファイルは書き換えない
- **035 の rollback ファイルも変えない**。038 の後に実行すると最初の `UPDATE public.hook_tokens` で失敗し、何も変わらない。README にそう書く

## Global Constraints

- マイグレーションは本番に1回目を手で適用し、2回目を起動時の migration_manager が流しても壊れないこと
- `apps/api/src` は変えない（`assert` も足さない）
- テストの偽のトークンは同じ文字の繰り返しで作る（例: `"hc_hook_" + "p" * 8`）
- 新しいファイルには SPDX ヘッダーを付ける（`.spdx-header-python.txt`）。SQL のマイグレーションは既存のファイルにそろえて、ヘッダーではなく `-- Migration:` のコメントで始める

## Review Focus

1. **035 が未適用の DB に 038 を流す**: 止まり、`hook_tokens` は残る → `test_038_refuses_without_agent_tokens`
2. **起動時の2回目の適用**: エラーにならない → `test_038_can_be_applied_twice`
3. **`hook_tokens` に依存するオブジェクトがある**: 失敗し、テーブルは残る → `test_038_does_not_drop_dependent_objects`
4. **`agent_tokens` の行（移行した `hc_hook_` トークンを含む）**: 消えない → `test_038_keeps_agent_tokens`
5. **038 の後の 035 rollback**: できないことが README と spec に書いてある → Step 5 で確かめる

---

### Task 1: マイグレーション 038 で `hook_tokens` を削除する

**Files:**
- Create: `apps/api/migrations/038_drop_hook_tokens.sql`
- Create: `apps/api/tests/test_drop_hook_tokens_migration_postgres.py`
- Modify: `apps/api/migrations/README.md`（「Available Migrations」に 038 を追加）
- Modify: `docs/design/agent-gateway.md`

**Interfaces:**
- Consumes: `tests/postgres_migration_helpers.py` の `run_migration(cursor, schema, name)`、`create_supabase_objects(cursor)`
- Produces: なし

- [ ] **Step 1: Postgres テストを書く**

`test_agent_audit_logs_migration_postgres.py` と同じ形にする（`pytestmark` の skipif、スキーマを `uuid4` で分ける `db` fixture、最後に `connection.rollback()`）。fixture では次を作る:
- `users (id UUID PRIMARY KEY)`
- `run_migration(cursor, schema, "024_add_hook_tokens.sql")` で `hook_tokens`
- `agent_tokens (id UUID PRIMARY KEY, user_id UUID, token_prefix VARCHAR(32))`
- `hook_tokens` と `agent_tokens` に、同じ id の行を1行ずつ入れる。`token_hash` は `"a" * 64`、`token_prefix` は `"hc_hook_" + "p" * 8`

`to_regclass(%s)` に `f"{schema}.hook_tokens"` を渡して、テーブルがあるかを確かめる。

```python
MIGRATION = "038_drop_hook_tokens.sql"

def test_038_drops_hook_tokens(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    assert table_exists(cursor, schema, "hook_tokens") is False

def test_038_can_be_applied_twice(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    run_migration(cursor, schema, MIGRATION)
    assert table_exists(cursor, schema, "hook_tokens") is False

def test_038_keeps_agent_tokens(db):
    cursor, schema = db
    run_migration(cursor, schema, MIGRATION)
    cursor.execute(f'SELECT id::text, token_prefix FROM "{schema}".agent_tokens')
    assert cursor.fetchall() == [(TOKEN_ID, "hc_hook_" + "p" * 8)]

def test_038_refuses_without_agent_tokens(db):
    cursor, schema = db
    cursor.execute(f'DROP TABLE "{schema}".agent_tokens')
    cursor.execute("SAVEPOINT before_038")
    with pytest.raises(psycopg2.errors.RaiseException, match="035"):
        run_migration(cursor, schema, MIGRATION)
    cursor.execute("ROLLBACK TO SAVEPOINT before_038")
    assert table_exists(cursor, schema, "hook_tokens") is True

def test_038_does_not_drop_dependent_objects(db):
    cursor, schema = db
    cursor.execute(
        f'CREATE VIEW "{schema}".hook_token_names AS SELECT name FROM "{schema}".hook_tokens'
    )
    cursor.execute("SAVEPOINT before_038")
    with pytest.raises(psycopg2.errors.DependentObjectsStillExist):
        run_migration(cursor, schema, MIGRATION)
    cursor.execute("ROLLBACK TO SAVEPOINT before_038")
    assert table_exists(cursor, schema, "hook_tokens") is True
```

`run_migration` は `public.` を置き換えるだけなので、DO ブロックの中の `to_regclass(''public.agent_tokens'')` もテスト用のスキーマに置き換わる。

- [ ] **Step 2: 実行して失敗を確かめる**

ローカルの PostgreSQL 16 を起動し、`NOTEBOOK_TEST_POSTGRES_URL` にその URL を渡す（例: `postgresql://notebook_test@localhost:55432/notebook_test`）。CI では `.github/workflows/notebook-search.yml` が同じテストを流す。

Run: `cd apps/api && NOTEBOOK_TEST_POSTGRES_URL=... uv run pytest tests/test_drop_hook_tokens_migration_postgres.py -v`
Expected: 038 のファイルがないので、5件とも FAIL（または ERROR）

- [ ] **Step 3: `038_drop_hook_tokens.sql` を書く**

先頭は `-- Migration: Drop hook_tokens` と `-- Date: 2026-10-27`、それに次の内容の `-- Description:` を書く。
- 035 で `agent_tokens` にコピー済み
- PR4b からはコードが参照しない
- rollback はない。038 の後は 035 の rollback もできない

本体は次の2文。
1. `DO '...'`: `to_regclass(''public.hook_tokens'') IS NOT NULL AND to_regclass(''public.agent_tokens'') IS NULL` なら、`RAISE EXCEPTION ''Required table public.agent_tokens is missing. Apply 035_add_agent_tokens.sql before 038_drop_hook_tokens.sql.''`
2. `DROP TABLE IF EXISTS public.hook_tokens;`（`CASCADE` なし）

- [ ] **Step 4: テストとチェックを通す**

Run: `cd apps/api && NOTEBOOK_TEST_POSTGRES_URL=... uv run pytest tests/test_drop_hook_tokens_migration_postgres.py tests/test_agent_tokens_migration_postgres.py tests/test_migration_manager.py -v && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run bandit -r src -q`
Expected: すべて PASS。035 の Postgres テストは、自分で `hook_tokens` を作るので影響を受けない

- [ ] **Step 5: README と spec を更新する**

`migrations/README.md` の「Available Migrations」の 037 の後に、035・037 と同じ調子で 038 を足す。内容は次のとおり。
- `hook_tokens` を削除する。PR4b の API をデプロイした後に適用する
- `agent_tokens` がないと止まる。2回適用しても安全
- rollback はない。行を残したい場合は先にバックアップを取る
- 038 の後は 035 の rollback もできない（最初の `UPDATE public.hook_tokens` で失敗する）
- 適用する前の確認の SQL:
  `SELECT count(*) FROM public.hook_tokens h WHERE NOT EXISTS (SELECT 1 FROM public.agent_tokens a WHERE a.id = h.id);`
  0 でない場合、その行は 035 の後に旧 API で作られたものです。PR1 以降のコードでは使えないので、消しても動いている hook には影響しません。

`docs/design/agent-gateway.md`:
- 「範囲外」から `hook_tokens` テーブルの削除の行を消す
- 「既存 hook の移行」の「`hook_tokens` は後続の別のマイグレーションで削除するまで残し」を、038 で削除したことに直す。rollback がないことも書く
- 「マイグレーション」に `### 038_drop_hook_tokens.sql` を足す（前提チェック、`CASCADE` なし、2回目は何もしない、rollback なし、035 の rollback ができなくなる）
- 「実装順序」の PR4b の項目の「`hook_tokens` テーブルは残し、後続の別のマイグレーションで削除する」に、038 で削除したことを足す

- [ ] **Step 6: Commit** — `refactor(db): Drop the hook_tokens table`

PR は「refactor(db): Drop the hook_tokens table」。本文の Deployment Notes には次を書く。
- 適用前の確認の SQL
- 必要ならバックアップを取ること
- rollback がないこと
- 適用の順序（PR4b のデプロイ後ならいつでもよい。merge の前に手で適用する）

#360 の「Later」の項目に PR のリンクを付ける。チェックは merge の後に入れる。
