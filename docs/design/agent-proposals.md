# 提案インボックス設計（G3）

作成日: 2026-11-02
状態: 承認済み（実装: G3 PR1〜PR3）
関連: [Agent Gateway 設計（G1 / G2）](agent-gateway.md)、ResearchDistillator `docs/roadmap.md`（Track G の G3）

## 概要

ローカルのエージェント（Research Distillator、Claude Code、Codex など）が、HumanCompiler に**提案**を送れるようにする。
ユーザーは提案を Web のインボックスで読み、そのまま承認する、編集してから承認する、却下する、のいずれかを選ぶ。
承認すると、Goal / Task / Quick Task の作成やノートへの追記が行われる。
承認の結果と却下の理由は、エージェントが API で取得し、次の提案の改善に使う。

もう一つの役割は、数値実験の提案（`experiment`）の承認窓口になること。
承認は「この内容でエージェントに回してよい」という意味で、承認された実験は、後のフェーズ（ロードマップの「独立した検証と探索」）で、Codex などのエージェントが取りに行って実行する。

### 前提

- 通信は常にエージェントから始める。HumanCompiler からエージェントに依頼を送る経路は作らない（G1 / G2 と同じ）。
- HumanCompiler には複数のユーザーがいて、各ユーザーは自分のデータと自分のエージェントだけを扱う。提案も、その持ち主のユーザーにだけ見え、そのユーザーのデータにだけ作用する。
- マイグレーションはマージ前にユーザーが本番 DB に手で適用する。追加だけにし、旧コードと互換にし、2回実行しても安全にする。
- 規模はユーザー本人と本人のエージェント程度。over-engineering は避ける。

### ユーザーが決めたこと（2026-11-02）

| 項目 | 決定 |
|---|---|
| 新着の知らせ方 | **1日1回のまとめメール**と、**ダッシュボードの Quick Task の下のインボックス表示**。Web Push は作らない |
| まとめメールの形 | 既存の「デイリーダイジェスト」の設定を使い、**1日1通に「新しい提案」と「期限が近いタスク」の2つの欄**を入れる。提案用の設定は別に作らない |
| メールの設定 | 今は本番でメールが動いていない。G3 を機にユーザーが Resend などを設定して動くようにする（「デプロイの前提」を参照） |
| `experiment` の承認の意味 | 「この内容でエージェントに回してよい」。承認するときに、ユーザーが任意で**実行するエージェントへの追加の指示**を書ける |

### 範囲外

- Web Push（`_send_push_notifications` は今もスタブのまま。G3 では触らない）
- 承認された `experiment` の実行、実行するエージェントによる確保（claim）、結果の報告。後のフェーズで設計する。G3 は「承認された実験を一覧で取れる」ところまで
- 提案の期限切れ、自動の削除
- 一括承認・一括却下
- 承認・却下の取り消し（承認で作られた Goal などは、普通の画面で編集・削除できる）
- エージェントによる提案の取り下げ・更新
- MCP（G4）、Distiller 側の送信処理（R3）

---

## 現状（設計の根拠）

- **Reschedule 提案**（`reschedule_suggestions` / `reschedule_decisions`）: pending → accepted / rejected と、判断の記録の形。
- **Triage**（`task_triage_runs` / items）: AI の推奨 → ユーザーが上書き → 適用し、失敗を `apply_error` に残す形。インボックスはこちらに近い。
- **作成のサービス**: `goal_service.create_goal`、`task_service.create_task`、`quick_task_service.create_quick_task`。所有の確認をしたうえで、`BaseService.create` → `safe_execute` の中で **commit する**。
- **ノート**: Project / Goal / Task ごとに1つ（`routers/notes.py` の `get_or_create_note`）。Web は TipTap で編集し、本文を **HTML**（`content_type: 'html'`）で保存する。サーバーに Markdown の変換ライブラリはない。
- **メール**: Resend による送信（`email_service.py`）、全体のフラグ（`settings.email_notifications_enabled`）、ユーザーごとの設定（`user_settings.email_*`）、二重送信を防ぐ記録表（`email_notification_logs`、`notification_type` は TEXT + CHECK）がある。期限通知のジョブは5分ごとに動く。日次 digest の送信関数（`send_daily_digest`）はあるが、ジョブには登録されていない。メールの本文に Web へのリンクはなく、Web の URL の設定もない。
- **アプリの時刻**: ユーザーごとのタイムゾーンはない。`Asia/Tokyo` を固定で使っている（`routers/tasks.py` の `APP_TIMEZONE` など）。
- **Agent API の土台**: `require_scope`、監査ログ、`(updated_at, id)` の keyset pagination（`agent_pagination.py`）。

---

## 提案の種類と payload

提案は共通の項目と、種類ごとの `payload` からなる。payload は種類ごとの Pydantic モデルで、受け付けるとき（POST）に厳密に検証する（`extra="forbid"`、合わなければ 422）。

### 共通の項目（POST の本文）

| 項目 | 型 | 制約 | 内容 |
|---|---|---|---|
| `kind` | string | 下の7種類 | 提案の種類 |
| `title` | string | 1〜200 文字 | 一覧とメールに出す短い題 |
| `rationale` | string | 0〜4000 文字 | なぜ提案するか。重要さ（喜ぶ人、つながる問題）もここに書く |
| `payload` | object | 種類ごと | 下の表 |
| `sources` | array | 0〜20 件 | 出典。各要素は `{ref, quote?, label?}`。`ref` は 1〜500 文字（`artifact://…` の論理 ID か URL）、`quote` は 0〜1000 文字、`label` は 0〜200 文字 |
| `idempotency_key` | string | 1〜200 文字、必須 | エージェントが出典から作る冪等キー（後述） |

本文全体の大きさは 64 KB までとする（超えたら 413 か 422。どちらにするかは実装者の判断）。

### 種類ごとの payload

| `kind` | payload | 承認したときの動作 |
|---|---|---|
| `goal` | `project_id`（必須）、`title`、`description?`、`due_date?` | `goal_service.create_goal` と同じ検証で Goal を作る |
| `task` | `goal_id`（必須）、`title`、`description?`、`estimate_hours`（必須。`TaskCreate` に既定値がないため）、`due_date?`、`work_type?`、`priority?` | Task を作る |
| `quick_task` | `title`、`description?`、`estimate_hours?`（既定 0.5）、`due_date?`、`work_type?`、`priority?` | Quick Task を作る |
| `note_append` | `target`（`{project_id}` / `{goal_id}` / `{task_id}` のちょうど1つ）、`content_markdown`（1〜20000 文字） | 対象のノートの末尾に追記する（後述） |
| `contradiction` | `project_id?`、`claims`（2〜5 件の `{text, source_ref?}`）、`explanation`、`suggested_resolution?` | 何も作らない。「確認した」という記録になる。コメントを任意で付けられる |
| `decision_request` | `project_id?`、`question`、`options`（0〜6 件の `{label, description?}`）、`recommendation?`、`context?` | 何も作らない。ユーザーの答え（選んだ選択肢かつ／または自由記述）を記録する |
| `experiment` | `project_id?`、`question`（何を確かめるか）、`method`（何を計算・導出するか）、`supports_if`（どんな結果なら肯定か）、`refutes_if`（どんな結果なら否定か）、`effort`（手間の見積もり、自由記述）、`estimated_hours?`、`prerequisites?` | 何も作らない。「回してよい」という記録になる。ユーザーは任意で、実行するエージェントへの追加の指示を書ける |

- 文字列の長さの上限は、作る先のモデルに合わせる（Goal / Task / Quick Task の `title` は 200、`description` は 1000）。`contradiction` / `decision_request` / `experiment` の自由記述の項目は、それぞれ 4000 文字まで。
- `due_date` は既存の `*Create` と同じく、タイムゾーン付きの日時か日付を受け付ける（`prepare_due_date` / `require_due_date_timezone` を使う）。
- **参照する ID**（`project_id`、`goal_id`、`task_id`、`target` の中）は、POST のときに、そのユーザーが所有していることを確かめる。所有していない ID と存在しない ID は、どちらも同じ 422（`detail` に項目名）にする。存在するかどうかを漏らさないため。承認のときにもう一度確かめる（間に削除されることがあるため）。

---

## データモデル: `agent_proposals`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | UUID PK | `gen_random_uuid()` |
| `user_id` | UUID NOT NULL | `users.id`、ON DELETE CASCADE |
| `token_id` | UUID NULL | `agent_tokens.id`、ON DELETE SET NULL。送ってきたトークン |
| `agent_name` | VARCHAR(100) NOT NULL | 送ってきた時点のトークン名の写し。トークンが消えても誰の提案かが分かるように |
| `kind` | TEXT NOT NULL | CHECK で7種類に限る |
| `title` | VARCHAR(200) NOT NULL | |
| `rationale` | TEXT NOT NULL DEFAULT '' | |
| `payload` | JSONB NOT NULL | エージェントが送ってきたままの payload。変えない |
| `final_payload` | JSONB NULL | 承認したときの payload（編集した場合は編集後）。承認前と却下では NULL |
| `sources` | JSONB NOT NULL DEFAULT '[]' | |
| `project_id` | UUID NULL | 外部キーなし。受け付けるときに payload から求め、承認で編集されたら求め直す。Web 用 API の `project_id` での絞り込みに使う。求め方: `goal` は `payload.project_id`、`task` は `goal_id` の Goal の `project_id`、`note_append` は `target` の Project / Goal / Task からたどる、`quick_task` は NULL、その他は `payload.project_id`（なければ NULL） |
| `idempotency_key` | VARCHAR(200) NOT NULL | `UNIQUE (user_id, idempotency_key)` |
| `status` | TEXT NOT NULL DEFAULT 'pending' | CHECK で `pending` / `accepted` / `edited` / `rejected` |
| `reject_category` | TEXT NULL | CHECK で `duplicate` / `wrong` / `not_valuable` / `not_now` / `other`。却下のときだけ必須 |
| `decision_note` | TEXT NULL | 4000 文字まで。却下の理由の自由記述、`experiment` の追加の指示、`decision_request` の答え、`contradiction` のコメント |
| `decision_option` | SMALLINT NULL | `decision_request` で選んだ選択肢の番号（0 始まり） |
| `result_type` | TEXT NULL | 作ったものの種類: `goal` / `task` / `quick_task` / `context_note` |
| `result_id` | UUID NULL | 作った Goal / Task / Quick Task の ID、または追記したノートの ID。外部キーは付けない（後で削除されても提案の記録は残す） |
| `decided_at` | TIMESTAMPTZ NULL | |
| `created_at` / `updated_at` | TIMESTAMPTZ NOT NULL | `updated_at` は `update_updated_at_column()` トリガーで進める |

- インデックス: `(user_id, status, created_at DESC)`（インボックスの一覧）、`(user_id, updated_at, id)`（Agent API の差分取得）。
- `kind` / `status` / `reject_category` は PostgreSQL の enum 型ではなく、TEXT + CHECK にする（`email_notification_logs` と同じ）。モデル側は `StrEnum`。
- RLS を有効にし、`authenticated` には自分の行の SELECT だけを許す。Web は API を経由するので、列単位の GRANT は `agent_tokens` と同じ形でよい（実装者が `035` / `037` に合わせて決める）。`anon` には何も GRANT しない。

### 状態の意味

| 状態 | 意味 |
|---|---|
| `pending` | 未処理 |
| `accepted` | 送られてきた payload のまま承認した |
| `edited` | 編集してから承認した（`final_payload` が `payload` と違う） |
| `rejected` | 却下した（`reject_category` は必須、`decision_note` は任意） |

`edited` かどうかは、サーバーが `final_payload` と `payload` を比べて決める（クライアントの申告には頼らない）。`accepted` / `edited` / `rejected` からは、どの状態にも戻らない。

### 却下の理由

| `reject_category` | 画面の表示 | R2 の評価との対応 |
|---|---|---|
| `duplicate` | 重複している | `nitpick`（重複） |
| `wrong` | 内容が誤っている | `wrong` |
| `not_valuable` | 価値が低い・細かすぎる | `nitpick` |
| `not_now` | 今はやらない | — |
| `other` | その他 | — |

---

## 承認と却下の動作

### 承認

1. 提案が自分のもので `pending` であることを確かめる。そうでなければ 404（他人のもの・存在しない）か 409（処理済み）。
2. 編集された payload があれば、それを種類ごとのモデルで検証する（422）。なければ元の payload を使う。`kind` は変えられない。
3. 参照する ID の所有をもう一度確かめる（削除されていれば 409。メッセージで「対象が見つからない。却下してください」と伝える）。
4. 種類ごとの動作（上の表）を行う。
5. `status`、`final_payload`、`decision_note`、`decision_option`、`result_type`、`result_id`、`decided_at` を書く。

**二重に作らないこと**: 二重クリックや2つのタブからの承認で、Goal などが2つできてはいけない。4 と 5 は1つのトランザクションにし、1 で提案の行を `SELECT … FOR UPDATE` で押さえる。既存の作成サービスと、ノートの `get_or_create_note`（`routers/notes.py`）は途中で commit するので、そのまま呼ぶとこの条件を満たせない。サービスの検証（所有の確認、`*Create` による検証）を保ったまま commit を1回にする方法は、実装者が決める（例: サービスに commit しない版を足す、`_create_instance` と `flush` を使う）。SQLite のテストでは `FOR UPDATE` が効かないので、「処理済みなら 409」で二重の作成が起きないことを確かめる。

**種類ごとの追加の規則**:

- `decision_request`: 選択肢の番号（範囲内）か、空でない `decision_note` の少なくとも一方が必要（なければ 422）。
- `experiment`: `decision_note` が追加の指示になる。任意。
- `contradiction`: `decision_note` は任意。

### `note_append` の追記

- 対象のノートを `get_or_create_note` と同じ規則で取得し、なければ作る。
- `content_markdown` を HTML に変換し、ノートの末尾に足す。先頭に `<p><strong>エージェントからの追記（YYYY-MM-DD、{agent_name}）</strong></p>` を付ける（日付は `Asia/Tokyo`）。
- 変換は `markdown-it-py`（CommonMark、**生の HTML は無効**）を使う。生の HTML はエスケープされ、`javascript:` などのリンクは既定の検証で落ちる。依存を1つ足す。
- Web は `content_type` を見ずに、どのノートも HTML として TipTap に読み込む（`ContextNoteEditor` / `ContextNoteViewer`）。そのため、既存のノートの `content_type` に関係なく常に HTML に変換して足し、追記後の `content_type` は `html` にする。
- 変換の結果は、エディタが扱える要素にそろえる（StarterKit の見出しは h1〜h3、Link、TaskList、CodeBlockLowlight）。扱えないものは次の自動保存で黙って消えるので、変換の段階で直す。画像は無効にし（代替テキストとリンクだけを残すなど）、h4〜h6 は h3 にする。細かい対応は実装者が決める。
- `result_type` は `context_note`、`result_id` はノートの ID。
- **既知の制約**: 別のタブで同じノートを開いて編集していると、その画面の自動保存が追記を上書きしうる（ノートの PUT に版の確認がないため）。G3 では直さない。

### 却下

- `pending` でなければ 409。`reject_category` は必須、`decision_note` は任意。`decided_at` を書く。

---

## スコープとトークンのプリセット

| スコープ | 許可する操作 |
|---|---|
| `proposals:write` | `POST /api/agent/v1/proposals` |
| `proposals:read` | 提案の一覧・取得（`/api/agent/v1/proposals`）。**送ってきたトークンに関係なく、そのユーザーのすべての提案**が見える |

- `proposals:read` を、送ったトークンに限らない理由: 承認された `experiment` を、提案した Distiller とは別のエージェント（Codex など）が取りに行くため。
- `proposals:read` は `:read` で終わるので、既存の「読み取り専用エージェント」プリセットに自動で入る（作成済みのトークンのスコープは変わらない）。
- プリセットを1つ足す: **提案するエージェント**（`proposing_agent`）= `:read` で終わるすべてのスコープ + `proposals:write`。Web はプリセットを `/scopes` の応答から作るので、Web の変更はいらない。
- `AGENT_SCOPE_DESCRIPTIONS` に日本語の説明を足す。

---

## Agent API（`/api/agent/v1`）

| メソッド | パス | スコープ | 内容 |
|---|---|---|---|
| POST | `/proposals` | `proposals:write` | 提案を作る |
| GET | `/proposals` | `proposals:read` | 一覧（差分取得） |
| GET | `/proposals/{proposal_id}` | `proposals:read` | 1件 |

### POST `/proposals`

- 作ったら 201 と提案を返す。
- 同じユーザーで同じ `idempotency_key` の提案がすでにあれば、内容に関係なく、新しく作らずに**既存の提案を 200 で返す**（状態が処理済みでも）。エージェントは返ってきた内容で判断する。同時に2つ届いた場合は、一意制約の違反を拾って既存のものを返す。
- **未処理の上限**: そのユーザーの `pending` が 200 件以上あれば 409（`detail` に「インボックスがいっぱい」）。エージェントの暴走でインボックスが埋まらないようにするため。冪等キーが一致する場合は、上限より先に既存のものを返す。
- `token_id` は principal から、`agent_name` は `agent_tokens.name` から入れる（`AgentPrincipal` はトークン名を持たないので引く）。どちらも本文では受け取らない。

**冪等キーの指針**（OpenAPI の description と使い方ガイドに書く）: 同じ根拠からの同じ提案が同じキーになるように、エージェントが出典から作る。例: `distiller:<種類>:<出典の論理 ID とその版のハッシュ>`。却下された提案は、同じキーで送り直しても新しくはできない。

### GET `/proposals`

- G2 の一覧と同じ差分取得（`updated_since`、`cursor`、`limit` は既定 100・最大 200、`(updated_at, id)` の昇順、`{"items", "next_cursor"}`）。
- 絞り込み: `kind`、`status`（それぞれ複数指定できる）。
- 承認・却下で `updated_at` が進むので、エージェントは `updated_since` で判断の結果を拾える。
- 承認された実験の取得は `?kind=experiment&status=accepted&status=edited`。

### 応答の形（`AgentProposalResponse`）

`id`、`kind`、`status`、`title`、`rationale`、`payload`、`final_payload`、`sources`、`idempotency_key`、`agent_name`、`project_id`、`reject_category`、`decision_note`、`decision_option`、`result`（`{type, id}` か `null`）、`created_at`、`decided_at`、`updated_at`。日時は UTC のタイムゾーン付き。`token_id` は返さない。

---

## Web 用 API（Supabase ログインが必要、`/api/proposals`）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `` | 一覧。`status`（`pending` か `decided`）、`kind`、`project_id`、`limit`（既定 50）、`offset`。未処理は新しい順、処理済みは `decided_at` の新しい順 |
| GET | `/summary` | `{pending_count, latest: [最新の未処理 3 件の id / kind / title / agent_name / created_at]}`。ダッシュボードとヘッダー用 |
| GET | `/{proposal_id}` | 1件 |
| POST | `/{proposal_id}/accept` | `{payload?, decision_note?, decision_option?}`。成功したら提案（`result` 入り）を返す |
| POST | `/{proposal_id}/reject` | `{reject_category, decision_note?}` |

- `project_id` で絞るときは、`agent_proposals.project_id` 列（受け付けるときに求めて保存し、承認で編集されたら求め直した値）で絞る。payload を毎回たどることはしない。
- 応答には、表示のために、参照先の名前（プロジェクト名、Goal 名、Task 名）を添える。参照先が消えていれば null。

---

## Web の画面

### インボックス（`/inbox`）

- 上部のタブ: 未処理 / 処理済み。種類とプロジェクトで絞り込める。
- 提案ごとのカード:
  - 種類のバッジ、題、提案元（`agent_name`）、届いた日時、プロジェクト名。
  - `rationale`（長ければ折りたたむ）。
  - 種類ごとの中身の表示（Goal / Task なら作られる項目、`note_append` なら対象と追記する本文、`experiment` なら確かめること・方法・肯定と否定の条件・手間、`decision_request` なら問いと選択肢、`contradiction` なら食い違う主張）。
  - 出典の一覧。`http(s)://` はリンクにし、`artifact://…` はそのまま等幅で出す。`quote` は引用として出す。
- 操作:
  - **承認**: そのまま承認する。`experiment` は「実行するエージェントへの追加の指示（任意）」の欄を出してから承認する。`decision_request` は選択肢を選ぶか答えを書いてから承認する。`contradiction` はコメント（任意）を書ける。
  - **編集して承認**: `goal` / `task` / `quick_task` / `note_append` / `experiment` で、payload の項目をフォームで直してから承認する。`goal` の Project と `task` の Goal は、自分のものから選び直せる。`contradiction` / `decision_request` は編集しない。
  - **却下**: 理由の種類（必須）と自由記述（任意）を選ぶダイアログ。
- 承認に成功したら、作ったもの（Goal / Task / Quick Task / ノート）へのリンクを出す。失敗したら（409 / 422）、カードの中にメッセージを出し、入力は残す。
- エージェントの書いた文字列は、すべてプレーンテキストとして出す（`dangerouslySetInnerHTML` を使わない）。改行は保つ。

### ダッシュボード

- Quick Task の一覧の下に「インボックス」のカードを置く。未処理の件数と、新しい3件（種類のバッジと題）を出し、`/inbox` へのリンクを付ける。0 件なら「未処理の提案はありません」と1行だけ出す。

### ヘッダー

- ナビゲーションに「インボックス」を足し、未処理が1件以上あれば件数のバッジを出す。`/summary` を使う。ページの移動とフォーカスのときに取り直す程度でよい（リアルタイムの更新はしない）。

### 設定画面

- 既存の「デイリーダイジェスト」のオン・オフと送信時間をそのまま使う。新しい項目は足さない。説明の文を「新しい提案と、期限が近いタスクを1日1通にまとめてメールで受け取ります」に変え、メール通知全体（`email_notifications_enabled`）がオフのときは送られないことを書く。
- エージェントトークンのプリセットは `/scopes` から来るので、変更はいらない。使い方ガイド（`agent-token-usage-guide.tsx`）に、提案を送る `curl` の例を1つ足す。

---

## デイリーダイジェスト（1日1通のまとめメール）

既存の「デイリーダイジェスト」の設定（`user_settings.email_daily_digest_enabled` と `email_daily_digest_hour`）を使い、1日1通のメールに「新しい提案」と「期限が近いタスク」の2つの欄を入れる（ユーザーの決定、2026-11-02）。今はこの設定をオンにしても、送る処理がジョブに登録されていないため何も届かない。G3 で動くようにする。DB の列は足さない。

- APScheduler に10分ごとのジョブ `daily_digest_email` を足す。対象は、全体のフラグとメールサービスが有効で、ユーザーの `email_notifications_enabled` と `email_daily_digest_enabled` がどちらも true のユーザー。
- 各ユーザーについて、次をすべて満たすときに1通送る。
  1. 今の `Asia/Tokyo` の時刻（時）が `email_daily_digest_hour` 以上。
  2. 今日（`Asia/Tokyo`）の `daily_digest` の送信済みの記録がない。
  3. 2つの欄の少なくとも一方が空でない。
- 1 の「以上」は、デプロイや再起動でその時刻のジョブを逃しても、その日のうちに送るため。
- **新しい提案の欄**: 前回の `daily_digest` の送信済みの記録の後に届いた `pending` の提案（記録がなければ、すべての `pending`）。最大 20 件を、種類・題・プロジェクト名・提案元で並べる。未処理の総数と、インボックスへのリンクを付ける。
- **期限が近いタスクの欄**: 期限が今日から3日以内（`Asia/Tokyo`）の未完了の Task と Quick Task、および期限を過ぎた未完了の Task と Quick Task。期限の早い順に最大 20 件。
- 件名: 新しい提案があれば「【HumanCompiler】新しい提案 N 件と期限の近いタスク」、なければ既存の「【HumanCompiler】YYYY年MM月DD日 のタスク期限サマリー」。細かい文言は実装者が決める。
- 本文の HTML は `send_daily_digest` / `_render_daily_digest_html` を2つの欄の形に作り変える。エージェントの書いた文字列もタスクの題も、すべて HTML エスケープする（今の `_render_daily_digest_html` はタスクの題をエスケープしていないので、ここで直す）。
- 送ったら `email_notification_logs` に `notification_type = 'daily_digest'`、`status = sent` で記録する（`daily_digest` は 019 の CHECK にすでにある）。失敗したら `failed` で記録し、次のジョブでやり直す。同じ日に失敗が3件たまったら、その日は諦める。
- リンクのために、設定に `web_base_url`（環境変数 `WEB_BASE_URL`）を足す。未設定ならリンクを出さない。

---

## マイグレーション `039_add_agent_proposals.sql`

追加だけにし、旧コードと互換にし、2回実行しても安全にする。

1. 前提のチェック（`users`、`agent_tokens`、`update_updated_at_column()` がなければ、分かるメッセージで失敗させる）。
2. `agent_proposals` の作成（CHECK、一意制約、インデックス、RLS、`REVOKE ALL` の後に必要な GRANT、COMMENT）と、`updated_at` のトリガー（`DROP TRIGGER IF EXISTS` の後に `CREATE`）。

`user_settings` と `email_notification_logs` は変えない。

`039_add_agent_proposals_rollback.sql`: `agent_proposals` を削除する。

---

## セキュリティ

- 提案は持ち主のユーザーにしか見えず、承認はそのユーザーのデータにしか作用しない。他人の提案の ID は、Web 用 API でも Agent API でも 404。
- payload の中の ID は、受け付けるときと承認するときの両方で所有を確かめる。
- エージェントの書いた文字列は信頼しない。Web はプレーンテキストで出し、ノートへの追記は生の HTML を無効にした変換を通し、メールは HTML エスケープする。
- 提案の受け付けは、既存のトークン単位の上限（120/分）と、未処理 200 件の上限で抑える。
- 監査ログは既存のミドルウェアがそのまま記録する（ボディは記録しない）。

## テスト

バックエンド（pytest）:

- 受け付け: 種類ごとの payload の検証（不正な項目、`extra`、長さ、`note_append` の `target` が0個・2個）。他人の・存在しない ID が同じ 422。冪等キーが同じなら 200 で既存のものが返り、行が増えない（処理済みでも同じ）。未処理 200 件で 409、ただし同じキーなら 200。スコープがなければ 403。
- 一覧: 他人の提案が見えない。別のトークンの提案も見える。`kind` / `status` の絞り込み。承認・却下で `updated_at` が進み、`updated_since` で拾える。
- 承認: 種類ごとに実体ができ、`result` が入る。編集すると `edited`、同じ内容なら `accepted`。処理済みへの承認・却下は 409 で、実体が増えない。承認の前に参照先が消えていれば 409 で、何も作られない。`decision_request` の答えがなければ 422。`experiment` の追加の指示が Agent API で取れる。
- `note_append`: 空のノート、HTML のノート、ノートがない場合。生の HTML と `javascript:` のリンクが無害になる。
- 却下: 理由の種類が必須。却下の理由が Agent API で取れる。
- デイリーダイジェスト: 時刻の前は送らない。時刻の後は1日1回だけ送る。2つの欄がどちらも空なら送らない。片方だけでも送る。新しい提案は前回の送信の後に届いたものだけを数える。期限が近いタスクの範囲（3日以内と期限切れ、完了済みは除く）。ユーザーの設定か全体のフラグがオフなら送らない。失敗の記録と、やり直しの上限。提案の文字列とタスクの題のエスケープ。
- マイグレーション: Postgres の CI ジョブで、039 を2回適用できる。

フロントエンド（Jest）:

- インボックス: 種類ごとの表示、承認・編集して承認・却下、失敗時のメッセージと入力の保持、`experiment` の追加の指示、`decision_request` の答え。
- ダッシュボードのカード（0 件と複数件）、ヘッダーのバッジ、設定画面のデイリーダイジェストの説明の文。

## デプロイの前提（メールを動かすため。ユーザーが行う）

- Resend のアカウントと API キー。送信元のドメインを Resend で検証する（検証しない `onboarding@resend.dev` は Resend のアカウントの持ち主にしか送れないので、複数のユーザーには使えない）。
- Fly の secret: `RESEND_API_KEY`、`EMAIL_FROM`（検証したドメインのアドレス）、`EMAIL_NOTIFICATIONS_ENABLED=true`、`WEB_BASE_URL`。本番でジョブが動いていること（`NOTIFICATION_SCHEDULER_ENABLED` が false でないこと。preview では切ってある）。
- 全体のフラグを true にすると、ユーザーごとの設定で期限通知をオンにしているユーザーには、既存の期限・超過のメールも届き始める。
- ユーザー本人が設定画面で、メール通知と「デイリーダイジェスト」をオンにする。

## PR の分け方

1. **PR1: バックエンドの中心**: マイグレーション 039、モデル、スコープとプリセット、Agent API、Web 用 API、承認・却下と実体化、`note_append` の変換（`markdown-it-py` を足す）。
2. **PR2: Web**: インボックスの画面、ダッシュボードのカード、ヘッダーのバッジ、使い方ガイドの例。マイグレーションはない。
3. **PR3: デイリーダイジェスト**: `web_base_url` の設定、ジョブ、2つの欄の本文、設定画面の説明の文。マイグレーションはない。

各 PR は単体でデプロイしてよい。

## 完了条件

1. `curl` で手動で送った `goal` / `task` / `quick_task` / `note_append` の提案が、インボックスで承認すると実体になる（編集してからの承認も含む）。
2. 却下の理由（種類と自由記述）を Agent API で取得できる。
3. 承認した `experiment` を、別のトークン（`proposals:read`）で `?kind=experiment&status=accepted` から、追加の指示と一緒に取得できる。
4. ダッシュボードとヘッダーに未処理の件数が出る。
5. 本番でメールの設定をした後、設定した時刻の後に、新しい提案と期限が近いタスクをまとめたデイリーダイジェストが1日1通届く。

## 後で直すもの

- ResearchDistillator の `docs/roadmap.md` の G3 の節（「Web Push」を「1日1回のまとめメールとダッシュボードの表示」に直す）。
