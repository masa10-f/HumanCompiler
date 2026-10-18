# Agent Gateway 設計（G1: エージェントトークン・監査ログ / G2: Agent Read API）

作成日: 2026-10-17
状態: 承認済み（実装: #360）
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
- 運用: マイグレーションはマージ前に本番 DB へ手動で適用し、問題がなければそのまま PR をマージしてデプロイする。そのため、旧コードが新しいスキーマの上で短時間動く。

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
- GRANT: `authenticated` には、上の 11 列すべてを列単位で `GRANT SELECT` する（`client_ip` と `route` を含む）。理由は次のとおり。
  - RLS で自分の行しか見えない。
  - 表に secret がない（ボディ、クエリの値、トークンの secret は記録しない）。
  - 管理 API の `/{id}/audit-logs` が、同じ列を同じユーザーに返す。
  - `client_ip` は、漏れたトークンが知らない IP から使われていないかを本人が確かめるのに使う。
  - テーブル単位ではなく列単位にして、将来追加する列が自動で見えないようにする。
  - `anon` には何も GRANT しない。

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

`/api/agent/` と `/api/hooks/` で始まるパスの HTTP リクエストに対してだけ動くミドルウェア（`agent_audit.py` の `AgentAuditMiddleware`）で書き込む。

- pure ASGI ミドルウェアにする。`BaseHTTPMiddleware` は使わない。
- 書き込みは `await self.app(...)` が返った後に行う。最後の body を送り終えた後なので、`response.background = BackgroundTask(...)` と同じく、応答を待たせない。
- 応答の後に `request.state` から principal、必要スコープ、ルートのテンプレートを読み、1行 INSERT する。
- INSERT は同期の `Session` で行うため、`run_in_threadpool` で実行し、イベントループを止めない。
- アプリが応答を送る前に例外を出した場合は、status 500 として記録する。同じ `try/finally` で扱える。ただし、外側の `ServerErrorMiddleware` が 500 を返す前に書くことになる。頻度が低いので許容する。
- ルートのテンプレートは `request.scope["route"].path` から取る。どのルートにも一致しなかったリクエストは、生のパス（ID を含みうる）ではなく固定値 `<unmatched>` を記録する。
- 認証に失敗したリクエストの `token_prefix` は、トークン形式の正規表現（後述の prefix 抽出）に一致した場合だけ記録する。一致しなければ NULL。任意の値がそのまま保存されないようにするため。
- 認証の失敗（401）とスコープ不足（403）も記録する。ただし、トークンのヘッダー自体がないリクエストは記録しない。誰にも見えない `user_id = NULL` の行が、無制限に増えないようにするため。
- 429 の扱いは次のとおり。
  - トークン単位の上限の 429 は記録する。検証済みで `user_id` があり、本人に見える。総量は既定の 200/分で抑えられる。
  - 認証失敗の上限の 429 は記録しない。`request.state.skip_agent_audit` を立てて、ミドルウェアが行を書かないようにする。`user_id = NULL` の行が増えるのを防ぐため。
  - 既定の上限（`DefaultRateLimitMiddleware`、200/分）の 429 は記録しない。リクエストが監査のミドルウェアまで届かない。
- ミドルウェアは `DefaultRateLimitMiddleware` の内側に置く。既定の上限にかかったリクエストが、監査の対象にならないようにするため。
- 監査ログの書き込みに失敗しても、応答そのものは失敗させない。`logger.exception` で出力する。
- 保持期間の削除は `purge_expired_audit_logs` で行い、1日1回のジョブ `agent_audit_log_retention` から呼ぶ。

### トークン prefix の抽出

`token_urlsafe` の出力には `_` が含まれうるため、`_` で分割しない。namespace（`hc_agent_` / `hc_hook_`）の直後の固定長 8 文字（`token_urlsafe(6)` の長さ）を `public_id` として切り出す。既存の `token_prefix`（`hc_hook_` + 8 文字 = 16 文字）とも一致する。

### Rate limit

ヘッダーの prefix は認証前の入力で、偽の prefix を毎回変えれば新しい枠が作れてしまう。また prefix は UI に表示する非秘密の値なので、それを知る第三者が本物のトークンの枠を使い切ることもできる。そのため、認証前の入力はキーにしない。次の2段で制御する。

IP 単位の制御は、新しく足さない。`DefaultRateLimitMiddleware`（IP 単位 `200 per minute`、全リクエスト）が先にかかるため、`/api/agent/*` と `/api/hooks/*` 専用の IP 単位の段（当初案の 300/分）は設けない。

1. **トークン単位の上限（認証後）**: `get_agent_principal` の中で、検証済みの `token_id` をキーに `120 per minute` を数える。slowapi が内部で使う `limits` ライブラリの in-memory の moving window を使う。超えたら 429（`Retry-After` 付き）。この 429 は監査ログに記録する。
2. **認証失敗の上限**: slowapi は応答の前に判定するため、失敗だけを数えることはできない。`get_agent_principal` の中で、ハッシュで照合して見つからなかった（401 になる）たびに、`get_client_ip(request)` をキーにカウンタを増やす。1分間に `20` 回を超えた IP は以後 429（`Retry-After` 付き）にする。moving window、in-memory。

`get_agent_principal` の順序:

1. トークンを取り出す。ヘッダーがなければ 401。この 401 は認証失敗に数えない（監査ログに記録しない方針とそろえる。総量は既定の 200/分で抑えられる）。
2. 認証失敗の上限を判定する。ハッシュで照合する前に行う。上限にかかった IP は 429 を返し、この 429 は監査ログに記録しない。
3. ハッシュで照合する。見つからなければ認証失敗を数えて 401。
4. principal を `request.state` に置く。
5. トークン単位の上限を判定する。超えたら 429（監査ログに記録する）。
6. `last_used_at` を更新する。

認証失敗の上限にかかった IP からは、正しいトークンでも 429 になる。ハッシュで照合する前に判定するため。

429 に `Retry-After` を付けるため、`exceptions.http_exception_handler` が `HTTPException.headers` を渡すようにする。それまでは捨てていたので、PR1 の 401 の `WWW-Authenticate` も、本体のアプリでは返っていなかった。

どちらの上限もテスト環境では無効にする（`settings.environment != "test"`）。テストでは `agent_rate_limiter.enabled` を明示的に `True` にし、`reset()` で数をリセットする。

API は Fly.io のマシン1台で動いているので、カウンタは in-memory でよい。デプロイや再起動でリセットされる。複数台にする場合は共有ストレージが必要になる（範囲外）。

クライアント IP について:

- Dockerfile は uvicorn を `--proxy-headers --forwarded-allow-ips "*"` で起動している。すべての転送元を信頼する設定なので、`request.client.host` はクライアントが送る `X-Forwarded-For` で決まり、偽装できる。そのため、認証失敗の上限の IP 制御は、そのままでは回避されてしまう。
- 認証失敗の上限と、監査ログの `client_ip` は、共通の `get_client_ip(request)` で IP を取る。この関数は Fly のエッジプロキシが付ける `Fly-Client-IP` を優先し、ない場合（ローカル開発やテスト）だけ `request.client.host` を使う。
- この関数の追加、既存の limiter（`rate_limiter.py`）と `auth.py` への適用、uvicorn の設定の見直しは issue #358 で行った（マージ済み）。`auth.py` の `_check_rate_limit` は #359 で削除した。
- IP は権限の判定には使わない。

### 既存 hook の移行

- `POST /api/hooks/quick-tasks` は URL、受け付けるヘッダー、レスポンスを変えない。内部の認証を `require_scope(AgentScope.QUICK_TASKS_WRITE)` に置き換える。
- マイグレーションで `hook_tokens` の全行（失効済みも含む）を `agent_tokens` にコピーする。
  - `id`、`user_id`、`name`、`token_hash`、`token_prefix`、`last_used_at`、`revoked_at`、`created_at`、`updated_at` はそのまま移す。
  - `scopes` は `{quick_tasks:write}` とする。
  - `hook_tokens.created_at` と `updated_at` は NULL を許すため、COALESCE で埋める（`agent_tokens` 側は NOT NULL）。
- `hook_tokens` は PR4 まで残し、COMMENT に deprecated と書く。PR1 以降のコードは `hook_tokens` を読み書きしない。
- `HookToken` モデル、`HookTokenService`、`routers/hook_tokens.py`、`/api/user/hook-tokens` は、Web を新しい管理画面に移した PR で削除する（実装順序を参照）。

```sql
INSERT INTO agent_tokens (id, user_id, name, scopes, token_hash, token_prefix,
                          last_used_at, revoked_at, created_at, updated_at)
SELECT h.id, h.user_id, h.name, ARRAY['quick_tasks:write'], h.token_hash,
       h.token_prefix, h.last_used_at, h.revoked_at,
       COALESCE(h.created_at, NOW()), COALESCE(h.updated_at, h.created_at, NOW())
FROM hook_tokens h
ON CONFLICT (id) DO NOTHING;
```

#### 運用との関係

マイグレーションを本番に適用してからデプロイするまでの間は、旧コードが新しいスキーマの上で動く。このため次の2点を守る。

- **035 は旧コードと互換にする**: テーブル・列・トリガー・インデックスの追加だけにする。`logs.updated_at` は DEFAULT 付きなので、この列を知らない旧コードが作業ログを INSERT しても値が入る。
- この間に旧コードでトークンを作成・失効させると、`agent_tokens` には反映されない。マイグレーションの直後にデプロイする運用なので、この間はトークンを操作しない（PR1 の Deployment Notes に書く）。

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
| `cursor` | 前のページの `next_cursor`。中身を解釈しない文字列。前のページと同じ `updated_since` と絞り込み条件で使うこと（条件を変えた場合の結果は保証しない）。デコードできない値、UUID でない `id`、タイムゾーンのない日時を含む cursor は 422 |
| `limit` | 既定 100、最大 200（daily-plans だけは既定 7、最大 31） |

- 並び順は `(updated_at, id)` の昇順に固定する。カーソルは最後の行の `(updated_at, id)` をエンコードしたもので、keyset pagination で次のページを取る。同じ時刻の行があっても、漏れや重複は出ない。
- レスポンスは `{"items": [...], "next_cursor": "…" | null}`。
- **クライアント向けの指針**（使い方ガイドと OpenAPI の description に書く）:
  - 次回の `updated_since` には、取得した中で最大の `updated_at` から 5 分引いた値を使う。`(id, updated_at)` が同じ行は重複として捨てる。トランザクションのコミット遅延による取りこぼしを防ぐため。
  - 削除は差分に現れない。削除を検知したい場合は、`updated_since` を付けずに全件を取り、ID の集合を比べる。

### `updated_at` の信頼性

- **logs に `updated_at` 列を追加する**。作業ログは編集できるため、`created_at` で代用すると編集が差分に現れない。
  - マイグレーションでは、列の追加、既存の行の埋め戻し、DEFAULT と NOT NULL の付与の順に行う。`DEFAULT NOW()` を付けて列を追加すると、全行が NOW() で書き換えられてから上書きすることになるため。`logs.created_at` は NULL を許すので COALESCE を使う。

    ```sql
    ALTER TABLE logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
    UPDATE logs SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
    ALTER TABLE logs ALTER COLUMN updated_at SET DEFAULT NOW(),
                     ALTER COLUMN updated_at SET NOT NULL;
    ```
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

### `035_add_agent_tokens.sql` と `035_add_agent_tokens_rollback.sql`（PR1）

追加だけにして、旧コードと互換にする。`agent_audit_logs` は含めない（036 に分ける）。

1. 前提チェック（依存するテーブルと `update_updated_at_column()` がなければ、分かるメッセージで失敗させる）
2. `agent_tokens` の作成（インデックス、RLS、`REVOKE ALL` の後に必要な列だけ `GRANT SELECT`、COMMENT）
3. `hook_tokens` から `agent_tokens` へのコピー（「既存 hook の移行」を参照）
4. `logs.updated_at` 列の追加と、`created_at` からの埋め戻し
5. logs / quick_tasks / context_notes / daily_plan_documents への `updated_at` トリガーの追加（`DROP TRIGGER IF EXISTS` の後に `CREATE`）
6. `(updated_at, id)` インデックスの追加
7. `hook_tokens` の COMMENT を deprecated に更新

rollback の手順:

1. `agent_tokens` で失効しているトークンの `revoked_at` を、`hook_tokens` に書き戻す。移行後に失効させたトークンが、旧コードで再び有効にならないようにするため。
2. 上の 2〜3 と 5〜7 を元に戻す。インデックスとトリガーを削除し、`agent_tokens` を削除し、`hook_tokens` の COMMENT を元の文言に戻す。
3. `logs.updated_at` は列を残す。消すと、すでに値を読んでいるクライアントとの差が出るうえ、残しても旧コードに害はない。

移行後に新しく作ったトークンは、rollback すると使えなくなる。その場合は旧コードで作り直す。

### `036_add_agent_audit_logs.sql`（PR2）

1. `agent_audit_logs` の作成（「データモデル: `agent_audit_logs`」の定義）
2. インデックス `(user_id, created_at DESC)`、`(token_id, created_at DESC)`
3. RLS を有効にし、`authenticated` には自分の `user_id` の行の SELECT のみ許可する
4. `REVOKE ALL ON public.agent_audit_logs FROM anon, authenticated` を先に実行し、その後で `authenticated` に 11 列すべてを列単位で `GRANT SELECT` する（#360 のレビューで PR2 に振り分けた項目）。`client_ip` と `route` も含める。理由は「データモデル: `agent_audit_logs`」の GRANT のとおり（RLS で自分の行だけ、表に secret がない、管理 API が同じ列を返す、`client_ip` は本人が不審な利用を確かめるのに使う）。`anon` には GRANT しない

036 の rollback は `agent_audit_logs` を削除する。

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
- コピー: 失効済みの行も失効状態のままコピーされる。`created_at` / `updated_at` が NULL の行があっても失敗しない。
- rollback: 移行後に失効させたトークンが、rollback の後も旧コードで 401 になる。
- prefix の抽出: `public_id` に `_` を含むトークンでも、正しい prefix が取り出せる。形式に合わない値は監査ログに記録されない。
- Rate limit: 偽の prefix を毎回変えても認証失敗の上限で 429 になる。トークンのヘッダーがない 401 は認証失敗に数えない。`X-Forwarded-For` を毎回変えても、認証失敗のカウンタはリセットされない。トークン単位の上限は検証済みのトークンにだけ効く。1分間に 20 回を超えて認証に失敗した IP は 429 になり、正しいトークンでも 429 になる。429 には `Retry-After` が付く。
- 監査ログ: 成功、401、403 のいずれでも1行記録される。ボディや secret が含まれない。一致するルートがないリクエストは `<unmatched>` で記録される。90 日を過ぎた行が削除ジョブで消える。ユーザーを削除すると、その人の監査ログも消える。
- daily plans: `AgentDailyPlanResponse` の `id` と `updated_at` が常に入っている。31 件の一覧で、schedule の問い合わせが件数に比例して増えない。
- `last_used_at`: 5 分以内の連続アクセスでは更新されない。
- Read API: ユーザー A のトークンでユーザー B のデータが見えない（一覧と個別取得の両方。リソースごとの所有の判定すべてについて確認する）。`user_id` は自分だが親が他人の context note は返らない。作業ログを編集すると `/logs` の差分に現れる。`updated_since` と `cursor` で、同じ時刻の行が混ざっていても漏れや重複がない。タイムゾーンのない `updated_since` は 422 になる。壊れた cursor は 500 ではなく 422 になる。
- トリガー: logs / quick_tasks / context_notes / daily_plan_documents を直接 UPDATE すると `updated_at` が進む（Postgres を使う CI ジョブで確認する）。

フロントエンド（Jest）:

- 設定画面: 一覧、プリセットを選んだときのスコープ反映、secret の一度だけの表示、失効、監査ログの表示。

## 実装順序（PR の分け方）

1. **PR1: AgentToken の基盤と hook の移行**
   - migration 035（テーブル、コピー、`logs.updated_at`、トリガー、インデックス）、`AgentToken` モデル、`Log` / `LogResponse` への `updated_at` 追加、`AgentTokenService`、`agent_auth.py`（`get_agent_principal` / `require_scope` / prefix の抽出）
   - `/api/hooks/quick-tasks` を新しい認証に切り替える
   - `/api/user/hook-tokens` は `agent_tokens` を読み書きする互換アダプタとして残す。一覧はスコープがちょうど `{quick_tasks:write}` のトークンだけを返す。作成すると `hc_agent_` 形式・`{quick_tasks:write}` のトークンができる。Web は無変更で動く
   - Deployment Notes: マイグレーションを適用してからデプロイするまでの間は、トークンを作成・失効させない
2. **PR2: 監査ログと rate limit**
   - 前提: #358 がマージ済みであること
   - migration 036（`agent_audit_logs` の作成、インデックス、RLS、`REVOKE` と列単位の `GRANT`）
   - ミドルウェア、保持ジョブ
   - トークン管理 API のバックエンド（`/api/user/agent-tokens` の一覧・作成・失効・`/scopes`・`/{id}/audit-logs`）。PR3 の Read API を、スコープ付きのトークンで確かめられるようにするため
3. **PR3: Agent Read API**
   - `/api/agent/v1/*`、差分取得、context export
4. **PR4: Web UI**
   - 設定画面の置き換え、使い方ガイドの更新
   - `HookToken` 関連のコードと `/api/user/hook-tokens` の削除

各 PR は単体でデプロイしてよく、それぞれの時点で既存の hook が動き続けること。
