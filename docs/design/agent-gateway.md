# Agent Gateway 設計（G1: エージェントトークン・監査ログ / G2: Agent Read API）

作成日: 2026-10-17
状態: レビュー待ち
関連: ResearchDistillator `docs/roadmap.md`（Track G）

## 概要

ローカルで動くエージェント（Research Distillator、Claude Code、Codex、自作スクリプトなど）が、
HumanCompiler の情報を安全に取得し、将来的に更新を反映できるようにするための汎用の窓口を作る。

本 spec の範囲は次の2つ。

- **G1**: スコープ付きの `AgentToken`、既存 `HookToken` の統合、監査ログ、トークン管理 UI
- **G2**: エージェントトークンで利用する読み取り専用 API（`/api/agent/v1/`）

### 前提

- 通信は常にエージェント起点。エージェントが HumanCompiler から情報を取得し、更新は HumanCompiler 側の API に送る。HumanCompiler からエージェントへ依頼を送る経路は作らない。
- 権限はサーバー側で制御する。エージェント側のツールで「読むだけ」にしても、トークンがあれば API は直接叩けるため。

### 範囲外（後続 spec）

- G3: 提案インボックス（`proposals:write`）
- G4: HumanCompiler MCP サーバー
- G5: 書き込みスコープの追加（`quick_tasks:write` 以外）
- `hook_tokens` テーブルの削除（本番で移行を確認した後、別マイグレーションで行う）

---

## 現状

- `HookToken`（`models.py:802`、migration `024_add_hook_tokens.sql`）: ユーザー単位、SHA-256 ハッシュ保存、prefix 表示、`last_used_at`、`revoked_at`。
- `HookTokenService`（`services.py:1925-2025`）: 形式は `hc_hook_<public_id>_<secret>`。照合は secret 全体のハッシュのみで行い、prefix は照合に使っていない。
- `POST /api/hooks/quick-tasks`（`routers/hooks.py`）: `Authorization: Bearer` または `X-HumanCompiler-Hook-Token` を受け付け、QuickTask を作成する唯一のエンドポイント。
- `/api/user/hook-tokens`（`routers/hook_tokens.py`）: Supabase ログインでの一覧・作成・失効。Web の設定画面と使い方ガイドが利用している。
- `context_export`（`routers/context_export.py`）は Supabase JWT 必須のため、無人のエージェントからは使いにくい。
- `updated_at` を更新する DB トリガーは projects / goals / tasks / schedules / users / work_sessions / user_settings にのみ存在する。quick_tasks / context_notes / daily_plan_documents はアプリ側での更新に依存している。
- `logs` には `updated_at` 列そのものがない（`001_initial_schema.sql` は `created_at` のみ。`Log`（`models.py:610`）、`LogResponse`（`models.py:1342`）も同じ）。一方で作業ログは `PUT` で編集できる（`routers/logs.py:261`）。
- hook のルーターは `prefix="/api"` でマウントされており（`main.py:323`）、実際のパスは `/api/hooks/quick-tasks`。
- PR の preview 環境は、`DATABASE_URL_PREVIEW` が未設定なら本番 DB を使う（`.github/workflows/deploy-api.yml:99`）。そのため、マイグレーションが本番 DB に先に当たり、旧コードと新しいスキーマが同時に動く期間がありうる。

---

## G1: エージェントトークン

### スコープ

コード上は `AgentScope`（`StrEnum`）で定義し、未知のスコープは作成時に 422 とする。

| スコープ | 許可する操作 |
|---|---|
| `projects:read` | Project の取得 |
| `goals:read` | Goal の取得 |
| `tasks:read` | Task の取得 |
| `quick_tasks:read` | QuickTask の取得 |
| `logs:read` | 作業ログ（Log）の取得 |
| `work_sessions:read` | WorkSession の取得 |
| `notes:read` | ContextNote の取得 |
| `daily_plans:read` | DailyPlanDocument の取得 |
| `context:read` | context export（Markdown）の取得。内部でノート・タスク・作業履歴・日次ノートを読むため、実質的に広い読み取り権限であることを UI で明示する |
| `quick_tasks:write` | `POST /api/hooks/quick-tasks`（既存 hook の互換） |

スコープは**作成後に変更しない**。変更したい場合は新しいトークンを発行し、古いものを失効させる。権限が後から広がる経路をなくすため。

### プリセット（UI のみ。API はスコープの配列を受け取る）

| プリセット | スコープ |
|---|---|
| Quick task hook | `quick_tasks:write` |
| 読み取り専用エージェント | すべての `:read` |
| カスタム | 任意に選択 |

### トークン形式

- 新規: `hc_agent_<public_id>_<secret>`（`public_id` は `token_urlsafe(6)`、`secret` は `token_urlsafe(32)`）
- 表示用 prefix: `hc_agent_<public_id>`
- 移行した既存トークン（`hc_hook_…`）はそのまま有効。照合はハッシュのみで行うため、形式の違いは影響しない。

### データモデル: `agent_tokens`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `user_id` | UUID NOT NULL | `users.id`、ON DELETE CASCADE |
| `name` | VARCHAR(100) NOT NULL | 表示名 |
| `description` | VARCHAR(500) NULL | 用途・利用するデバイスなど |
| `scopes` | TEXT[] NOT NULL | `CHECK (cardinality(scopes) > 0)` |
| `token_hash` | CHAR(64) NOT NULL UNIQUE | SHA-256 |
| `token_prefix` | VARCHAR(32) NOT NULL | 表示用 |
| `last_used_at` | TIMESTAMPTZ NULL | 間引いて更新（後述） |
| `revoked_at` | TIMESTAMPTZ NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ | `updated_at` トリガーあり |

インデックス、RLS、GRANT は `024_add_hook_tokens.sql` と同じ形にする。`authenticated` ロールには自分の行のメタデータのみ SELECT を許可し、`token_hash` は GRANT しない。

### データモデル: `agent_audit_logs`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | UUID PK | |
| `token_id` | UUID NULL | `agent_tokens.id`、ON DELETE SET NULL。認証に失敗した場合は NULL |
| `user_id` | UUID NULL | `users.id`、ON DELETE CASCADE。認証に失敗した場合は NULL。ユーザーを削除したときに、その人の監査ログ（IP やアクセス先）が残らないようにする |
| `token_prefix` | VARCHAR(32) NULL | 認証に失敗した場合も、形式が正しければ記録する |
| `method` | VARCHAR(10) NOT NULL | |
| `route` | VARCHAR(200) NOT NULL | パスのテンプレート（例: `/api/agent/v1/tasks/{task_id}`）。ID の値は含めない |
| `required_scope` | VARCHAR(50) NULL | |
| `status_code` | SMALLINT NOT NULL | |
| `duration_ms` | INTEGER NOT NULL | |
| `client_ip` | VARCHAR(45) NULL | |
| `created_at` | TIMESTAMPTZ NOT NULL | |

- リクエストボディ、クエリの値、トークンの secret は記録しない。
- 保持期間は 90 日。既存の APScheduler（`scheduler/notification_scheduler.py`）に1日1回の削除ジョブを追加する。
- RLS: `authenticated` には自分の `user_id` の行の SELECT のみ許可する。

### 認証の流れ

新しいモジュール `agent_auth.py` に置く。

1. `extract_agent_token(request)`: 次の順にトークンを探す。
   1. `Authorization: Bearer <token>`
   2. `X-HumanCompiler-Agent-Token`
   3. `X-HumanCompiler-Hook-Token`（互換用）

   見つからなければ 401。
2. `get_agent_principal`: ハッシュで有効なトークン（`revoked_at IS NULL`）を引く。見つからなければ 401。結果を `AgentPrincipal(token_id, user_id, scopes, token_prefix)` として `request.state.agent_principal` に置く。
3. `require_scope(scope)`: `get_agent_principal` に依存する FastAPI 依存関数。スコープがなければ 403 を返し、`detail` に必要なスコープ名を入れる。`request.state.required_scope` にも記録する。
4. `last_used_at` は、前回の値から 5 分以上たっている場合だけ更新する。頻繁な読み取りで書き込みが増えないようにするため。利用の詳細は監査ログで追う。

方針:

- エージェント用エンドポイント（`/api/agent/v1/*`、`/api/hooks/*`）は Supabase JWT を受け付けない。
- 既存のユーザー用エンドポイントはエージェントトークンを受け付けない（今の `get_current_user` のまま）。
- 失効はキャッシュせず、リクエストごとに DB を参照する。失効を即時に反映するため。

### 監査ログの書き込み

`/api/agent/` と `/api/hooks/` で始まるパスに対してだけ動くミドルウェアで書き込む。

- 応答の後に `request.state` から principal、必要スコープ、ルートのテンプレートを読み、1行 INSERT する。
- INSERT は同期の `Session` で行うため、`run_in_threadpool` で実行し、イベントループを止めない。
- ルートのテンプレートは `request.scope["route"].path` から取る。どのルートにも一致しなかったリクエストは、生のパス（ID を含みうる）ではなく固定値 `<unmatched>` を記録する。
- 認証に失敗したリクエストの `token_prefix` は、トークン形式の正規表現（後述の prefix 抽出）に一致した場合だけ記録する。一致しなければ NULL。任意の値がそのまま保存されないようにするため。
- 認証の失敗（401）とスコープ不足（403）も記録する。
- 監査ログの書き込みに失敗しても、応答そのものは失敗させない。エラーとしてログ出力する。

### トークン prefix の抽出

`token_urlsafe` の出力には `_` が含まれうるため、`_` で分割しない。namespace（`hc_agent_` / `hc_hook_`）の直後の固定長 8 文字（`token_urlsafe(6)` の長さ）を `public_id` として切り出す。既存の `token_prefix`（`hc_hook_` + 8 文字 = 16 文字）とも一致する。

### Rate limit

ヘッダーの prefix は認証前の入力で、偽の prefix を毎回変えれば新しい枠が作れてしまう。また prefix は UI に表示する非秘密の値なので、それを知る第三者が本物のトークンの枠を使い切ることもできる。そのため、認証前の入力はキーにしない。次の3段で制御する。

1. **IP 単位の上限（認証前）**: `/api/agent/*` と `/api/hooks/*` のすべてのリクエストに、slowapi で IP 単位 `300 per minute` を設定する。
2. **トークン単位の上限（認証後）**: `get_agent_principal` の中で、検証済みの `token_id` をキーに `120 per minute` を数える。slowapi が内部で使う `limits` ライブラリの in-memory の moving window を使う。超えたら 429。
3. **認証失敗の上限**: slowapi は応答の前に判定するため、失敗だけを数えることはできない。`get_agent_principal` の中で、401 を返すたびに IP 単位のカウンタを増やし、1分間に 20 回を超えた IP は以後 429 にする（`auth.py:42` の `_check_rate_limit` と同じ形）。

API は Fly.io のマシン1台で動いているので、カウンタは in-memory でよい。複数台にする場合は共有ストレージが必要になる（範囲外）。

クライアント IP について:

- Dockerfile は uvicorn を `--proxy-headers --forwarded-allow-ips "*"` で起動している。すべての転送元を信頼する設定なので、`request.client.host` はクライアントが送る `X-Forwarded-For` で決まり、偽装できる。このままでは、1 と 3 の IP 単位の制御は回避されてしまう。
- 段階 1 と 3、および監査ログの `client_ip` は、共通の `get_client_ip(request)` で IP を取る。この関数は Fly のエッジプロキシが付ける `Fly-Client-IP` を優先し、ない場合（ローカル開発やテスト）だけ `request.client.host` を使う。
- この関数の追加、既存の limiter（`rate_limiter.py`）と `auth.py` への適用、uvicorn の設定の見直しは issue #358 で行う。PR2 は #358 の後に着手する。#358 が先に入らない場合は、`get_client_ip` だけを PR2 で先に追加し、#358 では既存の箇所への適用を行う。
- IP は権限の判定には使わない。

### 既存 hook の移行

- `POST /api/hooks/quick-tasks` は URL、受け付けるヘッダー、レスポンスを変えない。内部の認証を `require_scope(AgentScope.QUICK_TASKS_WRITE)` に置き換える。
- マイグレーションで `hook_tokens` の全行（失効済みも含む）を `agent_tokens` にコピーする。
  - `id`、`user_id`、`name`、`token_hash`、`token_prefix`、`last_used_at`、`revoked_at`、`created_at`、`updated_at` はそのまま移す。
  - `scopes` は `{quick_tasks:write}` とする。
  - コピーは upsert にする（後述の「hook_tokens からの同期 SQL」）。
- `hook_tokens` は PR4 まで残し、COMMENT に deprecated と書く。

#### 移行期間の整合性（失効の取りこぼしと rollback への対策）

旧コードと新しいスキーマが同時に動く期間（preview が本番 DB を使う場合や、デプロイの切り替え中）に旧コードが `hook_tokens` を更新すると、失効が `agent_tokens` に届かない。また rollback した後は、移行後に失効させたトークンが旧コードで再び有効になってしまう。これを防ぐため、次の2つを行う。

1. **再実行できる同期 SQL**: `hook_tokens` から `agent_tokens` への upsert を、マイグレーションの中と、手動で再実行するスクリプト（`apps/api/scripts/sync_hook_tokens.sql`）の両方に置く。

   ```sql
   INSERT INTO agent_tokens (id, user_id, name, scopes, token_hash, token_prefix,
                             last_used_at, revoked_at, created_at, updated_at)
   SELECT h.id, h.user_id, h.name, ARRAY['quick_tasks:write'], h.token_hash,
          h.token_prefix, h.last_used_at, h.revoked_at, h.created_at, h.updated_at
   FROM hook_tokens h
   WHERE NOT EXISTS (
       SELECT 1 FROM agent_tokens a
       WHERE a.token_hash = h.token_hash AND a.id <> h.id
   )
   ON CONFLICT (id) DO UPDATE SET
       revoked_at   = COALESCE(agent_tokens.revoked_at, EXCLUDED.revoked_at),
       last_used_at = GREATEST(agent_tokens.last_used_at, EXCLUDED.last_used_at);

   -- WHERE NOT EXISTS で除外した行も、失効だけは token_hash で伝える
   UPDATE agent_tokens a
   SET revoked_at = h.revoked_at
   FROM hook_tokens h
   WHERE a.token_hash = h.token_hash
     AND a.revoked_at IS NULL
     AND h.revoked_at IS NOT NULL;
   ```

   除外した行がある場合は、その件数を `RAISE WARNING` で出す（`DO` ブロックで数える）。食い違いを黙って見逃さないため。

   - 失効は「どちらかで失効していれば失効」の向きにだけ伝える。復活させることはない。
   - `token_hash` も UNIQUE なので、`ON CONFLICT (id)` だけでは `token_hash` の衝突を拾えず、マイグレーションが失敗する。そこで、別の `id` で同じハッシュがすでにある行は `WHERE NOT EXISTS` で除外する（実際には起こらないが、マイグレーションを失敗させないため）。
   - **デプロイ手順**: PR1 を本番に出した後、`sync_hook_tokens.sql` を1回実行する。PR の Deployment Notes にも書く。
2. **PR1〜PR3 の間は `hook_tokens` にも書く**: 互換アダプタと新しい認証は、`agent_tokens` を正としつつ、次の変更を `hook_tokens` にも書く。
   - トークンの作成: 同じ `id` と `token_hash` で `hook_tokens` にも INSERT する。`hook_tokens.token_prefix` は VARCHAR(16) なので、先頭16文字を入れる（表示にしか使わない）。
   - 失効: 両方の `revoked_at` を更新する。
   - `last_used_at` は `agent_tokens` だけを更新する（rollback 後に失っても安全な情報のため）。

   これで rollback した後も `hook_tokens` が完全な状態に保たれ、失効させたトークンが復活せず、アダプタで作ったトークンも消えない。二重書き込みは、PR4 で `hook_tokens` のコードを消すときに一緒に削除する。
- `HookToken` モデル、`HookTokenService`、`routers/hook_tokens.py`、`/api/user/hook-tokens` は、Web を新しい管理画面に移した PR で削除する（実装順序を参照）。

### トークン管理 API（Supabase ログインが必要）

`routers/agent_tokens.py`、prefix は `/api/user/agent-tokens`。

| メソッド | パス | 内容 |
|---|---|---|
| GET | `` | 有効なトークンの一覧（secret とハッシュは含めない） |
| POST | `` | 作成。`{name, description?, scopes[]}`。secret は作成時のレスポンスで1回だけ返す |
| DELETE | `/{token_id}` | 失効 |
| GET | `/{token_id}/audit-logs` | 監査ログの直近の行（`limit` は既定 50、最大 200） |
| GET | `/scopes` | 利用できるスコープとその説明（UI の表示用） |

### Web UI

設定画面の hook token セクションを「エージェントトークン」セクションに置き換える。

- 一覧には名前、prefix、スコープのチップ、最終利用日時、作成日時を表示する。
- 作成ダイアログでは、プリセットを選んでから個々のスコープを調整できる。`context:read` には「広い読み取り権限」の注記を付ける。
- secret は作成時に1回だけ表示し、コピーボタンを付ける（既存の挙動と同じ）。
- 失効の操作と、直近の監査ログ（展開して表示）を置く。
- 使い方ガイド（`hook-token-usage-guide.tsx`）は、Quick task hook の例に加えて、Agent API の `curl` 例と `/api/agent/v1/me` での動作確認を載せる。

---

## G2: Agent Read API

### 共通

- prefix は `/api/agent/v1`。各エンドポイントで `require_scope` を使う。
- 返すデータは、常に `principal.user_id` が所有するものに限る。所有の判定はリソースごとに次のとおり。

| リソース | 所有の判定 |
|---|---|
| projects | `projects.owner_id = user_id` |
| goals | `goals.project_id` → `projects.owner_id = user_id` |
| tasks | `tasks.goal_id` → `goals.project_id` → `projects.owner_id = user_id` |
| logs | `logs.task_id` → tasks → goals → `projects.owner_id = user_id` |
| quick_tasks | `quick_tasks.owner_id = user_id` |
| work_sessions | `work_sessions.user_id = user_id` |
| daily_plans | `daily_plan_documents.user_id = user_id` |
| context_notes | `context_notes.user_id = user_id` **かつ** 親（project / goal / task のうち設定されているもの）が上の判定で同じユーザーに属する |

context_notes は `user_id` を直接持つが、Read API の役割はユーザー間のデータを確実に分けることなので、親の所有も確認する。
- レスポンスのスキーマは、既存の `*Response` モデルを使う（`ProjectResponse`、`GoalResponse`、`TaskResponse`、`QuickTaskResponse`、`LogResponse`、`WorkSessionResponse`、`ContextNoteResponse`）。これらは `id` と `updated_at` がどちらも必須で、差分取得の条件を満たす（`LogResponse` には PR1 で `updated_at` を追加する）。
- **daily plan だけは例外**とする。`DailyPlanResponse` は `routers/daily_plans.py:482` で定義されていて、`id` と `updated_at` がどちらも Optional になっている。カーソルとクライアント向けの指針はこの2つが必ずあることを前提にしているため、`AgentDailyPlanResponse(DailyPlanResponse)` を作り、`id: UUID` と `updated_at: datetime` を必須にする（DB の列はどちらも NOT NULL なので、値は常にある）。
- `DailyPlanResponse.schedule` は daily plan ごとに別の問い合わせで取っている。一覧のエンドポイントではページ内の schedule をまとめて1回で読み込み、1件ごとに問い合わせが増えないようにする。

### 差分取得の仕様（一覧系に共通）

| パラメータ | 内容 |
|---|---|
| `updated_since` | ISO 8601 のタイムゾーン付き日時。`updated_at >= updated_since` の行を返す。タイムゾーンがなければ 422 |
| `cursor` | 前のページの `next_cursor`。中身を解釈しない文字列 |
| `limit` | 既定 100、最大 200（daily-plans だけは既定 7、最大 31） |

- 並び順は `(updated_at, id)` の昇順に固定する。カーソルは最後の行の `(updated_at, id)` をエンコードしたもので、keyset pagination で次のページを取る。同じ時刻の行があっても、漏れや重複は出ない。
- レスポンスは `{"items": [...], "next_cursor": "…" | null}`。
- **クライアント向けの指針**（使い方ガイドと OpenAPI の description に書く）:
  - 次回の `updated_since` には、取得した中で最大の `updated_at` から 5 分引いた値を使う。`(id, updated_at)` が同じ行は重複として捨てる。トランザクションのコミット遅延による取りこぼしを防ぐため。
  - 削除は差分に現れない。削除を検知したい場合は、`updated_since` を付けずに全件を取り、ID の集合を比べる。

### `updated_at` の信頼性

- **logs に `updated_at` 列を追加する**。作業ログは編集できるため、`created_at` で代用すると編集が差分に現れない。
  - マイグレーションで `ALTER TABLE logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()` を実行し、既存の行は `created_at` の値で埋める。
  - `Log` モデルと `LogResponse` にも `updated_at` を追加する。レスポンスへのフィールド追加なので、既存のクライアントは壊れない。
- quick_tasks / context_notes / daily_plan_documents と logs に、`update_updated_at_column()` トリガーを追加する（既存の関数を使う）。どの経路で更新されても `updated_at` が進むようにするため。
- 一覧で使うテーブルに `(updated_at, id)` のインデックスを追加する。

### エンドポイント

| メソッド | パス | スコープ | 絞り込み |
|---|---|---|---|
| GET | `/me` | 不要（有効なトークンであればよい） | トークン名、prefix、スコープ、user_id を返す |
| GET | `/projects` | `projects:read` | `status` |
| GET | `/projects/{project_id}` | `projects:read` | |
| GET | `/goals` | `goals:read` | `project_id`、`status` |
| GET | `/goals/{goal_id}` | `goals:read` | |
| GET | `/tasks` | `tasks:read` | `project_id`、`goal_id`、`status` |
| GET | `/tasks/{task_id}` | `tasks:read` | |
| GET | `/quick-tasks` | `quick_tasks:read` | `status` |
| GET | `/logs` | `logs:read` | `task_id` |
| GET | `/work-sessions` | `work_sessions:read` | `task_id` |
| GET | `/context-notes` | `notes:read` | `project_id`、`goal_id`、`task_id` |
| GET | `/daily-plans` | `daily_plans:read` | `date_from`、`date_to` |
| GET | `/context-export/projects/{project_id}` | `context:read` | 既存の `ContextExportOptions` と同じ |
| GET | `/context-export/goals/{goal_id}` | `context:read` | 同上 |

- 個別取得で、所有していない ID または存在しない ID を指定した場合は 404 を返す（存在するかどうかを漏らさない）。
- context export は既存の `build_project_context_export` / `build_goal_context_export` をそのまま呼ぶ。

---

## マイグレーション

`035_add_agent_tokens.sql` と `035_add_agent_tokens_rollback.sql`:

1. `agent_tokens` の作成（インデックス、RLS、GRANT、COMMENT）
2. `agent_audit_logs` の作成（インデックス `(user_id, created_at DESC)`、`(token_id, created_at DESC)`、RLS）
3. `hook_tokens` から `agent_tokens` への同期 SQL（upsert。「移行期間の整合性」を参照）
4. `logs.updated_at` 列の追加と、`created_at` からの埋め戻し
5. logs / quick_tasks / context_notes / daily_plan_documents への `updated_at` トリガーの追加（`DROP TRIGGER IF EXISTS` の後に `CREATE`）
6. `(updated_at, id)` インデックスの追加
7. `hook_tokens` の COMMENT を deprecated に更新

rollback の手順:

1. `agent_tokens` で失効しているトークンの `revoked_at` を、`hook_tokens` に書き戻す（二重書き込みの安全網）。
2. 上の 1〜3 と 5〜6 を元に戻す。
3. `logs.updated_at` は列を残す。消すと、すでに値を読んでいるクライアントとの差が出るうえ、残しても旧コードに害はない。

PR1〜PR3 の間は `hook_tokens` にも書き込んでいるので、rollback した後も既存の hook は正しい失効状態のまま動く。

## セキュリティ

- secret は保存せず、ハッシュのみを保存する。secret はログにも監査ログにも出さない。
- スコープは作成後に変更できない。失効は即時に反映する。
- エージェントトークンとユーザーセッション（Supabase JWT）は、互いのエンドポイントで使えない。
- 監査ログにはボディとクエリの値を残さない。ルートはテンプレートで記録する。
- 他のユーザーのデータには、どのエンドポイントからも到達できないことをテストで保証する。

## テスト

バックエンド（pytest）:

- トークン: 作成すると secret が1回だけ返る。ハッシュで照合できる。失効すると即時に 401 になる。未知のスコープは 422 になる。
- 認証: トークンがない、形式が不正、失効済みの場合は 401。スコープ不足は 403 で、`detail` に必要なスコープが入る。3種類のヘッダーをすべて受け付ける。Supabase JWT では 401 になる。
- 移行: `hook_tokens` の行がコピーされ、移行前に発行した `hc_hook_` トークンで `/api/hooks/quick-tasks` が両方のヘッダーで成功する。同じトークンで `/api/agent/v1/tasks` を呼ぶと 403 になる。
- 同期 SQL: 2回実行しても結果が変わらない。`hook_tokens` 側でだけ失効させた行は、再実行で `agent_tokens` でも失効になる。`agent_tokens` 側で失効済みの行が、再実行で復活しない。別の `id` で同じ `token_hash` を持つ行があっても失敗しない。
- 二重書き込み: アダプタで作成・失効させたトークンが `hook_tokens` にも反映される。rollback の手順の後、失効させたトークンが旧コードで 401 になる。
- prefix の抽出: `public_id` に `_` を含むトークンでも、正しい prefix が取り出せる。形式に合わない値は監査ログに記録されない。
- Rate limit: 偽の prefix を毎回変えても IP 単位の上限で 429 になる。`X-Forwarded-For` を毎回変えても、IP 単位の上限と認証失敗のカウンタはリセットされない。トークン単位の上限は検証済みのトークンにだけ効く。1分間に 20 回を超えて認証に失敗した IP は 429 になる。
- 監査ログ: 成功、401、403 のいずれでも1行記録される。ボディや secret が含まれない。一致するルートがないリクエストは `<unmatched>` で記録される。90 日を過ぎた行が削除ジョブで消える。ユーザーを削除すると、その人の監査ログも消える。
- 同期 SQL（追加）: 別の `id` で同じ `token_hash` を持つ行が `hook_tokens` 側で失効していれば、`agent_tokens` 側も失効になり、警告が出る。
- daily plans: `AgentDailyPlanResponse` の `id` と `updated_at` が常に入っている。31 件の一覧で、schedule の問い合わせが件数に比例して増えない。
- `last_used_at`: 5 分以内の連続アクセスでは更新されない。
- Read API: ユーザー A のトークンでユーザー B のデータが見えない（一覧と個別取得の両方。リソースごとの所有の判定すべてについて確認する）。`user_id` は自分だが親が他人の context note は返らない。作業ログを編集すると `/logs` の差分に現れる。`updated_since` と `cursor` で、同じ時刻の行が混ざっていても漏れや重複がない。タイムゾーンのない `updated_since` は 422 になる。
- トリガー: logs / quick_tasks / context_notes / daily_plan_documents を直接 UPDATE すると `updated_at` が進む（Postgres を使う CI ジョブで確認する）。

フロントエンド（Jest）:

- 設定画面: 一覧、プリセットを選んだときのスコープ反映、secret の一度だけの表示、失効、監査ログの表示。

## 実装順序（PR の分け方）

1. **PR1: AgentToken の基盤と hook の移行**
   - migration 035（テーブル、同期 SQL、`logs.updated_at`、トリガー、インデックス）と `scripts/sync_hook_tokens.sql`、`AgentToken` モデル、`Log` / `LogResponse` への `updated_at` 追加、`AgentTokenService`、`agent_auth.py`（`get_agent_principal` / `require_scope` / prefix の抽出）
   - `/api/hooks/quick-tasks` を新しい認証に切り替える
   - `/api/user/hook-tokens` は `agent_tokens` を読み書きする互換アダプタとして残す。一覧はスコープがちょうど `{quick_tasks:write}` のトークンだけを返す。作成すると `hc_agent_` 形式・`{quick_tasks:write}` のトークンができる。Web は無変更で動く
   - 作成と失効を `hook_tokens` にも書く（二重書き込み）
   - Deployment Notes: 本番に出した後、`sync_hook_tokens.sql` を1回実行する
2. **PR2: 監査ログと rate limit**
   - ミドルウェア、保持ジョブ、`/api/user/agent-tokens/{id}/audit-logs`
3. **PR3: Agent Read API**
   - `/api/agent/v1/*`、差分取得、context export
4. **PR4: 管理 API と Web UI**
   - `/api/user/agent-tokens` の管理 API、設定画面の置き換え、使い方ガイドの更新
   - `HookToken` 関連のコード、`/api/user/hook-tokens`、`hook_tokens` への二重書き込みの削除

各 PR は単体でデプロイしてよく、それぞれの時点で既存の hook が動き続けること。
