# Agent Gateway PR4b: hook token の互換コードの削除 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Web がエージェントトークンの画面に移った（PR4a）後に残っている、`HookToken` のモデル、hook token の Pydantic モデル、`routers/hook_tokens.py`、`/api/user/hook-tokens` を削除する。

**Architecture:** コードの削除だけで、マイグレーションはない。`hook_tokens` テーブルは本番に残す（削除は #360 の「Later」の別マイグレーション）。`HookTokenService` は PR1（#361）で削除済みなので、この PR の対象ではない。`POST /api/hooks/quick-tasks`（`routers/hooks.py`）は残す。

**Tech Stack:** FastAPI、SQLModel（テストは SQLite in-memory）、pytest

**Spec:** `docs/design/agent-gateway.md`（「既存 hook の移行」「実装順序」）。前提: `docs/plans/2026-10-25-agent-gateway-pr4a.md`。トラッキング: masa10-f/HumanCompiler#360

## 着手の条件

- PR4a がマージされ、本番の設定画面でエージェントトークンの作成、secret のコピー、失効、監査ログの表示が動くことを確かめてある
- PR4a のデプロイ後、Fly.io のログに `/api/user/hook-tokens` へのリクエストがないこと（古いタブが残っていると来ることがある。来ていたら数日待つ）
- ブランチは PR4a のマージ後に `main` から作る: `refactor/remove-hook-token-adapter`

## 決めたこと

- **`User.hook_tokens` の Relationship も消す**。`hook_tokens.user_id` の外部キーは `ON DELETE CASCADE`（`024_add_hook_tokens.sql`）なので、ユーザーを消すときに ORM の関連がなくても行は消える。`src` にユーザーを ORM で削除するコードはない
- **SQLite のテストでは `hook_tokens` テーブルが作られなくなる**。Postgres のマイグレーションのテスト（`test_agent_tokens_migration_postgres.py`）は SQL で `hook_tokens` を作るので変えない
- **`tests/test_hook_tokens.py` は `tests/test_hook_quick_tasks.py` に名前を変え**、`/api/user/hook-tokens` のテストだけを消す。hook の受け口（`/api/hooks/quick-tasks`）のテストは残し、トークンは `/api/user/hook-tokens` ではなく `agent_token_service.create_token(..., [AgentScope.QUICK_TASKS_WRITE])` で作る

## Global Constraints

- PR4a の計画の Global Constraints と同じ（バックエンドの部分）
- `POST /api/hooks/quick-tasks` の URL、受け付けるヘッダー（Bearer、`X-HumanCompiler-Agent-Token`、`X-HumanCompiler-Hook-Token`）、レスポンスを変えない
- 移行した `hc_hook_` トークンは引き続き `/api/hooks/quick-tasks` で使える

## Review Focus

1. **移行した `hc_hook_` トークンで hook を呼ぶ**: 201 のまま → Task 1 の既存テスト `test_migrated_hook_token_works_with_both_headers` が残っていること
2. **古いタブからの `/api/user/hook-tokens`**: 404 になり、500 にならない → Task 1 の `test_hook_token_management_api_is_removed`
3. **ユーザーの削除**: ORM の関連がなくなっても、`agent_tokens` など他の関連の動きは変わらない → 既存のテストが通ること
4. **アプリの起動**: `HookToken` を参照していた import が残っていない → `uv run python -c "import humancompiler_api.main"`

---

### Task 1: hook token の互換コードを削除する

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`（`User.hook_tokens`、`class HookToken`、`HookTokenCreate`、`HookTokenResponse`、`HookTokenCreatedResponse`）
- Delete: `apps/api/src/humancompiler_api/routers/hook_tokens.py`
- Modify: `apps/api/src/humancompiler_api/routers/__init__.py`、`apps/api/src/humancompiler_api/main.py`（import と `include_router`）
- Rename + Modify: `apps/api/tests/test_hook_tokens.py` → `apps/api/tests/test_hook_quick_tasks.py`
- Modify: `docs/design/agent-gateway.md`

- [ ] **Step 1: テストを書き換える**

- `create_hook_token` を `agent_token_service.create_token` を使う形にする
- `/api/user/hook-tokens` を呼ぶテスト（`test_create_hook_token_returns_secret_once_and_stores_hash`、`test_hook_token_list_shows_only_hook_only_tokens`、`test_revoke_other_users_token_returns_404`、`test_revoke_broader_token_returns_404`）を消す。作成時に secret を1回だけ返すことと失効の所有チェックは `test_agent_tokens_api.py` にあることを確かめる
- `test_hook_token_service_is_removed` を次に置き換える（`from humancompiler_api import models` を足す）:

```python
def test_hook_token_management_api_is_removed(session: Session):
    seed_user(session)
    install_overrides(session)
    assert client.get("/api/user/hook-tokens").status_code == 404
    assert client.post("/api/user/hook-tokens", json={"name": "x"}).status_code in (404, 405)
    assert not hasattr(models, "HookToken")
    assert not hasattr(models, "HookTokenResponse")
```

- [ ] **Step 2: 実行して失敗を確かめる**

Run: `cd apps/api && uv run pytest tests/test_hook_quick_tasks.py -v`
Expected: `test_hook_token_management_api_is_removed` だけ FAIL

- [ ] **Step 3: コードを削除する**

- [ ] **Step 4: チェックを通す**

Run: `cd apps/api && uv run pytest && uv run ruff check . && uv run mypy src && uv run bandit -r src -q && uv run python -c "import humancompiler_api.main" && grep -rn --include=*.py "HookToken\|hook_tokens\b\|hook-tokens" src`
Expected: すべて PASS。grep は何も出ない（`routers/hooks.py` と `agent_auth.py` の `hook` は対象外の名前なので出ない）

- [ ] **Step 5: spec を更新する**

「既存 hook の移行」の「`HookToken` モデル、… は、Web を新しい管理画面に移した PR で削除する」を「PR4b で削除した。`hook_tokens` テーブルは別のマイグレーションで削除する」に変える。

- [ ] **Step 6: Commit** — `refactor(api): Remove the hook token compatibility API`

PR は「refactor(api): Remove the hook token compatibility API」。本文に「マイグレーションなし。`hook_tokens` テーブルは残る」と、着手の条件を確かめた結果を書く。#360 の PR4b の項目を閉じ、「Later」の `hook_tokens` の削除はそのまま残す。
