# Project OS 構想（成果物の相互参照 / ローカルエージェントへのタスク委譲）

作成日: 2026-10-25
状態: 提案（2026-10-25 の回答を反映。未承認）
関連: `docs/design/agent-gateway.md`（G1/G2 実装済み、G3〜G5 は後続）、`docs/design/context-notes-feature.md`、ResearchDistillator `docs/roadmap.md`（Track G）

## 概要

HumanCompiler は「計画（project / goal / task）」「知識（context note）」「実行（work session / log / daily plan）」を持っているが、
プロジェクトの**成果物**（PDF ノート、スライド、論文、コード。GitHub や Google Drive にある）とのつながりが弱い。
今は context note にリンクを貼るしかなく、次のことができない。

- あるタスクが**どの成果物を作った・更新したか**を引くこと
- ある成果物（例: 発表スライド）から、**どのタスク・ノート・作業セッションが関わったか**を引くこと
- 「このプロジェクトの最新のスライドはどれか」に答えること
- 成果物の中身をAIへの文脈（context export）に含めること

また、タスクをローカルの Claude Code や Codex に渡すには、今は context export をコピーして手で貼るしかない。

本提案では、HumanCompiler を次の 5 つを束ねる「Project OS」に広げる。

| 層 | 既存 | 追加 |
|---|---|---|
| 計画 | project / goal / task / 依存関係 / triage | タスクの短い ID（`QEC-42`）、完了条件 |
| 知識 | context note | ノート内の成果物メンション、被参照（backlink） |
| 成果物 | （なし。ノート内の URL のみ） | `artifacts`、`artifact_links`、版の履歴 |
| 実行 | work session / log / daily plan | エージェントからの作業ログと成果物の報告（`agent_runs` は将来の検討） |
| 窓口 | Agent Gateway（読み取り） | 書き込みスコープ、提案インボックス、`hc` CLI と MCP サーバー |

### 方針

- **HumanCompiler はファイルの置き場所にならない。** ファイルは GitHub / Drive に置いたまま、HumanCompiler は「索引とつながり」（メタデータ、リンク、版、必要なら抽出したテキスト）だけを持つ。
- **Agent Gateway の前提を守る。** 通信は常にエージェント起点にする。タスクの委譲は、人が Web や `hc` CLI で指示書を取り出し、ローカルのエージェントに明示的に渡す形にする。HumanCompiler がローカルのエージェントを起動する経路（キューと runner、B2）は「将来の検討」とし、本提案では作らない。
- **重いもの（OAuth、Webhook、テキスト抽出）は後に回す。** URL を貼るだけの登録と、ローカルのエージェントからの報告で、まず価値が出るようにする。ローカルの Claude Code / Codex は git と `gh` をすでに使えるので、GitHub の情報はサーバーより手元のエージェントのほうが楽に集められる。
- **エージェントは提案し、人が決める。** タスクの完了や新しいタスクの追加は、エージェントが直接行わず、提案インボックス（G3）を通す。作業ログと成果物の登録のように、取り消しやすく影響の小さいものだけを直接書き込ませる。

---

## 現状

- `ContextNote`（`models.py:2546`）は project / goal / task に1つずつ付く HTML（TipTap）。リンクは `@tiptap/extension-link` の普通の `<a>` で、何を指しているかをシステムは知らない。
- `NoteAttachment`（`models.py:2574`）は定義だけで、`note_attachments` テーブルは未実装（`models.py:2571` のコメント）。
- `Task` には `description`（1000 字）、`memo`（2000 字）があるが、完了条件やエージェント向けの指示を置く場所はない。ID は UUID のみで、コミットメッセージやブランチ名に書ける短い ID がない。
- context export（`ai/context_export.py`）は、ノート、タスク、作業履歴、日次ノートを Markdown にまとめる。エージェントへの指示書の土台に使える。
- Agent Gateway: `AgentToken`（スコープ付き）、監査ログ、rate limit、`/api/agent/v1` の読み取り API（G2。projects / goals / tasks / quick tasks / logs / work sessions / context notes / daily plans と context export。#368、#388 で実装済み）。書き込みは `quick_tasks:write`（`POST /api/hooks/quick-tasks`）のみ。G3（提案インボックス）、G4（MCP サーバー）、G5（書き込みスコープ）は後続 spec として範囲外になっている。
- 外部サービス（GitHub / Google）との連携はない。秘密値の暗号化には `crypto.py` がある。定期処理は APScheduler（`scheduler/notification_scheduler.py`）。API は Fly.io のマシン1台。

---

## 柱 A: 成果物の相互参照

### 成果物とは

| `kind` | 例 | よくある置き場所 |
|---|---|---|
| `note_pdf` | 講義ノート、研究ノートの PDF | Drive、GitHub（LaTeX / Typst のビルド結果、Release の asset） |
| `slides` | 発表スライド | Google Slides、Drive 上の PDF / PPTX、GitHub |
| `document` | 論文原稿、報告書 | Google Docs、GitHub（LaTeX） |
| `code` | リポジトリ、PR、ブランチ | GitHub |
| `dataset` / `other` | データ、図 | Drive、GitHub、任意の URL |

**最初に想定する使い方**（2026-10-25 の回答）: ノートや論文の大本は GitHub 上の LaTeX（`.tex`）で、PDF はそのビルド結果。シミュレーション結果や図も GitHub にある。手書きの PDF は Google Drive に置く。Google Docs は使わない。

- LaTeX の成果物は、`.tex`（または `main.tex` のあるディレクトリ）を成果物として登録する。開くための `url` には、ビルドした PDF の置き場所（GitHub Actions で Release や GitHub Pages に置いたもの）を使える。AI への文脈には `.tex` の本文を使い、PDF から文字は取り出さない。
- 手書きの PDF は、リンクとページのアンカーだけを持つ。文字の情報がないので、テキストの抽出はしない。
- Google Docs / Slides の判別は他の利用者のために残すが、先には作らない。

### URL からの判別

登録は URL を貼るだけで始められるようにする。サーバー側で URL を解析し、`provider` と `external_ref` を決める。
同じ成果物を二重に登録しないよう、正規化したキー（`canonical_key`）で一意にする。

| URL の形 | provider | external_ref | canonical_key | アンカー |
|---|---|---|---|---|
| `github.com/{o}/{r}` | github | `{owner, repo}` | `gh:{o}/{r}` | |
| `github.com/{o}/{r}/blob/{ref}/{path}#L10-L20` | github | `{owner, repo, ref, path}` | `gh:{o}/{r}:{path}` | `lines` |
| `github.com/{o}/{r}/pull/{n}` | github | `{owner, repo, pr_number}` | `gh:{o}/{r}#pr{n}` | |
| `github.com/{o}/{r}/releases/tag/{t}` | github | `{owner, repo, tag}` | `gh:{o}/{r}@{t}` | |
| `docs.google.com/presentation/d/{id}/edit#slide=id.{s}` | google_drive | `{file_id, mime: slides}` | `gd:{id}` | `slide_id` |
| `docs.google.com/document/d/{id}` | google_drive | `{file_id, mime: docs}` | `gd:{id}` | `heading` |
| `drive.google.com/file/d/{id}/view` | google_drive | `{file_id}` | `gd:{id}` | `page`（PDF） |
| その他 | url | `{}` | 正規化した URL | `page`（`#page=3`） |

ファイルの path は ref（ブランチ・コミット）が変わっても同じ成果物とみなし、ref は版として扱う。
アンカー（ページ、スライド、行）は成果物そのものではなく、**リンク側**に持たせる（「タスク A はスライドの 12 枚目を作った」）。

### データモデル

#### `artifacts`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL | `users.id`、ON DELETE CASCADE |
| `project_id` | UUID NOT NULL | `projects.id`、ON DELETE CASCADE。成果物は必ずどこかのプロジェクトに属する |
| `goal_id` | UUID NULL | 主に対応する goal（任意）。ON DELETE SET NULL |
| `title` | VARCHAR(200) NOT NULL | 既定は取得したファイル名 |
| `kind` | ENUM | 上の表 |
| `provider` | ENUM | `github` / `google_drive` / `url` |
| `url` | TEXT NOT NULL | 開くための URL |
| `canonical_key` | VARCHAR(500) NOT NULL | `UNIQUE (user_id, canonical_key)` |
| `external_ref` | JSONB NOT NULL | provider ごとの識別子 |
| `lifecycle` | ENUM | `draft` / `in_review` / `final` / `archived` |
| `current_version` | JSONB NULL | `{ref, sha}` / `{revision_id, modified_time}` など |
| `excerpt` | TEXT NULL | 抽出したテキスト（柱 A のフェーズ 3。上限あり） |
| `last_synced_at` / `sync_error` | | 外部と同期した場合のみ |
| `created_at` / `updated_at` | TIMESTAMPTZ | `updated_at` トリガーあり |

#### `artifact_links`

既存の `context_notes` と同じく、相手ごとに nullable な FK 列を持ち、ちょうど1つが入る CHECK を付ける。
多態の `(target_type, target_id)` にしないのは、ON DELETE CASCADE で参照の整合性を DB に任せられるため。

| カラム | 型 | 備考 |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL | |
| `artifact_id` | UUID NOT NULL | ON DELETE CASCADE |
| `project_id` / `goal_id` / `task_id` / `context_note_id` / `work_session_id` | UUID NULL | ちょうど1つが入る。`agent_run_id` は B2 を作るときに足す |
| `relation` | ENUM | `produces`（作る）、`updates`（版を進めた）、`references`（参照する）、`reviews`（確認する） |
| `anchor` | JSONB NULL | `{page}`、`{slide_id}`、`{path, lines}`、`{heading}` |
| `anchor_key` | TEXT NOT NULL | `anchor` を正規化した文字列。アンカーがなければ空文字。一意性の判定に使う |
| `version_ref` | VARCHAR(200) NULL | `updates` のときの版（コミット SHA、Drive の revision） |
| `source` | ENUM | `manual`、`note_mention`、`commit_trailer`、`agent_report`、`drive_property` |
| `created_at` | TIMESTAMPTZ | |

同じリンクの重複は、相手の列ごとの部分 unique index（例: `UNIQUE (artifact_id, task_id, relation, anchor_key) WHERE task_id IS NOT NULL`）で防ぐ。
NULL になりうる相手の列を1つの UNIQUE にまとめると、Postgres は NULL 同士を別の値とみなすため、重複を防げない。

#### `artifact_versions`（フェーズ 3）

成果物の版の履歴。GitHub のコミット / Release、Drive の revision を同期して入れる。
`artifact_links.version_ref` と突き合わせると「この版はどのタスク・作業セッションで作られたか」が引ける。

### 相互参照の仕組み

**HumanCompiler → 成果物**（HumanCompiler の画面から成果物へ）

- task / goal / project の画面に「成果物」欄を置く。`produces` と `references` を分けて表示する。
- context note の TipTap に、成果物のメンション（ノード）を追加する。URL を貼ると成果物として登録するか聞き、チップ（アイコン、タイトル、アンカー）に置き換える。HTML には `data-artifact-id` と `data-anchor` を持たせる。
- ノートを保存するとき、サーバーが `data-artifact-id` を拾い、`source = note_mention` のリンクを同期する（消えたメンションのリンクは消す）。
- context export に「成果物」節を足す（タイトル、URL、lifecycle、最新の版、リンクのアンカー、抽出テキストがあればその抜粋）。

**成果物 → HumanCompiler**（成果物の側から HumanCompiler へ）

- **タスクの短い ID**: プロジェクトに `key`（例: `QEC`）を、タスクにプロジェクト内の連番を持たせ、`QEC-42` のように書けるようにする。コミットメッセージ、ブランチ名、ファイル名、PDF の脚注、スライドのノート欄に書ける長さにするため。UUID の先頭 8 文字で代用する案もあるが、人が覚えて書く用途には向かない。
  key はユーザーごとに一意にする（`UNIQUE (user_id, key)`）。連番はプロジェクトごとに 1 から振り、欠番は再利用しない。key の付け方（自動の候補か手入力か）と、key を変えたときに過去のコミットやノートに書いた ID をどう扱うかは、B0 の計画で決める。
- **GitHub**: コミットのトレーラー `HumanCompiler-Task: QEC-42`、PR の本文の `QEC-42` を拾い、`source = commit_trailer` で `updates` のリンクを作る。拾うのはフェーズ 1 ではローカルのエージェント（`hc` CLI）、フェーズ 3 では GitHub App の Webhook。
- **リポジトリのマニフェスト**: リポジトリのルートに `.humancompiler.yml` を置き、プロジェクトと成果物の対応を宣言できるようにする。

  ```yaml
  project: QEC          # プロジェクトの key
  artifacts:
    - path: notes/lecture.pdf
      kind: note_pdf
      goal: QEC-G3       # 任意
    - path: slides/midterm.pdf
      kind: slides
  ```

  `hc sync` やエージェントがこれを読み、成果物の登録と更新を行う。サーバーが GitHub を走査しなくてよくなる。
- **Google Drive**: Drive API の `appProperties`（アプリ専用のカスタムプロパティ）に `hc_artifact_id` を書く。Drive 側でファイルを移動・改名しても対応が切れない。フェーズ 3。
- 成果物の詳細画面（`/projects/[id]/artifacts/[artifactId]`）に被参照の一覧（タスク、ノート、作業セッション、エージェント実行）と版の履歴を出す。

### 外部サービスとの連携（フェーズ 3）

| | GitHub | Google Drive |
|---|---|---|
| 認証 | GitHub App（リポジトリ単位のインストール、Webhook 付き）。利用者が複数いるので、各自の PAT を預かる形にはしない | OAuth。スコープは `drive.file` と Google Picker（ユーザーが選んだファイルだけに届く）。`drive.readonly` は制限付きスコープで Google のセキュリティ審査が要るので使わない |
| 変化の検知 | Webhook（push、pull_request、release） | `changes.list` のポーリング（APScheduler、数分おき）。push 通知は Fly.io 1 台の構成では管理が重いので後回し |
| 版 | コミット SHA、tag | `revisionId`、`modifiedTime`、`md5Checksum` |
| テキスト抽出 | LaTeX / Markdown はそのまま。ビルドした PDF からは取り出さない | 手書きの PDF は抽出しない（リンクとページのみ）。Slides / Docs は export（`text/plain`） |
| 秘密値 | App の秘密鍵は環境変数、installation token は都度発行 | refresh token を `crypto.py` で暗号化して保存 |

順序: GitHub を先に作り、Drive は後にする。
`drive.file` では、Picker で選んだファイルにしか届かない。フォルダを選んでも、後からそのフォルダに増えたファイルは見えない見込みなので、Drive に着手するときに実際の挙動を確かめる。フォルダ全体を見るための `drive.readonly` は制限付きスコープで、複数の利用者に公開するなら毎年のセキュリティ審査が要る。

抽出したテキストは上限（例: 成果物ごとに 20,000 字、ページ・スライド単位で区切る）を設け、context export と検索に使う。
外部の文章をプロンプトに入れることになるので、エージェント向けの指示書では「参考資料」として区切り、指示として扱わないよう明記する。

---

## 柱 B: ローカルの Claude Code / Codex へのタスク委譲

### 全体像

```
 Web（タスク画面）                   HumanCompiler API                ローカルのマシン
 「指示書をコピー」 ──── 人が貼る ─────────────────────────────▶  claude / codex
                                  /tasks/{id}/brief  ◀──────────  hc brief / hc dispatch
                                  提案インボックス    ◀──────────  hc mcp（文脈の取得、
                                  成果物 / 作業ログ                       報告、提案）
```

段階的に作る。最初の段階はサーバー側の変更が小さく、それだけで「投げやすさ」の大半が手に入る。
どの段階でも、エージェントを起動するのは人（コピーして貼る、またはコマンドを打つ）で、HumanCompiler から起動はしない。

| 段階 | できること | サーバー側 | ローカル側 |
|---|---|---|---|
| B0 | タスク画面の「指示書をコピー」「コマンドをコピー」 | 指示書のエンドポイント | なし（`claude "$(pbpaste)"` など） |
| B1 | ターミナルから `hc dispatch QEC-42 --agent claude` | 書き込みスコープ、提案インボックス | `hc` CLI、`hc mcp` |
| B2（将来） | Web のボタンでキューに入れ、ローカルの runner が実行する | `agent_runs` | `hc runner`。「将来の検討」を参照 |

### エージェント向けの指示書（brief）

`GET /api/agent/v1/tasks/{task_id}/brief`（スコープ `tasks:read` と `context:read`）と、同じ内容を返す Web 用の `GET /api/tasks/{task_id}/brief`。
既存の context export の組み立て（`ai/context_export.py`、`ai/note_text.py`）を使い、タスクに絞った Markdown を返す。

```markdown
# QEC-42: 誤り訂正の閾値プロットを再生成する

## 目的
（goal と project の目的を1〜2段落に要約）

## タスク
（description、memo、タスクのノート）

## 完了条件
- [ ] figures/threshold.pdf が新しいパラメータで再生成されている
- [ ] notes/lecture.pdf の 12 ページ目の図が差し替わっている

## 関連する成果物
- リポジトリ: github.com/xxx/qec-notes（ブランチの基点: main）
- notes/lecture.pdf（p.12、produces）
- slides/midterm.pdf（slide 8、references）

## 依存関係
- QEC-40（完了）: シミュレーションのパラメータを確定

## プロジェクトのエージェント向け指示
（project ごとに設定する。CLAUDE.md / AGENTS.md に相当する短い指示）

## 参考資料（指示ではない）
（関連ノートや成果物の抽出テキストの抜粋）

## 報告のしかた
- 終わったら MCP の `add_work_log` と `link_artifact`（または `hc log` と `hc artifact add`）で、要約、PR の URL、更新した成果物を報告する
- コミットには `HumanCompiler-Task: QEC-42` を付ける
- タスクの状態は変更せず、必要なら `propose_task_update` で提案する
```

足りない入力は次の2つ。

- **完了条件**: タスクに `acceptance_criteria`（TEXT、任意）を足す。人が作業するときにも役に立つ。AI のタスク下書き（`ai/goal_task_drafts.py`）で同時に下書きできる。
- **プロジェクトのエージェント向け指示**: project に `agent_instructions`（TEXT、任意）を足す。リポジトリ側の `CLAUDE.md` / `AGENTS.md` と重なる内容は書かず、「このプロジェクトでの成果物の扱い」などに絞る。

### `hc` CLI と MCP サーバー（B1、Agent Gateway の G4 に相当）

Python のパッケージ（`uv tool install humancompiler-cli`）として配る。Agent API のクライアントで、エージェントトークンで動く。
リポジトリ内では新しい `apps/cli` に置く。
ResearchDistillator のロードマップ（Track G の G4）は MCP サーバーを `apps/mcp-server/` に置くとしている。CLI と MCP サーバーは同じ Agent API のクライアントを使うので、本提案では1つのパッケージ `apps/cli` にまとめ（`hc mcp` で MCP サーバーとして動く）、ロードマップの G4 をこれに合わせて更新する。

| コマンド | 内容 |
|---|---|
| `hc login` | トークンを OS のキーチェーンに保存する |
| `hc tasks --ready` | 着手できるタスク（依存が解決済み、`pending` / `in_progress`）を一覧する |
| `hc brief QEC-42` | 指示書を標準出力に出す |
| `hc dispatch QEC-42 --agent claude\|codex [--worktree]` | 指示書を作り、対応するリポジトリでエージェントを起動する |
| `hc artifact add <url> --task QEC-42` | 成果物を登録・リンクする |
| `hc sync` | `.humancompiler.yml` を読み、成果物を同期する |
| `hc log QEC-42 "..."` | 作業ログを足す |
| `hc mcp` | stdio の MCP サーバーとして動く |

**リポジトリの対応はローカルに置く。** サーバーは「プロジェクトに GitHub のリポジトリ（`code` の成果物）が付いている」ことだけを知り、
そのクローンがどのマシンのどこにあるかは `~/.config/humancompiler/workspaces.toml` で解決する。マシンごとに違う情報をサーバーに持たせないため。

```toml
[repos]
"github.com/xxx/qec-notes" = "~/src/qec-notes"

[agents.claude]
command = ["claude", "-p", "--output-format", "stream-json", "--permission-mode", "acceptEdits"]

[agents.codex]
command = ["codex", "exec", "--json", "--sandbox", "workspace-write"]
```

**MCP サーバー**（`hc mcp`）は Claude Code（`.mcp.json` / `claude mcp add`）と Codex（`~/.codex/config.toml` の `mcp_servers`）の両方に登録できる。
エージェントが作業の途中で文脈を取りに来て、結果を報告できるようにする。

| ツール | スコープ | 内容 |
|---|---|---|
| `get_task` / `get_brief` | `tasks:read`、`context:read` | タスクと指示書 |
| `search_artifacts` / `get_artifact` | `artifacts:read` | 成果物とその抽出テキスト |
| `add_artifact` / `link_artifact` | `artifacts:write` | 成果物の登録とリンク |
| `add_work_log` | `logs:write` | 作業ログ |
| `propose_task_update` | `proposals:write` | 状態の変更、サブタスクの追加、ノートへの追記を提案する |

あわせて、Claude Code の hook（`Stop` など）や Codex の `notify` から `hc log` を呼ぶ設定例を、`hc init` で出力できるようにする。
人が対話で Claude Code を使った場合も、作業の記録が HumanCompiler に残る。

## Agent Gateway への追加

### スコープ

| スコープ | 許可する操作 | 段階 |
|---|---|---|
| `artifacts:read` | 成果物、リンク、版、抽出テキストの取得 | A1 |
| `artifacts:write` | 成果物の登録・更新、リンクの追加（削除はしない） | B1 |
| `logs:write` | 作業ログの追加 | B1 |
| `proposals:write` | 提案インボックスへの投稿（G3） | B1 |

ロードマップ（G5）の方針どおり、書き込みスコープは削除の操作を持たず、1つずつ足して監査ログで実際の使われ方を確かめる。
リンクの削除は Web（人）だけが行う。ノートのメンションの同期でリンクが消えるのも、人がノートを保存したときだけ。

プリセットに「ローカルエージェント（MCP）」（読み取り全部 + `artifacts:write` + `logs:write` + `proposals:write`）を追加する。
トークン管理の Web UI（#360 の PR4）は、プリセットを固定の一覧にせず `GET /api/user/agent-tokens/scopes` から組み立て、スコープが増えても UI を直さずに済むようにする。

### 提案インボックス（G3）

ResearchDistillator のロードマップ（Track G の G3）を土台にし、本提案で必要な種類を足す。最初の利用者は Research Distillator なので、ロードマップの項目は落とさない。

- `agent_proposals`: 種類、payload（JSON）、出典の参照、冪等キー（`UNIQUE (token_id, idempotency_key)`）、提案元のトークン、状態（`pending` / `accepted` / `edited` / `rejected`）、却下の理由。
- `POST /api/agent/v1/proposals`（`proposals:write`）と、エージェントが承認の結果を取りに来る `GET /api/agent/v1/proposals/{id}`。
- Web のインボックス: 編集してから承認でき、承認すると既存のサービスを通して実体化する。新着は Web Push で知らせる。ダッシュボードに未処理の件数を出し、まとめて承認・却下できるようにする。

| `type` | payload | 承認すると | 出どころ |
|---|---|---|---|
| `goal_create` / `task_create` / `quick_task_create` | `{project_id \| goal_id, title, ...}` | goal / task / quick task を作る | ロードマップ、本提案 |
| `task_status` | `{task_id, status, reason}` | タスクの状態を変える | 本提案 |
| `note_append` | `{target, markdown}` | ノートの末尾に追記する | ロードマップ、本提案 |
| `artifact_lifecycle` | `{artifact_id, lifecycle}` | 成果物の状態を変える | 本提案 |
| `contradiction` / `decision_request` | `{summary, refs, options?}` | 人が読んで判断する（実体化はしない） | ロードマップ |

---

## Web UI

- **プロジェクトの「成果物」タブ**: kind ごとの一覧（lifecycle、最新の版、更新日時、関連する goal）。「最新のスライドを開く」のような近道。
- **タスクの画面**: 成果物の欄（作る / 参照する）、完了条件、「エージェントに渡す」メニュー（指示書をコピー / `hc dispatch` のコマンドをコピー）。
- **ノートのエディタ**: 成果物のメンション（`@` で検索、URL を貼ると登録を提案）、ページやスライドのアンカー。
- **成果物の詳細**: 被参照（タスク、ノート、作業セッション、エージェントの実行）、版の履歴。
- **ダッシュボード**: 提案インボックスの件数（エージェント実行の状態の表示は B2 とともに将来）。

---

## 実装順序（PR の分け方の目安）

既存の運用（マイグレーションはマージ前に本番へ手動で適用し、旧コードと互換な追加だけにする）に合わせ、各段階を単体でデプロイできるようにする。

| 段階 | 内容 | 目安 |
|---|---|---|
| **A1** | `artifacts` / `artifact_links` のマイグレーションとモデル、URL の解析、Web の CRUD、task / goal / project の成果物の欄、context export への節の追加、Agent API の `artifacts:read` | 2〜3 PR |
| **B0** | プロジェクトの `key` とタスクの連番、`acceptance_criteria`、`agent_instructions`、指示書のエンドポイント、タスク画面の「指示書をコピー」 | 2 PR |
| **A2** | ノート内の成果物メンション（TipTap のノード）と、保存時のリンクの同期、被参照の表示 | 1〜2 PR |
| **B1** | 書き込みスコープ（`artifacts:write`、`logs:write`）、提案インボックス（G3）、`apps/cli`（`hc` CLI、`hc mcp`、`hc sync`、`.humancompiler.yml`） | 3〜4 PR |
| **A3** | GitHub App（Webhook、コミットのトレーラーの自動リンク、`artifact_versions`、`.tex` の本文の取り込み）を先に。その後に Google Drive の OAuth（`drive.file` と Picker、`changes.list` のポーリング、`appProperties`） | 4〜5 PR |
| **A4** | 成果物を軸にした goal（「スライドが `final` になったら完了」）、成果物とノートの横断検索 | 未定 |

A1 → B0 を先に行うと、外部サービスの認証なしで「成果物とタスクのつながり」と「Claude Code / Codex へ指示書を渡す」の両方が使えるようになる。
重い A3 は、A1〜B1 を使ってみて、手で登録するのが本当に負担になってから着手する。B2 は「将来の検討」を参照。

### `note_attachments` の扱い

未実装の `note_attachments`（`models.py:2574`）は、PDF やスライドのような成果物の受け皿としては作らず、`artifacts` に寄せる。
ノートに貼る小さな画像だけが必要になった場合に、Supabase Storage で別途検討する。

---

## 決めたこと（2026-10-25）

1. **成果物の置き場所**: ノートや論文の大本は GitHub 上の LaTeX。手書きの PDF は Google Drive。Google Docs は使わない（ローカルのエージェントで編集しやすく、数式も扱える LaTeX を続ける）。A3 は GitHub を先にする。
2. **利用者の範囲**: 複数の利用者が、それぞれ自分のデータの範囲で使う。GitHub は GitHub App にし、プロジェクトの key はユーザーごとに一意にする。
3. **タスクの委譲**: 人が指示書を取り出してローカルのエージェントに明示的に渡す（B0 / B1）。B2（キューと runner）と `hc runner --auto` は将来の検討。
4. **タスクの短い ID**: `QEC-42` の形（プロジェクトの key + 連番）。
5. **CLI と MCP サーバー**: HumanCompiler のリポジトリの `apps/cli` に1つのパッケージとして置く。ResearchDistillator のロードマップの G4 を合わせて更新する。

## 残っている論点（B0 の計画で決める）

- プロジェクトの key の付け方（タイトルから自動で候補を作り、ユーザーが変えられる形を想定）と、既存のプロジェクトへの付け方。
- key を変えたときの扱い（旧 key を別名として残すか、変更を禁止するか）。
- Agent API で短い ID からタスクを引く方法（`{task_id}` に短い ID も受け付けるか、別のパスにするか）。

## 将来の検討: エージェント実行のキュー（B2）

利用者の判断で、本提案では作らない（2026-10-25）。タスクの委譲は B0 / B1 の明示的な受け渡しで行う。
作る場合は、Agent Gateway の前提（HumanCompiler からエージェントへ依頼を送る経路は作らない）を変えることになる。`agent-gateway.md` の前提と、想定する脅威（あるユーザーの Web のアカウントが漏れると、そのユーザーのマシンでエージェントが動かされうる）を書き直してから進める。ローカルでの確認なしに実行する `hc runner --auto` も、このときに検討する。

以下は、作る場合の設計の素案として残す。

### `agent_runs`

| カラム | 型 | 備考 |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID NOT NULL | |
| `task_id` | UUID NOT NULL | ON DELETE CASCADE |
| `executor` | ENUM | `claude_code` / `codex` / `other` |
| `status` | ENUM | `queued` → `claimed` → `running` → `succeeded` / `failed` / `cancelled`。`needs_input`（エージェントが人の判断を待っている）と `lost`（heartbeat が途絶えた） |
| `brief_markdown` | TEXT NOT NULL | キューに入れた時点の指示書。後から何を渡したか追えるように残す |
| `options` | JSONB | 基点のブランチ、指示書に含める範囲など |
| `target_token_id` | UUID NULL | 特定のマシン（runner のトークン）に限る場合 |
| `claimed_by_token_id` / `claimed_at` / `heartbeat_at` | | |
| `started_at` / `finished_at` | TIMESTAMPTZ | |
| `result_summary` | TEXT | エージェントが書いた要約 |
| `result` | JSONB | `{branch, pr_url, commits[], changed_files[], exit_code, usage}` |
| `error` | TEXT | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

### API（スコープ `runs:execute`）

| メソッド | パス | 内容 |
|---|---|---|
| GET | `/api/agent/v1/runs?status=queued&wait=25` | キューを読む。`wait` 秒までの long polling |
| POST | `/api/agent/v1/runs/{id}/claim` | `UPDATE ... SET status='claimed' WHERE id=? AND status='queued' RETURNING` で1台だけが取る |
| POST | `/api/agent/v1/runs/{id}/events` | heartbeat、進捗、`needs_input` |
| POST | `/api/agent/v1/runs/{id}/complete` | 結果。成果物と作業ログを同時に登録する |

Web 側（Supabase ログイン）には、作成（`POST /api/tasks/{id}/agent-runs`）、一覧、取り消しを置く。
heartbeat が一定時間（例: 10 分）途絶えた run は、APScheduler のジョブで `lost` にする。

### 実行が終わったとき

- `result.pr_url` や更新したファイルを成果物として登録し、`agent_run_id` 付きの `produces` / `updates` リンクを作る。
- タスクに作業ログを1件足す（「Claude Code が実行: 要約…」）。人の作業時間ではないので、work session は作らない。
- エージェントが出した状態の変更やサブタスクは提案インボックスに入る。人がまとめて承認する。
- **確認のための時間を計画に入れる。** エージェントの実行は人の時間を使わないが、結果の確認には使う。完了した run ごとに「確認: QEC-42」を日次ノートの候補（または quick task）として出し、triage と日次計画に乗せる。

### 安全性

キューは「Web からローカルのマシンでエージェントを動かせる」経路になる。HumanCompiler のアカウントやトークンが漏れたときの影響を、ローカル側の設定で抑える。

- **サーバーはシェルのコマンドを送らない。** 送るのは指示書（テキスト）と executor の種類だけ。何をどう起動するかは、ローカルの `workspaces.toml` が決める。
- **runner は `workspaces.toml` に載っているリポジトリでしか動かない。** 対応がないプロジェクトの run は claim しない。
- **既定では起動の前にローカルで確認する**（通知を出して承認を待つ）。無人で動かすのは `hc runner --auto` を明示したときだけ。
- **git worktree で動かし、作業中のツリーを触らない。** 結果はブランチと PR にとどめ、main へは直接 push しない。
- **エージェントの権限の既定は控えめにする**（Claude Code は `acceptEdits`、Codex は `workspace-write` のサンドボックス）。権限を確認しないモードは、利用者が `workspaces.toml` に自分で書いた場合だけ使う。
- runner のトークンは `runs:execute` と最小限の読み取り・報告のスコープだけを持たせ、マシンごとに発行する。監査ログでどのマシンがどの run を取ったか追える。
- 指示書の「参考資料」（ノート、成果物の抽出テキスト）は外部の文章を含みうるので、指示と区切り、エージェントに指示として扱わないよう書く。
- long polling は1回ごとに監査ログが1行増え（runner 1台で1日 約 3,000 行）、同期の Session がスレッドを占有する。作るときに、監査ログの扱いと待ち方を決める。

---

## 範囲外

- ファイルの保存・プレビュー（HumanCompiler はファイルを持たない。プレビューは各サービスの画面に任せる）
- HumanCompiler からローカルのエージェントを起動する経路（B2）。「将来の検討」を参照
- クラウドで動くエージェント（Claude Code on the web、Codex cloud など）への委譲
- 成果物の中身の編集（PDF への書き込み、スライドの自動生成）
- 複数人での共同編集・権限の共有
