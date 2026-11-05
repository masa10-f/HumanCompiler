# G3 PR1: 提案インボックスのバックエンドの中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** エージェントが `POST /api/agent/v1/proposals` で提案を送り、ユーザーが Web 用 API で承認（編集して承認）・却下でき、その結果をエージェントが `GET /api/agent/v1/proposals` で取得できるようにする。

**Architecture:** 新しいテーブル `agent_proposals`（migration 039）と `AgentProposal` モデル。種類ごとの payload は `proposal_payloads.py` の Pydantic モデルで検証する。受け付け・承認・却下の規則は `proposal_service.py` にまとめ、承認は1つのトランザクションで実体（Goal / Task / Quick Task / ノートへの追記）を作る。Agent API は `routers/agent_proposals.py`、Web 用 API は `routers/proposals.py`。ノートへの追記の Markdown → HTML 変換は `note_markdown.py`。

**Tech Stack:** FastAPI、SQLModel（テストは SQLite in-memory、マイグレーションは PostgreSQL 16）、Pydantic 2、`markdown-it-py`、pytest

**Spec:** `docs/design/agent-proposals.md`（「提案の種類と payload」「データモデル」「承認と却下の動作」「スコープとトークンのプリセット」「Agent API」「Web 用 API」「マイグレーション」「セキュリティ」「テスト」のバックエンドの行）。続き: PR2（Web の画面）、PR3（デイリーダイジェスト）は別の計画にする。

## 決めたこと

- **PR1 にはマイグレーション 039 を入れる**。PR2 / PR3 にマイグレーションはない（設計書のとおり）。
- **`agent_proposals.project_id`（UUID NULL、外部キーなし）を持つ**。設計書で実装者に任された「プロジェクトでの絞り込み」のため。受け付けるときに payload から求めて入れ、承認で編集されたら求め直す。求め方: `goal` は `payload.project_id`、`task` は `goal_id` の Goal の `project_id`、`note_append` は `target` の Project / Goal / Task からたどる、`quick_task` は NULL、その他は `payload.project_id`（なければ NULL）。設計書の「データモデル」の表にも足す。
- **commit しない作成**: `BaseService` に `build(session, data, user_id) -> T` を足す（`_create_instance` → `id` 付与 → `add` → `flush`。commit しない）。`create` はこれを `safe_execute` で包む形に置き換える。承認では、所有の確認（`project_service.get_project` / `goal_service.get_goal` / `task_service.get_task`）をしてから `build` を呼び、最後に1回だけ commit する。
- **ノートは `get_or_create_note` を使わない**（途中で commit するため）。`proposal_service` の中で、同じ条件で探し、なければ `ContextNote` を `add` + `flush` する。`flush` で一意制約に当たったら（同時に作られた）409 を返す。
- **`edited` の判定**は、元の payload と編集後の payload を、どちらも種類ごとのモデルで検証してから `model_dump(mode="json")` で比べる（`"1.0"` と `1` のような表記の違いを編集とみなさない）。
- **本文の大きさの上限 64 KB は 413**（`Request` の本文の長さで判定する依存関数）。
- **エラーの `detail` は英語**（既存の Agent API と同じ）。Web は PR2 で、状態コードごとに日本語のメッセージを出す。
- **`kind` の値はスネークケース**（`quick_task`、`note_append`、`decision_request`）。

## Global Constraints

- 作業ディレクトリは `apps/api`。Python は `uv run` で動かす（システムの Python は 3.8）。テストは `uv run pytest`。プッシュ前のチェックは `CLAUDE.md` の「Backend Changes」（`ruff check . --fix`、`ruff format .`、`mypy src`、`bandit -r src -s B101`、`pytest -v`）。CI は `bandit -r src` を `-s B101` なしで動かすので、`src` に `assert` を書かない
- commit は英語・Conventional Commits。`--amend`、rebase、reset、force push は使わない。末尾に `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- 新しいファイルには SPDX ヘッダー（`.spdx-header-python.txt`）を付ける
- テストに JWT やトークンのような文字列（英大文字・小文字・数字の混ざった値）を直接書かない（GitGuardian が検出する）。トークンは `issue_token` で発行し、偽のものは `"hc_agent_" + "p" * 8` のように同じ文字の繰り返しで作る
- マイグレーションは追加だけ、旧コードと互換、2回実行しても安全。`DO` の本文は `$$` ではなく単一引用符（migration manager がセミコロンで分割するため。`037` と同じ）
- 他人の提案と存在しない提案はどちらも 404。payload の中の他人の ID と存在しない ID はどちらも同じ 422
- `kind`: `goal` / `task` / `quick_task` / `note_append` / `contradiction` / `decision_request` / `experiment`
- `status`: `pending` / `accepted` / `edited` / `rejected`。`reject_category`: `duplicate` / `wrong` / `not_valuable` / `not_now` / `other`。`result_type`: `goal` / `task` / `quick_task` / `context_note`
- 長さ: `title` 1〜200、`rationale` 0〜4000、`sources` 0〜20 件（`ref` 1〜500、`quote` 0〜1000、`label` 0〜200）、`idempotency_key` 1〜200、`decision_note` 0〜4000、`contradiction` / `decision_request` / `experiment` の自由記述の項目は 4000 まで、`note_append.content_markdown` 1〜20000
- 未処理の上限 200 件（`MAX_PENDING_PROPOSALS = 200`）。超えたら 409。冪等キーが一致すれば上限より先に既存のものを 200 で返す
- preview 用の DB は作らない。PR はマージしない（ユーザーがマイグレーションを本番に適用してからマージする）

## Review Focus

1. **2つのタブからの承認**: 2回目は 409 になり、Goal などが1つしかできないこと → Task 5 の `test_accept_twice_creates_one_entity`
2. **表記だけが違う編集**（`estimate_hours` を `"1.0"` と `1`、`due_date` を同じ時刻の別のオフセットで送る）: `edited` ではなく `accepted` になること → Task 5 の `test_accept_with_equivalent_payload_is_not_edited`
3. **payload の `goal_id` が他人の Goal**: 存在しない ID と同じ 422 で、提案が作られないこと → Task 3 の `test_create_rejects_other_users_reference_like_missing`
4. **`note_append` の本文に `<script>`、`<img onerror>`、`[x](javascript:…)`、`![a](b)`、`#### h4`**: どれも実行できる形で残らず、h4 は h3 になること → Task 4 の `test_markdown_to_note_html_neutralises_unsafe_input`
5. **インボックスが 200 件で埋まっているときに、同じ冪等キーで送り直す**: 409 ではなく既存の提案が 200 で返ること → Task 3 の `test_idempotent_replay_wins_over_pending_cap`

---

## File Structure

| ファイル | 役割 |
|---|---|
| Create `apps/api/migrations/039_add_agent_proposals.sql` / `039_add_agent_proposals_rollback.sql` | テーブル、CHECK、一意制約、インデックス、トリガー、RLS、GRANT |
| Create `apps/api/tests/test_agent_proposals_migration_postgres.py` | 039 を Postgres で確かめる |
| Modify `.github/workflows/notebook-search.yml` | 上のテストを Postgres のジョブの対象に足す |
| Modify `apps/api/src/humancompiler_api/models.py` | enum、`AgentProposal`、応答のモデル、スコープ、プリセット |
| Create `apps/api/src/humancompiler_api/proposal_payloads.py` | 種類ごとの payload のモデルと、POST の本文のモデル |
| Create `apps/api/src/humancompiler_api/proposal_service.py` | 受け付け、承認、却下、参照先の名前の取得 |
| Create `apps/api/src/humancompiler_api/note_markdown.py` | Markdown → ノートの HTML |
| Modify `apps/api/src/humancompiler_api/base_service.py` | `build` |
| Create `apps/api/src/humancompiler_api/routers/agent_proposals.py` | `/api/agent/v1/proposals` |
| Create `apps/api/src/humancompiler_api/routers/proposals.py` | `/api/proposals` |
| Modify `apps/api/src/humancompiler_api/main.py` | 2つのルーターの登録 |
| Modify `apps/api/pyproject.toml`、`uv.lock` | `markdown-it-py>=3.0.0` を直接の依存に |
| Create `apps/api/tests/test_proposal_payloads.py`、`test_agent_proposals_api.py`、`test_note_markdown.py`、`test_proposal_decisions.py`、`test_proposals_router.py` | テスト |
| Modify `apps/api/tests/test_agent_tokens_api.py`（ほかにプリセットやスコープの一覧を固定しているテストがあればそれも） | 新しいスコープとプリセット |
| Modify `docs/design/agent-proposals.md` | 状態を「承認済み」に、`project_id` の列を足す |

---

### Task 1: マイグレーション 039

**Files:**
- Create: `apps/api/migrations/039_add_agent_proposals.sql`、`apps/api/migrations/039_add_agent_proposals_rollback.sql`
- Create: `apps/api/tests/test_agent_proposals_migration_postgres.py`
- Modify: `.github/workflows/notebook-search.yml`（`paths` と、テストを実行する行の両方に足す。既存の `test_agent_audit_logs_migration_postgres.py` の並びに合わせる）

**Interfaces:**
- Produces: テーブル `public.agent_proposals`。列（この順）: `id UUID PK DEFAULT gen_random_uuid()`、`user_id UUID NOT NULL → users ON DELETE CASCADE`、`token_id UUID NULL → agent_tokens ON DELETE SET NULL`、`agent_name VARCHAR(100) NOT NULL`、`kind TEXT NOT NULL`、`title VARCHAR(200) NOT NULL`、`rationale TEXT NOT NULL DEFAULT ''`、`payload JSONB NOT NULL`、`final_payload JSONB NULL`、`sources JSONB NOT NULL DEFAULT '[]'::jsonb`、`idempotency_key VARCHAR(200) NOT NULL`、`project_id UUID NULL`、`status TEXT NOT NULL DEFAULT 'pending'`、`reject_category TEXT NULL`、`decision_note TEXT NULL`、`decision_option SMALLINT NULL`、`result_type TEXT NULL`、`result_id UUID NULL`、`decided_at TIMESTAMPTZ NULL`、`created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`、`updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`

- [ ] **Step 1: 失敗するテストを書く**（`037` のテストと同じ形。隔離したスキーマに `users`、`agent_tokens`、`update_updated_at_column()` だけを作り、`create_supabase_objects` を呼ぶ）

  - `test_039_applies_twice`: 2回適用してもエラーにならず、上の 21 列がある
  - `test_039_rejects_unknown_kind_status_category`: `kind='foo'`、`status='done'`、`reject_category='meh'`、`result_type='project'` の INSERT がそれぞれ `CheckViolation`
  - `test_039_rejected_requires_category`: `status='rejected'` で `reject_category` が NULL なら `CheckViolation`
  - `test_039_decision_note_length`: 4001 文字の `decision_note` は `CheckViolation`、4000 文字は通る
  - `test_039_idempotency_key_unique_per_user`: 同じユーザー・同じキーの2行目は `UniqueViolation`、別のユーザーなら通る
  - `test_039_updated_at_trigger`: `UPDATE … SET status='accepted', reject_category=NULL` で `updated_at` が進む
  - `test_039_deleting_token_keeps_proposal`: トークンを削除すると `token_id` が NULL になり、行は残る
  - `test_039_rollback_drops_table`: rollback の後にテーブルがなく、rollback を2回実行してもエラーにならない

- [ ] **Step 2: テストが失敗することを確かめる**

  ローカルの Postgres はメモリの local-postgres-pgserver の手順で起動する。
  Run: `NOTEBOOK_TEST_POSTGRES_URL=postgresql://notebook_test@localhost:55432/notebook_test uv run pytest tests/test_agent_proposals_migration_postgres.py -v`
  Expected: FAIL（マイグレーションのファイルがない）

- [ ] **Step 3: `039_add_agent_proposals.sql` と rollback を書く**

  - 前提のチェック（`users`、`agent_tokens`、`update_updated_at_column()`。`037` の形）
  - `CREATE TABLE IF NOT EXISTS`。CHECK は名前を付ける: `ck_agent_proposals_kind`、`ck_agent_proposals_status`、`ck_agent_proposals_reject_category`（NULL か5種類）、`ck_agent_proposals_rejected_has_category`（`status <> 'rejected' OR reject_category IS NOT NULL`）、`ck_agent_proposals_result_type`（NULL か4種類）、`ck_agent_proposals_decision_note_length`（`decision_note IS NULL OR char_length(decision_note) <= 4000`）、`ck_agent_proposals_title_nonempty`（`char_length(title) >= 1`）。一意制約 `uq_agent_proposals_user_idempotency (user_id, idempotency_key)`
  - インデックス: `idx_agent_proposals_user_status_created (user_id, status, created_at DESC)`、`idx_agent_proposals_user_updated (user_id, updated_at, id)`
  - トリガー `update_agent_proposals_updated_at`（`DROP TRIGGER IF EXISTS` の後に `CREATE`。書き方は `035` に合わせる）
  - RLS を有効にし、ポリシー `agent_proposals_own_rows`（`authenticated` に自分の行の SELECT）。`REVOKE ALL … FROM anon, authenticated` の後に、全列を列単位で `GRANT SELECT … TO authenticated`（secret がないため。`037` と同じ理由）
  - `COMMENT ON TABLE` と、`payload`（エージェントが送ったまま、変えない）、`final_payload`、`agent_name`、`project_id`（payload から求めた。外部キーなし）、`result_id`（外部キーなし）の `COMMENT ON COLUMN`
  - rollback: `DROP TABLE IF EXISTS public.agent_proposals`（`CASCADE` なし）

- [ ] **Step 4: テストが通ることを確かめる**

  Run: Step 2 と同じ
  Expected: 8 passed

- [ ] **Step 5: Commit**

  ```bash
  git add migrations/039_add_agent_proposals.sql migrations/039_add_agent_proposals_rollback.sql tests/test_agent_proposals_migration_postgres.py ../../.github/workflows/notebook-search.yml
  git commit -m "feat(db): Add agent_proposals table (039)"
  ```

---

### Task 2: モデル、payload の検証、スコープとプリセット

**Files:**
- Modify: `apps/api/src/humancompiler_api/models.py`
- Create: `apps/api/src/humancompiler_api/proposal_payloads.py`
- Create: `apps/api/tests/test_proposal_payloads.py`
- Modify: `apps/api/tests/test_agent_tokens_api.py`（スコープとプリセットの一覧を固定している箇所）

**Interfaces:**
- Produces（`models.py`）:
  - `class ProposalKind(StrEnum)`: `GOAL="goal"`、`TASK="task"`、`QUICK_TASK="quick_task"`、`NOTE_APPEND="note_append"`、`CONTRADICTION="contradiction"`、`DECISION_REQUEST="decision_request"`、`EXPERIMENT="experiment"`
  - `class ProposalStatus(StrEnum)`: `PENDING`、`ACCEPTED`、`EDITED`、`REJECTED`
  - `class ProposalRejectCategory(StrEnum)`: `DUPLICATE`、`WRONG`、`NOT_VALUABLE="not_valuable"`、`NOT_NOW="not_now"`、`OTHER`
  - `class ProposalResultType(StrEnum)`: `GOAL`、`TASK`、`QUICK_TASK`、`CONTEXT_NOTE="context_note"`
  - `class AgentProposal(SQLModel, table=True)`、`__tablename__ = "agent_proposals"`。Task 1 の列と同じ。`kind` / `status` / `reject_category` / `result_type` は `str` の列（TEXT。SQLAlchemy の `Enum` 型は使わない。値は上の `StrEnum` の `.value`）。`payload` / `final_payload` / `sources` は `JSON().with_variant(JSONB(), "postgresql")`。日時は `datetime.now(UTC)` の default_factory
  - `AgentScope.PROPOSALS_READ = "proposals:read"`（`CONTEXT_READ` の直後）、`AgentScope.PROPOSALS_WRITE = "proposals:write"`（`QUICK_TASKS_WRITE` の直後）。`AGENT_SCOPE_DESCRIPTIONS` に `"提案の一覧・取得（そのユーザーのすべての提案）"` と `"提案の送信（POST /api/agent/v1/proposals）"`
  - `AGENT_TOKEN_PRESETS` の末尾に `key="proposing_agent"`、`label="提案するエージェント"`、`description="Agent API の読み取りすべてと、提案の送信を許可する。context:read（広い読み取り権限）を含む"`、`scopes` = `:read` で終わるすべて（定義順）+ `proposals:write`
  - `class ProposalResult(BaseModel)`: `type: ProposalResultType`、`id: UUID`
  - `class AgentProposalResponse(BaseModel)`: `id`、`kind`、`status`、`title`、`rationale`、`payload: dict[str, Any]`、`final_payload: dict[str, Any] | None`、`sources: list[dict[str, Any]]`、`idempotency_key`、`agent_name`、`project_id: UUID | None`、`reject_category: ProposalRejectCategory | None`、`decision_note: str | None`、`decision_option: int | None`、`result: ProposalResult | None`、`created_at`、`decided_at: datetime | None`、`updated_at`。日時は UTC のタイムゾーン付きで直列化する（既存の `field_serializer` の形）。`token_id` は持たない。`classmethod from_row(row: AgentProposal) -> AgentProposalResponse`（`result_type` / `result_id` から `result` を作る）
  - `class ProposalResponse(AgentProposalResponse)`: `project_name: str | None`、`goal_title: str | None`、`task_title: str | None`（Web 用。参照先が消えていれば None）
- Produces（`proposal_payloads.py`。すべて `model_config = ConfigDict(extra="forbid")`）:
  - `ProposalSource(ref: str 1..500, quote: str | None ..1000, label: str | None ..200)`
  - `GoalProposalPayload(project_id: UUID, title: str 1..200, description: str | None ..1000, due_date: datetime | None)` — `due_date` は `prepare_due_date` / `require_due_date_timezone`（`models.py` の既存の関数）で検証
  - `TaskProposalPayload(goal_id: UUID, title, description, estimate_hours: Decimal gt=0 max_digits=5 decimal_places=2, due_date, work_type: WorkType | None, priority: int | None 1..5)`
  - `QuickTaskProposalPayload(title, description, estimate_hours: Decimal | None gt=0 max_digits=5 decimal_places=2, due_date, work_type, priority)`
  - `NoteTarget(project_id: UUID | None, goal_id: UUID | None, task_id: UUID | None)` — ちょうど1つが設定されていること（`model_validator`）
  - `NoteAppendPayload(target: NoteTarget, content_markdown: str 1..20000)`
  - `ContradictionClaim(text: str 1..4000, source_ref: str | None ..500)`、`ContradictionPayload(project_id: UUID | None, claims: list[ContradictionClaim] 2..5, explanation: str 1..4000, suggested_resolution: str | None ..4000)`
  - `DecisionOption(label: str 1..200, description: str | None ..4000)`、`DecisionRequestPayload(project_id: UUID | None, question: str 1..4000, options: list[DecisionOption] 0..6, recommendation: str | None ..4000, context: str | None ..4000)`
  - `ExperimentPayload(project_id: UUID | None, question, method, supports_if, refutes_if, effort: str 1..4000 each, estimated_hours: Decimal | None gt=0, prerequisites: str | None ..4000)`
  - `PAYLOAD_MODELS: dict[ProposalKind, type[BaseModel]]`
  - `EDITABLE_KINDS: frozenset[ProposalKind]` = goal / task / quick_task / note_append / experiment
  - `def parse_payload(kind: ProposalKind, data: dict[str, Any]) -> BaseModel`（`pydantic.ValidationError` をそのまま投げる）
  - `def normalize_payload(kind: ProposalKind, data: dict[str, Any]) -> dict[str, Any]`（`parse_payload(...).model_dump(mode="json")`）
  - `class ProposalCreateRequest(BaseModel, extra="forbid")`: `kind: ProposalKind`、`title: str 1..200`、`rationale: str = "" ..4000`、`payload: dict[str, Any]`、`sources: list[ProposalSource] = [] max 20`、`idempotency_key: str 1..200`。`model_validator(mode="after")` で `payload` を `normalize_payload` の結果に置き換える（検証の失敗は 422 になる）
  - `class ProposalAcceptRequest(BaseModel, extra="forbid")`: `payload: dict[str, Any] | None = None`、`decision_note: str | None ..4000`、`decision_option: int | None ge=0`
  - `class ProposalRejectRequest(BaseModel, extra="forbid")`: `reject_category: ProposalRejectCategory`、`decision_note: str | None ..4000`

- [ ] **Step 1: 失敗するテストを書く**（`tests/test_proposal_payloads.py`）

  - `test_each_kind_accepts_minimal_payload`: 7種類それぞれの最小の payload が `ProposalCreateRequest` を通る
  - `test_extra_field_is_rejected`: payload に未知の項目があると `ValidationError`
  - `test_note_target_requires_exactly_one`: `target` が `{}` と `{project_id, goal_id}` で `ValidationError`
  - `test_task_requires_estimate_hours`: `estimate_hours` がない `task` は `ValidationError`、`quick_task` は通る
  - `test_due_date_requires_timezone`: タイムゾーンのない `due_date` は `ValidationError`
  - `test_length_limits`: `title` 201 文字、`sources` 21 件、`claims` 1 件、`options` 7 件、`content_markdown` 20001 文字がそれぞれ `ValidationError`
  - `test_normalize_payload_is_stable`: `estimate_hours` の `"1.0"` と `1`、`due_date` の `2026-11-03T09:00:00+09:00` と `2026-11-03T00:00:00Z` で、`normalize_payload` の結果が等しい（`prepare_due_date` が UTC にそろえない場合は、`normalize_payload` で UTC にそろえる）
  - `test_tokens_api` 側: `/scopes` に `proposals:read` / `proposals:write` があり、プリセット `proposing_agent` のスコープが「`:read` のすべて + `proposals:write`」、`read_only` に `proposals:read` が入る

- [ ] **Step 2: テストが失敗することを確かめる**

  Run: `uv run pytest tests/test_proposal_payloads.py tests/test_agent_tokens_api.py -v`
  Expected: FAIL（`proposal_payloads` がない）

- [ ] **Step 3: `models.py` と `proposal_payloads.py` を Interfaces のとおりに書く**

- [ ] **Step 4: テストが通ることを確かめる**

  Run: `uv run pytest tests/test_proposal_payloads.py tests/test_agent_tokens_api.py tests/test_agent_tokens.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/humancompiler_api/models.py src/humancompiler_api/proposal_payloads.py tests/test_proposal_payloads.py tests/test_agent_tokens_api.py
  git commit -m "feat(api): Add agent proposal models, payload schemas and scopes"
  ```

---

### Task 3: 提案の受け付けと Agent API

**Files:**
- Create: `apps/api/src/humancompiler_api/proposal_service.py`
- Create: `apps/api/src/humancompiler_api/routers/agent_proposals.py`
- Modify: `apps/api/src/humancompiler_api/main.py`（`agent_v1.router` の直後に `app.include_router(agent_proposals.router)`）
- Create: `apps/api/tests/test_agent_proposals_api.py`

**Interfaces:**
- Consumes: Task 2 のモデル。`AgentPrincipal`、`require_scope`、`page_params` / `paginate` / `AgentPage`（`agent_pagination.py`）、`project_service.get_project` / `goal_service.get_goal` / `task_service.get_task`
- Produces（`proposal_service.py`）:
  - `MAX_PENDING_PROPOSALS = 200`
  - `def resolve_project_id(session: Session, user_id: UUID, kind: ProposalKind, payload: dict[str, Any]) -> UUID | None` — 参照する ID の所有を確かめ、プロジェクトを求める。所有していない・存在しない ID は `HTTPException(422, detail=f"Unknown {field}")`（`field` は `project_id` / `goal_id` / `target.task_id` など）
  - `def create_proposal(session: Session, principal: AgentPrincipal, data: ProposalCreateRequest) -> tuple[AgentProposal, bool]` — `(行, 新しく作ったか)`。順序: 冪等キーで既存を探す → あれば `(既存, False)` → 未処理が上限以上なら `HTTPException(409, "Proposal inbox is full")` → `resolve_project_id` → `agent_name` を `agent_tokens.name` から引く → INSERT して commit。commit で一意制約に当たったら rollback して既存を返す
- Produces（`routers/agent_proposals.py`、`router = APIRouter(prefix="/api/agent/v1", tags=["agent"])`）:
  - `POST /proposals`（`require_scope(AgentScope.PROPOSALS_WRITE)`、本文 64 KB 超は 413）→ 201 か 200、`AgentProposalResponse`
  - `GET /proposals`（`require_scope(AgentScope.PROPOSALS_READ)`）、クエリ `kind: list[ProposalKind]`、`status: list[ProposalStatus]` と `page_params()` → `AgentPage[AgentProposalResponse]`。ユーザーのすべての提案（トークンで絞らない）
  - `GET /proposals/{proposal_id}`（`proposals:read`）→ `AgentProposalResponse`。他人・存在しないは 404
  - OpenAPI の description（英語）に、冪等キーの指針（同じ根拠から同じキー、例 `distiller:<kind>:<source logical id>@<version hash>`、却下済みでも同じキーでは作り直されない）と、承認済みの実験の取り方（`?kind=experiment&status=accepted&status=edited`）を書く

- [ ] **Step 1: 失敗するテストを書く**（`tests/agent_api_helpers.py` の `client` / `seed_*` / `issue_token` / `bearer` / `use_session` を使う）

  - `test_create_returns_201_and_records_agent`: 201。`status == "pending"`、`agent_name` がトークン名、`project_id` が payload のもの、応答に `token_id` がない
  - `test_create_requires_proposals_write`: `proposals:read` だけのトークンで 403、`detail` に `proposals:write`
  - `test_create_rejects_invalid_payload_with_422`: 種類と合わない payload で 422、行が増えない
  - `test_create_rejects_other_users_reference_like_missing`: `task` の `goal_id` が他人の Goal と存在しない ID で、どちらも 422 で `detail` が同じ。`note_append` の `target.task_id` でも同じ
  - `test_resolves_project_for_each_kind`: `task` は Goal のプロジェクト、`note_append` の `target.goal_id` は Goal のプロジェクト、`quick_task` は None
  - `test_same_idempotency_key_returns_existing_with_200`: 2回目は 200 で同じ `id`、行は1つ。内容が違っても同じ。却下した後でも同じ
  - `test_idempotency_key_is_per_user`: 別のユーザーが同じキーで送ると 201
  - `test_pending_cap_returns_409`: 未処理 200 件で新しいキーは 409（行は 200 件のまま）。1件を却下すると次は 201
  - `test_idempotent_replay_wins_over_pending_cap`: 200 件のうちの1件のキーで送り直すと 200
  - `test_body_over_64kb_returns_413`
  - `test_list_returns_all_tokens_proposals_for_user_only`: トークン X と Y の提案がトークン Z（`proposals:read`）から両方見え、他人の提案は見えない
  - `test_list_filters_kind_and_status`: `?kind=experiment&status=accepted&status=edited` で該当のものだけ
  - `test_list_paginates_by_updated_at`: `limit=2` で `next_cursor` をたどって漏れも重複もない。行の `status` を更新して `updated_at` を進めると、`updated_since` で拾える
  - `test_get_other_users_proposal_is_404`
  - `test_deleted_token_keeps_agent_name`: トークンを失効させても、その提案の `agent_name` が残る
  - `test_proposal_requests_are_audited`: POST が `agent_audit_logs` に `required_scope = "proposals:write"`、ルートのテンプレート `/api/agent/v1/proposals` で1行残る

- [ ] **Step 2: テストが失敗することを確かめる**

  Run: `uv run pytest tests/test_agent_proposals_api.py -v`
  Expected: FAIL（404。ルーターがない）

- [ ] **Step 3: `proposal_service.create_proposal` / `resolve_project_id` とルーターを Interfaces のとおりに書き、`main.py` に登録する**

- [ ] **Step 4: テストが通ることを確かめる**

  Run: `uv run pytest tests/test_agent_proposals_api.py tests/test_agent_audit.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/humancompiler_api/proposal_service.py src/humancompiler_api/routers/agent_proposals.py src/humancompiler_api/main.py tests/test_agent_proposals_api.py
  git commit -m "feat(api): Accept agent proposals on the agent API"
  ```

---

### Task 4: commit しない作成と、ノートの HTML への変換

**Files:**
- Modify: `apps/api/src/humancompiler_api/base_service.py`
- Create: `apps/api/src/humancompiler_api/note_markdown.py`
- Modify: `apps/api/pyproject.toml`（`dependencies` に `"markdown-it-py>=3.0.0"`）、`apps/api/uv.lock`（`uv lock`）
- Create: `apps/api/tests/test_note_markdown.py`
- Modify: `apps/api/tests/test_base_service.py`

**Interfaces:**
- Produces:
  - `BaseService.build(self, session: Session, data: CreateT, user_id: str | UUID, **kwargs) -> T` — `_create_instance` → `id = uuid4()` → `add` → `flush`。commit しない。`create` は `safe_execute(session, lambda: self.build(...))` にする（振る舞いは変えない）
  - `note_markdown.markdown_to_note_html(markdown: str) -> str` — `MarkdownIt("commonmark", {"html": False})`、`image` の規則を無効にする（`![a](b)` は文字のまま残る）、`heading_open` / `heading_close` で h4〜h6 を h3 にする。リンクの検証は既定のまま（`javascript:` などは落ちる）
  - `note_markdown.agent_append_heading(agent_name: str, on: date) -> str` — `<p><strong>エージェントからの追記（YYYY-MM-DD、{agent_name を html.escape}）</strong></p>`
  - `note_markdown.append_html(existing: str, block: str) -> str` — 既存が空（空白だけを含む）なら `block`、そうでなければ `existing + block`

- [ ] **Step 1: 失敗するテストを書く**

  - `test_build_flushes_without_commit`（`test_base_service.py`）: `build` の後に `session.rollback()` すると行が残らない。`create` は今までどおり commit する
  - `test_markdown_to_note_html_basic`: 段落、`**強調**`、箇条書き、`- [ ]` は文字のまま（CommonMark にタスクリストはない）、コードブロック、`[a](https://example.com)` がリンクになる
  - `test_markdown_to_note_html_neutralises_unsafe_input`: `<script>alert(1)</script>` と `<img src=x onerror=alert(1)>` は `&lt;` でエスケープされ、`<script` も `<img` も出力に含まれない。`[x](javascript:alert(1))` は `href="javascript:` を含まない。`![a](https://example.com/a.png)` は `<img` を含まない。`#### 見出し` は `<h3>` になり `<h4>` を含まない
  - `test_agent_append_heading_escapes_name`: `agent_name = "<b>x</b>"` が `&lt;b&gt;` になる
  - `test_append_html_on_empty_and_existing`

- [ ] **Step 2: テストが失敗することを確かめる**

  Run: `uv run pytest tests/test_note_markdown.py tests/test_base_service.py -v`
  Expected: FAIL（`note_markdown` がない、`build` がない）

- [ ] **Step 3: Interfaces のとおりに書き、`uv lock` を実行する**

- [ ] **Step 4: テストが通ることを確かめる**

  Run: `uv run pytest tests/test_note_markdown.py tests/test_base_service.py tests/test_tasks_router.py tests/test_quick_tasks_router.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/humancompiler_api/base_service.py src/humancompiler_api/note_markdown.py pyproject.toml uv.lock tests/test_note_markdown.py tests/test_base_service.py
  git commit -m "feat(api): Add non-committing build and note markdown rendering"
  ```

---

### Task 5: 承認と却下

**Files:**
- Modify: `apps/api/src/humancompiler_api/proposal_service.py`
- Create: `apps/api/tests/test_proposal_decisions.py`

**Interfaces:**
- Consumes: Task 2 の `ProposalAcceptRequest` / `ProposalRejectRequest` / `parse_payload` / `normalize_payload` / `EDITABLE_KINDS`、Task 3 の `resolve_project_id`、Task 4 の `build` / `markdown_to_note_html` / `agent_append_heading` / `append_html`
- Produces（`proposal_service.py`）:
  - `def accept_proposal(session: Session, user_id: UUID, proposal_id: UUID, data: ProposalAcceptRequest) -> AgentProposal`
  - `def reject_proposal(session: Session, user_id: UUID, proposal_id: UUID, data: ProposalRejectRequest) -> AgentProposal`
  - どちらも、行を `select(...).where(id, user_id).with_for_update()` で読む。ないなら `HTTPException(404, "Proposal not found")`、`pending` でないなら `HTTPException(409, "Proposal already decided")`

承認の規則（設計書の「承認」の節のとおり）:

1. `data.payload` があり、`kind` が `EDITABLE_KINDS` にないなら 422（`"This kind cannot be edited"`）。あれば `parse_payload` で検証し、失敗は 422（`detail` に Pydantic のエラー）。
2. `decision_option` は `decision_request` だけ。ほかの種類で指定されたら 422。`decision_request` は、`0 <= decision_option < len(options)` か、空白でない `decision_note` の少なくとも一方が必要（なければ 422）。範囲外の番号も 422。
3. 参照先を `resolve_project_id` で確かめ直す。失敗したときの状態コードは、使った payload で変わる。
   - 元の payload のまま承認した場合（承認の前に参照先が削除された）: 409 `"Proposal target no longer exists; reject it instead"`
   - 編集した payload の参照が他人のもの・存在しないものの場合: 入力の誤りなので 422 のまま
4. 実体を作る: `goal` → `goal_service.build(session, GoalCreate(...), user_id)`、`task` → `task_service.build(session, TaskCreate(...), user_id)`、`quick_task` → `quick_task_service.build(session, QuickTaskCreate(...), user_id)`、`note_append` → ノートを探すかなければ作り（`flush` で `IntegrityError` なら 409 `"Note was created concurrently; retry"`）、`content` を `append_html(content, agent_append_heading(agent_name, 今日の Asia/Tokyo) + markdown_to_note_html(md))` に、`content_type` を `"html"` に、`updated_at` を今にする。`contradiction` / `decision_request` / `experiment` は何も作らない。
5. `final_payload = normalize_payload(kind, 使った payload)`。`status` は `final_payload == normalize_payload(kind, row.payload)` なら `accepted`、違えば `edited`。`project_id` は 3 の結果に。`decision_note`、`decision_option`、`result_type` / `result_id`、`decided_at = now(UTC)` を書いて、**1回だけ** commit する。途中の例外では rollback する。

却下: `reject_category` を書き、`decision_note`、`decided_at` を書いて commit。`final_payload` は NULL のまま。

- [ ] **Step 1: 失敗するテストを書く**（サービスを直接呼ぶ。提案の行は Task 3 の `create_proposal` か直接 INSERT で作る）

  - `test_accept_goal_creates_goal`、`test_accept_task_creates_task`、`test_accept_quick_task_creates_quick_task`: 実体ができ、`result_type` / `result_id` がそれを指し、`status == "accepted"`、`final_payload == payload`
  - `test_accept_with_edit_marks_edited`: `title` を変えると `edited`、作られた Goal の題が編集後のもの、`payload` は元のまま
  - `test_accept_with_equivalent_payload_is_not_edited`: Review Focus 2 の値で `accepted`
  - `test_accept_edit_can_move_task_to_another_owned_goal_and_updates_project_id`: 別のプロジェクトの自分の Goal に変えると、`project_id` も変わる
  - `test_accept_edit_with_other_users_goal_is_422`: 編集で他人の Goal に変えると 422 で、何も作られず `pending` のまま
  - `test_accept_twice_creates_one_entity`: 2回目は 409、Goal は1つ
  - `test_accept_after_target_deleted_returns_409_and_creates_nothing`: `task` の Goal を削除してから承認すると 409、Task は増えず、提案は `pending` のまま
  - `test_accept_rejects_edit_for_non_editable_kind`: `contradiction` に `payload` を付けると 422
  - `test_decision_request_needs_answer`: 選択肢も note もないと 422、範囲外の番号は 422、番号だけ・note だけはそれぞれ通る。ほかの種類で `decision_option` は 422
  - `test_accept_experiment_keeps_instructions`: `decision_note` が残り、実体はなく `result` は None
  - `test_note_append_creates_note_when_missing`、`test_note_append_appends_to_existing_html`: 見出しと変換した HTML が末尾に付き、`content_type == "html"`、`result_type == "context_note"`
  - `test_note_append_converts_markdown_note_to_html`: 既存が `content_type="markdown"` で空でなくても、追記後は `html`（Web は `content_type` を見ないため）
  - `test_failed_accept_rolls_back`: 実体の作成の後に失敗させる（`monkeypatch` で `normalize_payload` を2回目に例外にするなど）と、実体も提案の変更も残らない
  - `test_reject_records_category_and_note`、`test_reject_requires_category`（`ProposalRejectRequest` の検証で）、`test_reject_decided_is_409`
  - `test_other_users_proposal_is_404`（承認・却下の両方）

- [ ] **Step 2: テストが失敗することを確かめる**

  Run: `uv run pytest tests/test_proposal_decisions.py -v`
  Expected: FAIL（`accept_proposal` がない）

- [ ] **Step 3: `accept_proposal` / `reject_proposal` を規則のとおりに書く**

- [ ] **Step 4: テストが通ることを確かめる**

  Run: `uv run pytest tests/test_proposal_decisions.py tests/test_agent_proposals_api.py -v`
  Expected: PASS

- [ ] **Step 5: Commit**

  ```bash
  git add src/humancompiler_api/proposal_service.py tests/test_proposal_decisions.py
  git commit -m "feat(api): Accept and reject agent proposals"
  ```

---

### Task 6: Web 用 API（`/api/proposals`）

**Files:**
- Create: `apps/api/src/humancompiler_api/routers/proposals.py`
- Modify: `apps/api/src/humancompiler_api/main.py`（`app.include_router(proposals.router, prefix="/api")`）
- Modify: `apps/api/src/humancompiler_api/models.py`（下の応答のモデル）
- Modify: `apps/api/src/humancompiler_api/proposal_service.py`（`to_web_responses`）
- Create: `apps/api/tests/test_proposals_router.py`

**Interfaces:**
- Consumes: Task 5 の `accept_proposal` / `reject_proposal`、`get_current_user` / `AuthUser`
- Produces:
  - `models.py`: `ProposalListResponse(items: list[ProposalResponse], total: int)`、`ProposalSummaryItem(id, kind, title, agent_name, created_at)`、`ProposalSummaryResponse(pending_count: int, latest: list[ProposalSummaryItem])`
  - `proposal_service.to_web_responses(session: Session, user_id: UUID, rows: list[AgentProposal]) -> list[ProposalResponse]` — ページ内の `project_id`、Goal の ID（`task` の `goal_id`、`note_append` の `target.goal_id`）、Task の ID（`note_append` の `target.task_id`）を集め、所有の条件付きでそれぞれ1回の問い合わせで名前を引く（件数に比例して問い合わせが増えない）。見つからなければ None
  - `routers/proposals.py`（`router = APIRouter(prefix="/proposals", tags=["proposals"])`）:
    - `GET ""`: `status: Literal["pending", "decided"] = "pending"`、`kind: ProposalKind | None`、`project_id: UUID | None`、`limit: int = 50`（1..200）、`offset: int = 0`。`pending` は `created_at` の新しい順、`decided` は `status != pending` を `decided_at` の新しい順 → `ProposalListResponse`
    - `GET "/summary"` → `ProposalSummaryResponse`（未処理の件数と、新しい順の3件）
    - `GET "/{proposal_id}"` → `ProposalResponse`（他人・存在しないは 404）
    - `POST "/{proposal_id}/accept"`（本文 `ProposalAcceptRequest`）→ `ProposalResponse`
    - `POST "/{proposal_id}/reject"`（本文 `ProposalRejectRequest`）→ `ProposalResponse`

- [ ] **Step 1: 失敗するテストを書く**（`test_agent_tokens_api.py` の `install_overrides` の形で `get_session` と `get_current_user` を差し替える）

  - `test_list_pending_and_decided`: 未処理だけが新しい順に出る。`status=decided` は承認・却下したものが `decided_at` の新しい順。`total` が正しい
  - `test_list_filters_kind_and_project`
  - `test_list_shows_reference_names`: `task` の提案に `goal_title` と `project_name`、`note_append` の `target.task_id` に `task_title`。Goal を削除すると `goal_title` は None
  - `test_list_reference_names_use_constant_queries`: 20 件のページでも、名前を引く問い合わせの数が件数で増えない（`sqlalchemy.event` で SELECT を数える。`test_agent_v1_planning.py` の数え方に合わせる）
  - `test_summary_counts_pending_and_latest_three`
  - `test_accept_and_reject_via_router`: 承認で `result` が入り、却下で `reject_category` が入る。その結果が Agent API の `GET /api/agent/v1/proposals/{id}` でも同じに見える（却下の理由と `experiment` の追加の指示を含む。完了条件 2 と 3）
  - `test_other_users_proposal_is_404_everywhere`: 一覧に出ない、`/{id}`・accept・reject が 404
  - `test_agent_token_cannot_use_web_api`: エージェントトークンを `Authorization` に付けても `/api/proposals` は使えない（`get_current_user` の差し替えを外して 401 か 403）

- [ ] **Step 2: テストが失敗することを確かめる**

  Run: `uv run pytest tests/test_proposals_router.py -v`
  Expected: FAIL（404。ルーターがない）

- [ ] **Step 3: Interfaces のとおりに書き、`main.py` に登録する**

- [ ] **Step 4: バックエンドの全体のチェックを通す**

  Run: `uv run ruff check . --fix && uv run ruff format . && uv run mypy src && uv run bandit -r src && uv run pytest -v`
  Expected: すべて成功（`bandit` は `-s B101` なしで通ること）

- [ ] **Step 5: 設計書を更新して Commit**

  `docs/design/agent-proposals.md` の「状態」を「承認済み（実装: G3 PR1〜PR3）」にし、「データモデル」の表に `project_id`（UUID NULL、外部キーなし。payload から求める。求め方は本計画の「決めたこと」）を足し、「Web 用 API」の `project_id` の段落を、この列で絞る形に直す。

  ```bash
  git add src/humancompiler_api/routers/proposals.py src/humancompiler_api/main.py src/humancompiler_api/models.py src/humancompiler_api/proposal_service.py tests/test_proposals_router.py ../../docs/design/agent-proposals.md
  git commit -m "feat(api): Add web API for the proposal inbox"
  ```

---

## PR

- タイトル: `feat(api): Add agent proposal inbox backend (G3 PR1)`
- 本文: Description、Changes Made（DB / API / 依存）、Testing（Postgres のマイグレーションのテストをローカルの pgserver で通したこと）、**Deployment Notes**: マージの前に `039_add_agent_proposals.sql` を本番 DB に手で適用する。旧コードはこのテーブルを知らないので、適用してからデプロイするまでの間に影響はない。rollback は `039_add_agent_proposals_rollback.sql`（提案の行が消える）
- 末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- 設計書（`docs/design/agent-proposals.md`）と本計画もこの PR に含める
