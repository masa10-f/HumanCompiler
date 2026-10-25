# Agent Gateway PR4a: エージェントトークンの設定画面と使い方ガイド Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 設定画面の「Hook Tokens」カードを「エージェントトークン」カードに置き換え（一覧、プリセット、スコープのチップ、1回だけの secret 表示、失効、直近の監査ログ）、使い方ガイドに Agent API の `curl` 例と `/api/agent/v1/me` を足す。

**Architecture:** プリセットとスコープの「広い権限」の印はバックエンドで定義し、`GET /api/user/agent-tokens/scopes` が `{scopes, presets}` として返す。Web はこの応答だけからプリセットとスコープのチェックボックスを組み立て、スコープやプリセットの一覧をコードに持たない（Project OS でスコープとプリセットが増えても Web を直さずに済む）。設定画面（1132 行）にはこれ以上足さず、カードを `components/settings/` の新しいコンポーネントに切り出す。バックエンドの `/api/user/hook-tokens` は残し、削除は PR4b で行う。

**Tech Stack:** FastAPI / Pydantic 2 / pytest（バックエンド）、Next.js 15 / React 18 / TypeScript strict / shadcn/ui / Jest + Testing Library（Web）

**Spec:** `docs/design/agent-gateway.md`（「プリセット」「トークン管理 API」「Web UI」「テスト」のフロントエンドの行）。関連: `docs/design/project-os.md`（ブランチ `claude/serene-dirac-vrc41w`、未承認）の「スコープ」の節。トラッキング: masa10-f/HumanCompiler#360

## 決めたこと

ユーザーの回答:

- **プリセットはバックエンドで定義し、`/scopes` が返す**。応答を `{scopes: [...], presets: [...]}` に変え、各スコープに `broad` を足す。`/scopes` はまだどの画面からも呼ばれていないので、形を変えても困る呼び出し元はない
- **プリセットの中身は spec のとおり**: 「Quick task hook」= `quick_tasks:write`、「読み取り専用エージェント」= すべての `:read`（`context:read` を含む）。「カスタム」はプリセットではなく、どのプリセットとも一致しない選択の状態として Web が表示する
- **監査ログは、トークンの行を展開すると直近 20 行**を表で出す。列は日時、リクエスト（メソッド + ルート）、ステータス、IP。401 / 403 / 429 は色を変える。必要スコープと処理時間は出さない

計画で決めたこと（レビューで確認してほしい点）:

- **「読み取り専用エージェント」のスコープはコードで `:read` で終わるものを集めて作る**。Project OS の `artifacts:read` を足すと自動で含まれる。並びは `AgentScope` の定義順
- **`broad` が true のスコープは `context:read` だけ**。`AGENT_BROAD_SCOPES` に置く。説明文の「広い読み取り権限」の文言はそのまま残す（Web は `broad` でバッジを出し、説明文も表示する）
- **作成ダイアログの初期状態はスコープなし（=「カスタム」）**。最小権限にするため、プリセットを自動では選ばない。スコープが1つもないと作成ボタンは押せない
- **プリセットの選択状態は、チェックしたスコープの集合から導く**（別の state を持たない）。プリセットを選ぶとチェックがそのプリセットのスコープに置き換わる。チェックを変えて一致しなくなると「カスタム」になる。「カスタム」を選んでもチェックは変えない
- **secret は作成後にカードの上部に表示し、コピーボタンを付ける**（今の Hook Tokens と同じ）。ダイアログは作成に成功したら閉じる。画面を再読み込みすると消える
- **カードの成功・失敗のメッセージはカードの中に出す**。設定画面の上部の `error` / `success` とは分ける（`TriageSettingsCard` と同じく独立したコンポーネントにするため）
- **ガイドのファイル名を `agent-token-usage-guide.tsx`（`AgentTokenUsageGuide`）に変える**。hook token の UI はなくなるので、名前を中身に合わせる。テストのファイル名も合わせる
- **Web の hook token のコード（`hookTokensApi`、`ApiClient` の3メソッド、`types/hook-token.ts`）は PR4a で消す**。バックエンドの `/api/user/hook-tokens` は PR4b まで残る
- **一覧に出るのは有効なトークンだけ**（API のとおり）。失効したトークンの監査ログは画面からは見えない
- **デプロイの順序**: API（`deploy-api.yml`）と Web（Vercel）はマージ後にそれぞれデプロイされる。新しい Web が古い API の `/scopes`（配列）を受け取る数分間は、Web は「スコープを読み込めませんでした」と表示し、一覧と失効は使える（Review Focus 2）

## Global Constraints

- バックエンドは `apps/api` で `uv run pytest`、`uv run ruff check . --fix`、`uv run ruff format .`、`uv run mypy src`、`uv run bandit -r src`（`-s B101` を付けない。CI と同じ）。`apps/api/src` で `assert` を使わない
- Web は `apps/web` で `pnpm type-check`、`pnpm lint`、`pnpm test`
- 新しいファイルには SPDX ヘッダー（`.spdx-header-typescript.txt` / `.spdx-header-python.txt`）
- UI の文言は日本語。スコープの値（`tasks:read` など）とルートはそのまま表示する
- Web にスコープ名やプリセットの一覧を書かない。テストのデータ（モックの応答）には書いてよい
- テストに JWT のような文字列や、大文字・小文字・数字の混ざった値を直接書かない（GitGuardian が secret と判定する。#389 で `hc_agent_Ab3dE5gH` が引っかかった）。トークンの例は `"hc_agent_" + "a".repeat(8)` のように同じ文字を繰り返して作る
- 他のユーザーのトークンや監査ログは API が 404 にする（PR2 で実装済み）。Web は自分のトークンの ID だけを使う
- commit は英語・Conventional Commits。`--amend` は使わない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- preview 用の DB は作らない。マイグレーションはない。PR はマージしない

## Review Focus

1. **カタログにないスコープを持つトークン**（古いコードへのロールバックや、将来のスコープ）: 一覧で生のスコープ名のチップとして表示し、落ちない → Task 4 の `shows unknown scopes as plain chips`
2. **`/scopes` が失敗する、または古い形（配列）を返す**: カードにエラーを出し、作成ボタンは押せない。一覧と失効は使える → Task 4 の `keeps the list usable when the scope catalog fails to load`
3. **作成に失敗する**（422、通信エラー）: ダイアログは開いたまま、入力とチェックを残してエラーを出す。secret は出ない → Task 2 の `keeps the input when creation fails`
4. **移行した `hc_hook_` トークン**: `quick_tasks:write` のチップ付きで一覧に出て、失効できる → Task 4 の `lists a migrated hook token and revokes it`
5. **監査ログの取得の失敗と0件**: 行の中にメッセージを出し、カードは落ちない → Task 3 の `shows a message when there are no rows` と `shows an error when loading fails`

---

## File Structure

| ファイル | 役割 |
|---|---|
| Modify `apps/api/src/humancompiler_api/models.py` | `AgentScopeInfo.broad`、`AgentTokenPresetInfo`、`AgentScopeCatalog`、`AGENT_BROAD_SCOPES`、`AGENT_TOKEN_PRESETS` |
| Modify `apps/api/src/humancompiler_api/routers/agent_tokens.py` | `/scopes` が `AgentScopeCatalog` を返す |
| Modify `apps/api/tests/test_agent_tokens_api.py` | `/scopes` のテスト |
| Create `apps/web/src/types/agent-token.ts` | API の型 |
| Modify `apps/web/src/lib/api.ts` | `ApiClient` のメソッドと `agentTokensApi`。hook token のコードを消す |
| Create `apps/web/src/lib/__tests__/agent-tokens-api.test.ts` | API クライアントのテスト |
| Create `apps/web/src/components/settings/agent-token-create-dialog.tsx` | 作成ダイアログ |
| Create `apps/web/src/components/settings/agent-token-audit-log.tsx` | 1つのトークンの監査ログの表 |
| Create `apps/web/src/components/settings/agent-tokens-card.tsx` | カード全体（一覧、secret、失効、ダイアログと監査ログの組み込み） |
| Create `apps/web/src/components/settings/__tests__/agent-token-create-dialog.test.tsx`、`agent-token-audit-log.test.tsx`、`agent-tokens-card.test.tsx` | 各コンポーネントのテスト |
| Rename `components/settings/hook-token-usage-guide.tsx` → `agent-token-usage-guide.tsx`（テストも） | 使い方ガイド |
| Modify `apps/web/src/app/settings/page.tsx`、`app/settings/__tests__/page.test.tsx` | Hook Tokens カードを `AgentTokensCard` に置き換える |
| Delete `apps/web/src/types/hook-token.ts` | |
| Modify `docs/design/agent-gateway.md` | 上の「決めたこと」 |

ブランチ: `feat/agent-tokens-settings-ui`（`main` から作成済み）

---

### Task 1: `/scopes` がプリセットと `broad` を返す

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`（`AGENT_SCOPE_DESCRIPTIONS` の後と `AgentScopeInfo`）
- Modify: `apps/api/src/humancompiler_api/routers/agent_tokens.py`（`list_agent_scopes`）
- Test: `apps/api/tests/test_agent_tokens_api.py`

**Interfaces:**
- Produces（HTTP）: `GET /api/user/agent-tokens/scopes` →
  `{"scopes": [{"scope": str, "description": str, "broad": bool}], "presets": [{"key": str, "label": str, "description": str, "scopes": [str]}]}`。`scopes` は `AgentScope` の定義順、`presets` は下の順

- [ ] **Step 1: 既存の `test_scopes_lists_every_scope_with_description` を新しい形に書き換え、テストを足す**

```python
def test_scopes_lists_every_scope_with_description(session: Session):
    setup_user(session)
    body = client.get(f"{BASE_URL}/scopes").json()
    assert [item["scope"] for item in body["scopes"]] == [s.value for s in AgentScope]
    assert all(item["description"] for item in body["scopes"])
    descriptions = {item["scope"]: item["description"] for item in body["scopes"]}
    assert "広い読み取り権限" in descriptions["context:read"]


def test_scopes_marks_only_context_read_as_broad(session: Session):
    setup_user(session)
    body = client.get(f"{BASE_URL}/scopes").json()
    assert [i["scope"] for i in body["scopes"] if i["broad"]] == ["context:read"]


def test_scopes_returns_presets_from_the_spec(session: Session):
    setup_user(session)
    presets = {p["key"]: p for p in client.get(f"{BASE_URL}/scopes").json()["presets"]}
    assert list(presets) == ["quick_task_hook", "read_only"]
    assert presets["quick_task_hook"]["label"] == "Quick task hook"
    assert presets["quick_task_hook"]["scopes"] == ["quick_tasks:write"]
    assert presets["read_only"]["label"] == "読み取り専用エージェント"
    assert presets["read_only"]["scopes"] == [
        "projects:read", "goals:read", "tasks:read", "quick_tasks:read", "logs:read",
        "work_sessions:read", "notes:read", "daily_plans:read", "context:read",
    ]
    assert all(p["description"] for p in presets.values())


def test_preset_scopes_are_all_grantable(session: Session):
    setup_user(session)
    body = client.get(f"{BASE_URL}/scopes").json()
    grantable = {item["scope"] for item in body["scopes"]}
    assert all(set(p["scopes"]) <= grantable for p in body["presets"])
```

- [ ] **Step 2: 実行して失敗を確かめる**

Run: `cd apps/api && uv run pytest tests/test_agent_tokens_api.py -k scopes -v`
Expected: 4 件 FAIL（応答が配列で `body["scopes"]` が引けない）

- [ ] **Step 3: `models.py` に定義を足す**

- `AGENT_BROAD_SCOPES: frozenset[AgentScope] = frozenset({AgentScope.CONTEXT_READ})`
- `class AgentTokenPresetInfo(BaseModel)`: `key: str`、`label: str`、`description: str`、`scopes: list[str]`
- `AGENT_TOKEN_PRESETS: tuple[AgentTokenPresetInfo, ...]`（定義順がそのまま応答の順）:
  - `quick_task_hook` / `Quick task hook` / `外部の hook から Quick Task を登録する（POST /api/hooks/quick-tasks）` / `[quick_tasks:write]`
  - `read_only` / `読み取り専用エージェント` / `Agent API の読み取りをすべて許可する。context:read（広い読み取り権限）を含む` / `AgentScope` のうち値が `:read` で終わるもの（定義順）
- `AgentScopeInfo` に `broad: bool` を足す
- `class AgentScopeCatalog(BaseModel)`: `scopes: list[AgentScopeInfo]`、`presets: list[AgentTokenPresetInfo]`
- `AGENT_TOKEN_PRESETS` のコメントに「Web はこの一覧からプリセットを組み立てる。プリセットの追加は Web の変更なしで画面に出る」と書く

- [ ] **Step 4: `list_agent_scopes` を `response_model=AgentScopeCatalog` に変える**

`broad=scope in AGENT_BROAD_SCOPES`、`presets=list(AGENT_TOKEN_PRESETS)`。docstring も合わせる。

- [ ] **Step 5: テストとチェックを通す**

Run: `cd apps/api && uv run pytest tests/test_agent_tokens_api.py -v && uv run ruff check . && uv run mypy src && uv run bandit -r src -q`
Expected: すべて PASS、bandit の issue 0

- [ ] **Step 6: Commit** — `feat(agent): Return token presets and broad flags from the scope catalog`

---

### Task 2: Web の型、API クライアント、作成ダイアログ

**Files:**
- Create: `apps/web/src/types/agent-token.ts`
- Modify: `apps/web/src/lib/api.ts`（`// === Hook Token API methods ===` の節と `hookTokensApi`、hook token の型の import）
- Create: `apps/web/src/components/settings/agent-token-create-dialog.tsx`
- Test: `apps/web/src/lib/__tests__/agent-tokens-api.test.ts`、`apps/web/src/components/settings/__tests__/agent-token-create-dialog.test.tsx`

**Interfaces:**
- Consumes: Task 1 の `/scopes` の形
- Produces:
  - `types/agent-token.ts`: `AgentToken { id, name, description: string | null, scopes: string[], token_prefix, last_used_at: string | null, created_at, updated_at }`、`AgentTokenCreate { name: string; description?: string; scopes: string[] }`、`AgentTokenCreated extends AgentToken { token: string }`、`AgentScopeInfo { scope, description, broad: boolean }`、`AgentTokenPreset { key, label, description, scopes: string[] }`、`AgentScopeCatalog { scopes: AgentScopeInfo[]; presets: AgentTokenPreset[] }`、`AgentAuditLog { id, token_id: string | null, token_prefix: string | null, method, route, required_scope: string | null, status_code: number, duration_ms: number, client_ip: string | null, created_at }`
  - `lib/api.ts`: `agentTokensApi = { getAll(): Promise<AgentToken[]>, create(data: AgentTokenCreate): Promise<AgentTokenCreated>, revoke(tokenId: string): Promise<void>, getScopes(): Promise<AgentScopeCatalog>, getAuditLogs(tokenId: string, limit: number): Promise<AgentAuditLog[]> }`。パスは `/api/user/agent-tokens`、`/api/user/agent-tokens/{id}`、`/api/user/agent-tokens/scopes`、`/api/user/agent-tokens/{id}/audit-logs?limit={limit}`
  - `getScopes()` は応答に `scopes` と `presets` の配列がなければ `Error("Unexpected scope catalog response")` を投げる（古い API の配列の応答を正しく失敗させるため）
  - `AgentTokenCreateDialog({ open, onOpenChange, catalog: AgentScopeCatalog, onCreate: (data: AgentTokenCreate) => Promise<void> })`。`onCreate` が resolve したらダイアログを閉じて入力を初期化する。reject したら開いたまま入力を残し、ダイアログ内に「エージェントトークンの作成に失敗しました」を出す

- [ ] **Step 1: API クライアントのテストを書く**（`context-export-api.test.ts` と同じモックの組み方）

- `getScopes` が `/api/user/agent-tokens/scopes` を GET し、`{scopes, presets}` をそのまま返す
- `getScopes` が配列（古い形）を受け取ると reject する
- `getAuditLogs("t1", 20)` が `/api/user/agent-tokens/t1/audit-logs?limit=20` を GET する
- `create` が `{name, description, scopes}` を POST し、`revoke` が DELETE する

- [ ] **Step 2: ダイアログのテストを書く**

テストの `catalog` には、スコープ `tasks:read`、`context:read`（`broad: true`）、`quick_tasks:write`、`artifacts:write`（Web のコードにない値）と、プリセット `read_only`（`tasks:read`、`context:read`）、`local_agent`（`tasks:read`、`artifacts:write`、ラベル「ローカルエージェント」）を入れる。

```tsx
it('builds presets and scopes from the catalog', ...)
// 「ローカルエージェント」のラジオと artifacts:write のチェックボックスが表示される
it('starts with no scopes and the custom preset', ...)
// 「カスタム」が選択状態、どのチェックもオフ、作成ボタンは disabled
it('replaces the checked scopes when a preset is chosen', ...)
// 「読み取り専用エージェント」を選ぶ → tasks:read と context:read がオン、quick_tasks:write はオフ
it('switches to custom when a scope is changed after a preset', ...)
// read_only を選んだ後に quick_tasks:write をオン → 「カスタム」が選択状態
it('marks broad scopes', ...)
// context:read の行に「広い読み取り権限」のバッジ。tasks:read の行にはない
it('submits the name, description and scopes', ...)
// 名前「Research agent」、説明「ResearchDistillator」、read_only → onCreate が
// { name: 'Research agent', description: 'ResearchDistillator', scopes: ['tasks:read', 'context:read'] } で呼ばれる
// 説明が空なら description を送らない
it('keeps the input when creation fails', ...)
// onCreate が reject → ダイアログは開いたまま、名前とチェックが残り、エラーメッセージが出る
it('disables the create button while submitting', ...)
// onCreate が pending の間は作成ボタンが disabled（二重送信を防ぐ）
```

- [ ] **Step 3: 実行して失敗を確かめる**

Run: `cd apps/web && pnpm test -- agent-tokens-api agent-token-create-dialog`
Expected: FAIL（モジュールがない）

- [ ] **Step 4: 型、`agentTokensApi`、`AgentTokenCreateDialog` を実装する**

ダイアログは `components/ui` の `Dialog`、`Input`、`Textarea`、`RadioGroup`、`Checkbox`、`Badge`、`Label` を使う。名前は `maxLength={100}`、説明は `maxLength={500}`（API の制限と同じ）。チェックした値は `catalog.scopes` の順で送る。選択中のプリセットは「チェックの集合と `preset.scopes` の集合が等しい最初のプリセット、なければカスタム」で求める。この段階では `hookTokensApi` などはまだ消さない（Task 4 で設定画面と一緒に消す）。

- [ ] **Step 5: テストを通す**

Run: `cd apps/web && pnpm test -- agent-tokens-api agent-token-create-dialog && pnpm type-check && pnpm lint`
Expected: PASS

- [ ] **Step 6: Commit** — `feat(web): Add agent token API client and creation dialog`

---

### Task 3: 監査ログの表

**Files:**
- Create: `apps/web/src/components/settings/agent-token-audit-log.tsx`
- Test: `apps/web/src/components/settings/__tests__/agent-token-audit-log.test.tsx`

**Interfaces:**
- Consumes: `agentTokensApi.getAuditLogs`、`AgentAuditLog`（Task 2）
- Produces: `AgentTokenAuditLog({ tokenId: string })`。マウント時に `getAuditLogs(tokenId, AUDIT_LOG_LIMIT)` を1回呼ぶ。`AUDIT_LOG_LIMIT = 20` をこのファイルで export する

- [ ] **Step 1: テストを書く**

```tsx
it('loads the latest 20 rows of the token', ...)
// getAuditLogs が ('t1', 20) で呼ばれる
it('shows time, request, status and IP', ...)
// 行に "GET /api/agent/v1/tasks"、"200"、"203.0.113.5" が出る。required_scope と duration_ms は出ない
it('highlights 401, 403 and 429', ...)
// 403 の行のステータスに data-variant="destructive"（Badge の variant）、200 の行にはない
it('shows a message when there are no rows', ...)
// 「まだ記録はありません（記録は 90 日で削除されます）」
it('shows an error when loading fails', ...)
// 「監査ログを読み込めませんでした」
```

- [ ] **Step 2: 実行して失敗を確かめる**

Run: `cd apps/web && pnpm test -- agent-token-audit-log`
Expected: FAIL

- [ ] **Step 3: 実装する**

`components/ui/table` を使う。日時は `toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "medium" })`。`client_ip` が null なら「—」。401 / 403 / 429 は `Badge variant="destructive"`、それ以外は `variant="outline"`。テストでバリアントを見分けられるよう、このコンポーネントで Badge に `data-variant` を渡す（`badge.tsx` は props をそのまま `div` に渡すので、`badge.tsx` は変えない）。

- [ ] **Step 4: テストを通す**

Run: `cd apps/web && pnpm test -- agent-token-audit-log && pnpm type-check && pnpm lint`
Expected: PASS

- [ ] **Step 5: Commit** — `feat(web): Show recent audit log rows of an agent token`

---

### Task 4: エージェントトークンのカードと設定画面の置き換え

**Files:**
- Create: `apps/web/src/components/settings/agent-tokens-card.tsx`
- Modify: `apps/web/src/app/settings/page.tsx`（hook token の state、`formatHookTokenDate`、`fetchHookTokens` などのハンドラー、730〜825 行のカード、1119 行付近の `ConfirmationModal`、使わなくなった import）
- Modify: `apps/web/src/lib/api.ts`（`hookTokensApi`、`getHookTokens` / `createHookToken` / `revokeHookToken`、hook token の型の import を消す）
- Delete: `apps/web/src/types/hook-token.ts`
- Test: `apps/web/src/components/settings/__tests__/agent-tokens-card.test.tsx`、`apps/web/src/app/settings/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `agentTokensApi`、型（Task 2）、`AgentTokenCreateDialog`（Task 2）、`AgentTokenAuditLog`（Task 3）、`AgentTokenUsageGuide`（Task 5。Task 4 の時点では既存の `HookTokenUsageGuide` を置き、Task 5 で差し替える）
- Produces: `AgentTokensCard()`（props なし）。設定画面は Hook Tokens カードの位置にこれを置く

- [ ] **Step 1: カードのテストを書く**（`agentTokensApi` をモックし、`AgentTokenCreateDialog` と `AgentTokenAuditLog` は本物を使う）

```tsx
it('lists tokens with name, prefix, scope chips and dates', ...)
// 名前、`"hc_agent_" + "a".repeat(8)`、"tasks:read" のチップ、「作成:」「最終使用: 未使用」
it('marks broad scope chips', ...)
// context:read のチップに「広い読み取り権限」の印（title か aria-label）
it('shows unknown scopes as plain chips', ...)
// カタログにない "runs:execute" を持つトークンでもチップが出て落ちない
it('creates a token and shows the secret once for copying', ...)
// ダイアログから作成 → カード上部に secret、コピーで clipboard.writeText(secret)。
// 一覧の先頭に追加される。もう一度作成すると前の secret は新しいものに置き換わる
it('lists a migrated hook token and revokes it', ...)
// prefix `"hc_hook_" + "b".repeat(8)`、scopes ["quick_tasks:write"] のトークンが出る。
// 失効 → 確認 → revoke(id) が呼ばれ、一覧から消える
it('expands the audit log of a token', ...)
// 「監査ログ」を押すと getAuditLogs(id, 20) が呼ばれる。閉じるまでは呼ばれない
it('keeps the list usable when the scope catalog fails to load', ...)
// getScopes が reject → 「スコープを読み込めませんでした」、作成ボタンは disabled、
// 一覧は表示され、失効はできる
it('shows an error when the token list fails to load', ...)
// getAll が reject → 「エージェントトークンを読み込めませんでした」
```

- [ ] **Step 2: `page.test.tsx` を書き換える**

`hookTokensApi` のモックと hook token の2つのテストを消し、`@/components/settings/agent-tokens-card` をモックして「設定画面にエージェントトークンのカードが出る」テストに置き換える。カードの振る舞いのテストは Step 1 に移した。

- [ ] **Step 3: 実行して失敗を確かめる**

Run: `cd apps/web && pnpm test -- agent-tokens-card settings`
Expected: FAIL

- [ ] **Step 4: `AgentTokensCard` を実装し、設定画面とクライアントから hook token のコードを消す**

- タイトル「エージェントトークン」、説明「エージェントや外部の hook が HumanCompiler のデータを読み書きするためのトークン。スコープは作成後に変更できません」
- マウント時に `getAll()` と `getScopes()` を並行して呼ぶ。どちらかが失敗しても、もう一方の結果は表示する
- 一覧の各行: 名前、説明（あれば）、`token_prefix…`、スコープのチップ（カタログの順、カタログにないものは最後に元の順で）、「作成: 日時」「最終使用: 日時 / 未使用」、「監査ログ」の開閉ボタン、「失効」ボタン
- `broad` のスコープのチップは警告の色にし、`title="広い読み取り権限"` を付ける
- 監査ログは `Collapsible` で開いたときだけ `AgentTokenAuditLog` をマウントする
- 失効は既存の `ConfirmationModal`。文言は「このエージェントトークンを失効してもよろしいですか？ 失効はすぐに反映され、元に戻せません。」
- secret の Alert には「この値は今だけ表示されます。安全な場所に保存してください。」を添える
- メッセージはカード内の `Alert` に出す（成功: 作成、コピー、失効。失敗: 読み込み、作成はダイアログ内、コピー、失効）
- `page.tsx` から hook token の state、ハンドラー、`formatHookTokenDate`、カード、モーダル、使わなくなった import（lint で確かめる）を消し、`<AgentTokensCard />` を置く

- [ ] **Step 5: テストとチェックを通す**

Run: `cd apps/web && pnpm test && pnpm type-check && pnpm lint && grep -rn "hookTokensApi\|hook-token\"\|types/hook-token" src`
Expected: すべて PASS、grep は何も出ない（使い方ガイドのファイル名は Task 5 で変える）

- [ ] **Step 6: Commit** — `feat(web): Replace the hook token settings with agent tokens`

---

### Task 5: 使い方ガイドに Agent API を足す

**Files:**
- Rename: `apps/web/src/components/settings/hook-token-usage-guide.tsx` → `agent-token-usage-guide.tsx`（`git mv`）
- Rename: `apps/web/src/components/settings/__tests__/hook-token-usage-guide.test.tsx` → `agent-token-usage-guide.test.tsx`
- Modify: `apps/web/src/components/settings/agent-tokens-card.tsx`（import の差し替え）

**Interfaces:**
- Produces: `AgentTokenUsageGuide()`（props なし。開閉とベース URL の決め方は今の `HookTokenUsageGuide` と同じ）

- [ ] **Step 1: テストを書き換え、足す**

既存の2つのテストはコンポーネント名だけ変えて残す。足すテスト:

```tsx
it('shows how to check a token with /api/agent/v1/me', ...)
// 'curl -H "Authorization: Bearer <AGENT_TOKEN>" https://api.example.com/api/agent/v1/me' を含む
it('shows a list request with paging', ...)
// "https://api.example.com/api/agent/v1/tasks?limit=50" と "next_cursor"、"cursor" の説明を含む
it('lists the agent API error responses', ...)
// 401、403（"Missing required scope"）、429（"Retry-After"）の行がある
it('keeps the quick task hook example with an agent token', ...)
// "POST https://api.example.com/api/hooks/quick-tasks"、"<AGENT_TOKEN>"、"quick_tasks:write" を含む
```

- [ ] **Step 2: 実行して失敗を確かめる**

Run: `cd apps/web && pnpm test -- agent-token-usage-guide`
Expected: FAIL

- [ ] **Step 3: ガイドを書き換える**

開いた中身を2つの節にする。

1. **Agent API**（`/api/agent/v1`）: 動作確認の `curl ... /api/agent/v1/me`（トークンの名前、prefix、スコープ、`user_id` が返る）。一覧の例 `curl ... "/api/agent/v1/tasks?limit=50"`（`tasks:read` が必要）と、応答の `items` / `next_cursor`、次のページは `cursor=<next_cursor>`、差分は `updated_since`（タイムゾーン付きの ISO 8601）で取れること。詳しい仕様は API の `/docs` にあること。認証ヘッダーは `Authorization: Bearer <AGENT_TOKEN>` または `X-HumanCompiler-Agent-Token: <AGENT_TOKEN>`。レスポンス: 401（トークンがない・無効・失効済み）、403（スコープが足りない。`detail` に `Missing required scope: <scope>`）、429（rate limit。`Retry-After` の秒数だけ待つ）
2. **Quick task hook**: 今の内容。`<HOOK_TOKEN>` を `<AGENT_TOKEN>` に変え、`quick_tasks:write` が必要と書く。認証ヘッダーには `X-HumanCompiler-Hook-Token`（既存の hook 向け）も残す

`buildCurlExample` は quick task 用のまま残し、Agent API 用に `buildMeExample(base)` と `buildListExample(base)` を足す。

- [ ] **Step 4: テストとチェックを通す**

Run: `cd apps/web && pnpm test && pnpm type-check && pnpm lint && grep -rn "HookTokenUsageGuide\|hook-token" src`
Expected: PASS、grep は何も出ない

- [ ] **Step 5: Commit** — `feat(web): Document the agent API in the token usage guide`

---

### Task 6: spec の更新と最終確認

**Files:**
- Modify: `docs/design/agent-gateway.md`（「プリセット」「トークン管理 API」「Web UI」「実装順序」の PR4）

- [ ] **Step 1: spec を更新する**

- 「プリセット」: プリセットはバックエンドの `AGENT_TOKEN_PRESETS` で定義し、`/scopes` が返す。読み取り専用は `:read` で終わるスコープから作る。「カスタム」は Web 上の状態
- 「トークン管理 API」: `/scopes` の応答の形（`{scopes: [{scope, description, broad}], presets: [{key, label, description, scopes}]}`）
- 「Web UI」: 作成ダイアログの初期状態はスコープなし、監査ログは展開すると直近 20 行（日時、メソッド + ルート、ステータス、IP）、ガイドのファイル名
- 「実装順序」の PR4 を PR4a（この PR）と PR4b（PR4a が本番で動くのを確かめてから、`HookToken` のモデルなどと `/api/user/hook-tokens` を削除）に分ける

- [ ] **Step 2: 全体のチェック**

Run: `cd apps/api && uv run pytest && uv run ruff check . && uv run ruff format --check . && uv run mypy src && uv run bandit -r src -q`
Run: `cd apps/web && pnpm test && pnpm type-check && pnpm lint && pnpm build`
Expected: すべて PASS

- [ ] **Step 3: 画面で確かめる**（ローカルで API と Web を起動できる場合）

トークンの作成（読み取り専用）→ secret をコピー → ガイドの `/me` の `curl` が 200 → `/tasks` が 200 → 監査ログに2行出る → 失効 → `/me` が 401。起動できない場合は PR に「画面での確認はマージ後に本番で行う」と書く。

- [ ] **Step 4: Commit** — `docs(design): Record the agent token settings UI decisions`

PR は「feat(web): Replace hook token settings with agent tokens」。本文に Deployment Notes（マイグレーションなし。API と Web のデプロイの間は作成ダイアログが数分使えないことがある）と、PR4b はこの PR が本番で動くのを確かめてから着手することを書く。#360 の PR4 の項目を PR4a / PR4b に分ける。
