# CLI 設計（`humancompiler`）

作成日: 2026-11-07（ロードマップ CLI として作成。同日、CLI 全体の設計に更新）
状態: 実装済み（`roadmap` は #435、ほかのサブコマンドと npm 公開の自動化はこの PR）
関連: [エージェントの書き込みと MCP サーバー設計](agent-mcp.md)、タイムラインの描画の作り直し（#431）、容量設定からの週の作業時間（#433）

## 概要

### 何のためか

エージェント（Claude Code、Codex など）が HumanCompiler を使うための CLI。MCP では重い処理や大きいデータを扱わず、利用者の手元で処理する。

- **ロードマップ（`roadmap`）：** タイムライン画面のロードマップ（#431）を、手元で描画して要約を出す。
- **コンテキスト（`context`）：** プロジェクトやゴールのノート、タスク、作業履歴を、1つの Markdown にまとめて取得する。
- **接続の設定（`setup`）：** エージェントを HumanCompiler の MCP サーバーにつなぐ設定と、エージェント向けの使い方の案内を書き込む。
- **診断（`doctor`）：** 動かないときに、何が足りないかと直し方を示す。

### 決めたこと

ユーザーとの相談で、次のように決めた。

| 項目 | 決定 |
|---|---|
| 画像の作り方（2026-11-06） | MCP で画像を返さない。軽い情報だけを取得し、描画は**利用者の手元**で行う |
| 先に作った PR（2026-11-06） | MCP から PNG を返す #432 は閉じて、この方式で作り直す |
| パッケージ名とコマンド名（2026-11-07） | **`humancompiler`**。サブコマンド形式にする。npm で空いていることを確かめた |
| サブコマンド（2026-11-07） | `roadmap`、`setup`、`doctor`、`context` の4つ |
| 公開（2026-11-07） | npm に公開する。GitHub Actions と npm の Trusted Publishing で自動化する |
| 認証（2026-11-07） | MCP と同じエージェントトークン。環境変数 `HUMANCOMPILER_TOKEN` だけから読む。コマンドラインの引数では受け取らない。`login` コマンドも、トークンを保存する設定ファイルも作らない |
| MCP の案内（2026-11-07） | `INSTRUCTIONS` と設定画面の使い方ガイドに、`npx humancompiler roadmap` と `context` を載せる。初回の公開の前にマージされるが、この PR に含める |

### MCP で画像を返さない理由

#432 では、MCP ツールが Vercel 上の Web に描画させて、PNG を返していた。試して分かった問題は次のとおり。

- **ページを跨げない。** 画像を見るモデルは、長辺を約 1.5k px に縮める。ゴールが20〜25件を超えると文字が潰れる。モデルはスクロールもズームもできない。
- **サイズの上限がある。** 大きいプロジェクトでは PNG が 7.5MB になった。画像 API は約 5MB を超える画像を受け付けない。
- **数値は画像から正確に読めない。** 完了見込みの日付などは、テキストで渡す方が確実。
- **SVG もよくない。** SVG をテキストで渡すと、ゴール6件で約6k トークン、80件では約50k トークンになる。中身は座標の羅列なので、モデルは絵として読めない。
- **構成が重い。** Web に描画用の内部ルートを置き、API と Web で共有シークレットを持つ必要があった。

---

## 構成

```
エージェント（Claude Code / Codex など）
  │  npx humancompiler <command> ...            ← HUMANCOMPILER_TOKEN
  ▼
humancompiler（利用者の手元、packages/cli）
  ├ roadmap  GET /api/agent/v1/projects/{id}/timeline ──▶ API (Fly)
  │          buildSchedule → buildChartLayout → TimelineExportDocument（Web と同じコード）
  │          resvg で PNG（Noto Sans JP を同梱）、標準出力に要約
  ├ context  GET /api/agent/v1/context-export/{projects|goals}/{id} ──▶ API
  │          Markdown をファイルか標準出力へ
  ├ doctor   GET /health、GET /api/agent/v1/me ──▶ API
  └ setup    .mcp.json / ~/.codex/config.toml と CLAUDE.md / AGENTS.md を書く（通信しない）
```

- **データはエージェントのコンテキストを通らない。** CLI が API から直接取得するため。エージェントは要約や、ファイルの必要な部分だけを読む。
- **MCP の役割は今までどおり。** プロジェクトを探す（`find`）、ゴールやタスクを読む、更新する、といった軽い操作に使う。

### ソースの構成

| ファイル | 役割 |
|---|---|
| `src/cli.ts` | 入口。サブコマンドの振り分け、全体の `--help` と `--version`、エラーの表示 |
| `src/api.ts` | 全サブコマンドで共通の API クライアント。API の URL、トークン、リクエスト、エラーメッセージ、サブコマンドごとの必要なスコープ |
| `src/args.ts` | 数値オプションの検査、Node のバージョンの確認、使い方の誤りの扱い |
| `src/commands/*.ts` | 各サブコマンド |
| `src/render.ts`、`src/summary.ts` | `roadmap` の描画と要約 |

- **サブコマンドは必要なときに読み込む。** `roadmap` は描画のコードと、ネイティブの `@resvg/resvg-js` を読み込む。動的 `import()` にしたので、ほかのサブコマンドはこれらを読み込まない。resvg のバイナリが無い環境でも、`setup` と `doctor` は動く。
- **エラー：** 使い方の誤りは終了コード 2、それ以外の失敗は 1。メッセージの頭に `humancompiler <command>:` を付ける。

---

## 共通の決まり（`src/api.ts`）

- **トークン：** 環境変数 `HUMANCOMPILER_TOKEN` だけから読む。コマンドラインの引数では受け取らない（シェルの履歴に残るため）。MCP の設定と同じ変数名にした。
- **API の URL：** `--api-url`、無ければ `HUMANCOMPILER_API_URL`、無ければ本番（`https://humancompiler-api-masa.fly.dev`）。https に限る。http を使えるのは localhost だけ。
  - `setup` だけは `HUMANCOMPILER_API_URL` を見ない（後述）。
- **リダイレクトは辿らない**（`redirect: 'error'`）。トークンが別のホストに送られないようにするため。
- **タイムアウト：** 30秒。
- **エラーメッセージ：** HTTP の状態ごとに、直し方の分かる文にする。
  - 401：トークンが拒否された。`HUMANCOMPILER_TOKEN` を確かめる。
  - 403：API の `detail` に続けて、そのサブコマンドに必要なスコープを示す。
  - 404：何が見つからないか（`Project <id>`、`Goal <id>`）。
  - 422：FastAPI の検証エラーの一覧を `項目: 内容` の形にまとめる（例：ID が UUID でない）。
  - 429：時間をおいて試す。
  - 通信の失敗：`fetch failed` ではなく、原因（`ENOTFOUND`、`ECONNREFUSED` など）を出す。
- **サブコマンドごとの必要なスコープ**（`COMMAND_SCOPES`）。403 のメッセージと `doctor` が使う。

| サブコマンド | スコープ |
|---|---|
| `roadmap` | `projects:read`、`goals:read`、`tasks:read`、`logs:read` |
| `context` | `context:read` |
| `setup`、`doctor` | なし |

---

## `roadmap`

### Agent API：`GET /api/agent/v1/projects/{project_id}/timeline`（#435）

- **スコープ：** `projects:read`、`goals:read`、`tasks:read`、`logs:read` のすべて。図には Goal、Task と、作業ログから描く過去のバーが出るため。
- **依存関数：** 複数のスコープを求めるため、`require_scopes(*scopes)` を `agent_auth` に足した。`require_scope` はこれを使う形に変えた。監査ログの `required_scope` には、MCP と同じくカンマ区切りで記録する（4つで45文字、列は `VARCHAR(50)`）。
- **応答：** Web の `GET /api/timeline/projects/{id}` と同じ `ProjectTimelineResponse`。週の作業時間は、容量設定から求めた `project.capacity` を含む（#433）。
- **持ち主の確認：** 他人のプロジェクトも、存在しないプロジェクトも、同じ 404 にする。
- **データの組み立て：** `routers/timeline.py` から `build_project_timeline(session, project, ...)` に切り出し、Web の API と共有する。

### 使い方

```bash
npx humancompiler roadmap <project-id> [-o roadmap.png] [--goals-per-page 20] [--json]
```

| オプション | 既定 | 内容 |
|---|---|---|
| `-o, --output` | `roadmap.png` | `.png` か `.svg`。複数ページなら `roadmap-1.png`、`roadmap-2.png`、… |
| `--goals-per-page` | 0（1枚） | 1枚あたりのゴール数。約20にすると、1枚ずつモデルが読める大きさになる |
| `--json` / `--no-image` | | 要約を JSON で出す / 画像を作らない |
| `--weekly-hours` | 容量設定 | 計画に使う週の作業時間。既定は容量設定のプロジェクトの割り当て。割合が0なら、画面と同じ仮の20時間を使い、標準エラーに注意を出す |
| `--width` | 1400 | 画像の幅。640〜4000 の整数（小数は拒む） |
| `--zoom`、`--expand-tasks`、`--hide-completed`、`--no-dependencies`、`--pixel-ratio`、`--now` | | 画面の表示切り替えと同じ |
| `--input` | | API の応答を保存した JSON から描く（試験用） |
| `--api-url` | `$HUMANCOMPILER_API_URL`、無ければ本番 | API の URL |

オプションと出力は、`humancompiler-roadmap`（#435）から変えていない。`--width` に整数の検査を足しただけ。

### 描画

- **Web と同じコードで描く。** ビルド時に `apps/web/src` のロードマップのコードを `@/...` の別名で取り込み、1つのファイルに束ねる（esbuild）。対象は次のとおり。
  - `lib/timeline` の `schedule`、`chart-layout`、`geometry`、`utils`、`types`
  - `components/timeline` の `timeline-export`、`timeline-chart-layers`、`timeline-palette`
- **Web の描画を変えたら、CLI の `version` も上げる。** 公開済みの CLI には、公開した時点の Web のコードが入っている。新しい版を公開するまで、利用者の画像は変わらない（後述の「公開」）。

### ページ分け

- スケジュールはプロジェクト全体で1回だけ計算する。そのため、どのページの日付、合計、完了見込みも同じになる。
- 各ページは、自分のゴールだけでレイアウトする。ページを跨ぐ依存の線は描かない。レイアウト側が、行の無いゴールへの線を省くため。
- 各ページの題に「(1/3)」のような番号を付ける。

### 要約

- **Markdown（既定）：** 時点、進捗、残り時間、完了見込み、週の作業時間とその出どころ、遅れる見込みのゴールの数。続けて、ゴールごとの表（状態、開始、完了〔見込み・推定〕、期限、遅れ、残り、前提待ち）と、作った画像の一覧。文言は画面に合わせて日本語にする。
- **JSON（`--json`）：** 同じ内容を ISO 8601 の日時で出す。エージェントが計算に使う想定。

---

## `context`

```bash
npx humancompiler context <project|goal> <id> [-o file.md]
```

- **エンドポイント：** `GET /api/agent/v1/context-export/projects/{project_id}` と `.../goals/{goal_id}`（`agent_v1.py` の `export_project_context`、`export_goal_context`）。スコープは `context:read`。
  - 応答は `{filename, markdown, generated_at}`。CLI は `markdown` だけを出す。
  - ID は UUID。違えば API が 422 を返し、CLI は `goal_id: Input should be a valid UUID` のように示す。
- **オプション：** API のクエリパラメータ（`get_export_options`）にそのまま対応させた。

| オプション | API のパラメータ | 既定 |
|---|---|---|
| `--no-completed` | `include_completed=false` | 含める |
| `--no-work-sessions` | `include_work_sessions=false` | 含める |
| `--no-daily-plans` | `include_daily_plans=false` | 含める |
| `--period-days <n>` | `period_days`（1〜3650） | 全期間 |

- **出力：** `-o` があればファイルに書き、標準出力には行数とバイト数だけを出す。エージェントが、必要な部分だけをファイルから読めるようにするため。`-o` が無ければ標準出力に Markdown を出す。

---

## `setup`

```bash
npx humancompiler setup claude-code   # プロジェクトのディレクトリで
npx humancompiler setup codex
```

### 書き込むもの

| エージェント | MCP サーバー | 案内 |
|---|---|---|
| Claude Code | プロジェクトの `.mcp.json` の `mcpServers.humancompiler` | `CLAUDE.md` |
| Codex | `~/.codex/config.toml`（`CODEX_HOME` があればその下）の `[mcp_servers.humancompiler]` | `AGENTS.md` |

- **Claude Code：** `{"type": "http", "url": "https://humancompiler-api-masa.fly.dev/mcp", "headers": {"Authorization": "Bearer ${HUMANCOMPILER_TOKEN}"}}`。Claude Code は、ファイルを読み込むたびに `${...}` を環境変数から展開する。トークンの値はファイルに残らないので、コミットしても安全。
- **Codex：** `url` と `bearer_token_env_var = "HUMANCOMPILER_TOKEN"`。
- **トークンの値は絶対に書かない。** テストでも、トークンを入れた状態で実行し、どのファイルにも値が出ないことを確かめている。
- 書き方は [agent-mcp.md の「使い方の案内」](agent-mcp.md#使い方の案内)、設定画面の使い方ガイド（`agent-token-usage-guide.tsx`）と同じ。
- 両方のクライアントの文書で確かめた（2026-11-07）。
  - **Claude Code**（https://code.claude.com/docs/en/mcp ）：`"type": "http"` が正しい書き方（`url` があって `type` が無いと、stdio のサーバーと見なされて読み飛ばされる）。`url` と `headers` の `${VAR}` は展開される。
  - **Codex**（https://developers.openai.com/codex/mcp ）：この環境から文書のサイトに届かなかったため、Codex のソース（`openai/codex` の設定の読み込み）で、`[mcp_servers.<name>]`、`url`、`bearer_token_env_var` のキー名を確かめた。`bearer_token` を直接書く形は拒まれる。
- **`--api-url`：** MCP サーバーの URL は `<url>/mcp`。`setup` だけは `HUMANCOMPILER_API_URL` を見ない。`.mcp.json` はコミットされることが多いので、開発用の URL が紛れ込まないようにするため。

### 既存のファイルとの合わせ方

- **追記・マージする。** ほかのサーバー、設定、コメント、文章はそのまま残す。
- **何回実行しても同じ結果になる。** 同じ内容が既にあれば、ファイルに触らない。
- **違う内容を置き換えるときは、確認を取る。** 端末で動かしたときは尋ねる。端末でない（エージェントから動かした）ときは、何も書かずに止まり、`--force` を求める。
- **先に全部の変更を計画してから書く。** 1つでも止まる理由があれば、どのファイルも書かない。
- **メッセージに値を出さない。** 置き換える内容は、項目の名前（`url`、`headers`、`bearer_token` など）だけで示す。移行前の設定にはトークンの値が直接書かれていることがあり、端末やエージェントの記録に残さないため。
- **`.mcp.json`：** JSON として読み、`mcpServers.humancompiler` だけを足すか置き換える。ほかのキーの順番は保つ。字下げ（2文字、4文字、タブ）も元のファイルに合わせる。JSON として読めないファイルは、`--force` があっても書き換えない（中身を失うため）。
- **`config.toml`：** TOML の書き出しには頼らず、行単位で編集する。コメントと並びを残すため。
  - `[mcp_servers.humancompiler]` が無ければ、末尾に足す。
  - あれば、表の中の `url` と `bearer_token_env_var` を比べる。どちらも同じで、別のトークンを送る設定（`bearer_token`、`http_headers` など）やローカルのサーバーを起動する設定（`command`、`args`）が無ければ、そのままにする。
  - 違えば、`--force` のときに、表の頭にこの2行を書き、`url`、`bearer_token_env_var` と、上の食い違う設定を消す。ほかの設定（`tool_timeout_sec` など）と、下位の表（`[mcp_servers.humancompiler.tools.find]` など）は残す。
  - 消す設定（`url`、`bearer_token_env_var` と食い違う設定）のどれかが複数行にわたる（配列、インラインテーブル、`"""` の文字列など）ときは、行単位で消すとファイルが壊れるので、手で直すよう示して止まる。
  - `[mcp_servers.humancompiler.http_headers]` と `env_http_headers` の下位の表は、トークンと一緒に別のヘッダー（トークンの値のこともある）を送るので、`--force` があっても止まり、消してから実行し直すよう示す。表の中のドット付きのキー（`http_headers.Authorization = ...`）は、食い違う設定として扱う。
  - ドット付きのキー（`mcp_servers.humancompiler.url = ...`）や、`[mcp_servers]` の下のインラインテーブル（`humancompiler = {...}`）は編集しない。手で直すよう、書くべき内容を示して止まる。
- **案内（`CLAUDE.md` / `AGENTS.md`）：** `<!-- humancompiler:begin ... -->` と `<!-- humancompiler:end -->` で囲む。
  - 目印が無ければ末尾に足す。あれば、その間だけを比べる。2回実行しても重複しない。
  - CLI の版が変わって案内の文が変わったときや、ユーザーが中を書き換えたときは、上と同じく確認を取ってから置き換える。目印の外は触らない。
  - `--guide-file` で別のファイルに、`--no-guide` で書かない。

### 案内の中身

エージェント向けなので英語で書く（MCP の `INSTRUCTIONS` と同じ）。

- HumanCompiler が `humancompiler` の MCP サーバーとしてつながっていること。トークンは `HUMANCOMPILER_TOKEN` にあり、表示したり、引数に渡したり、ファイルに書いたりしないこと。
- MCP の `find` で、プロジェクトやゴールの ID を調べる。
- `npx humancompiler roadmap <project-id> --goals-per-page 20` を実行し、まず要約を読む。図は、ユーザーに見せるときなど、必要なときだけ開く。
- `context` の使いどころ：プロジェクトやゴールの作業を始める前の背景の把握や、報告を書くとき。`-o` でファイルに書き、必要な部分だけを読む。ファイルはコミットしない。
- コマンドが失敗したら `npx humancompiler doctor` を実行する。

---

## `doctor`

```bash
npx humancompiler doctor [roadmap|context ...] [--api-url <url>]
```

| 確かめること | 方法 | 失敗したときの直し方の例 |
|---|---|---|
| Node のバージョン | 20.16 以上の 20.x か、22.4 以上か | 今の Node.js LTS（22 以降）を入れる |
| トークン | `HUMANCOMPILER_TOKEN` があるか | 設定画面でトークンを作り、環境変数に入れる。コマンドラインに書かない |
| API に届くか | `GET /health`（トークンを付けない） | 通信、`--api-url`、`HUMANCOMPILER_API_URL` を確かめる。503 なら時間をおく |
| トークンが有効か | `GET /api/agent/v1/me` | 401：作り直す（全体をコピーしたか確かめる）。429：待つ秒数を示す |
| スコープ | `/me` の `scopes` とサブコマンドごとの必要なスコープを比べる | スコープは作成後に変えられないので、必要なスコープを含むプリセットで作り直す |

- `/me` の応答は `AgentMeResponse`（`token_name`、`token_prefix`、`scopes`、`user_id`）。`token_name` と `token_prefix` を表示して、どのトークンかを分かるようにする。トークンの値は出さない。
- 届くかどうかの確認にトークンを付けないのは、トークンが無効なときに、API の IP ごとの認証失敗の上限に数えられる回数を、`/me` の1回だけにするため。
- **終了コード：** 1つでも失敗があれば 1。
- **サブコマンドを絞る：** `doctor roadmap` のように名前を付けると、そのスコープだけを確かめる。`roadmap` だけに使うトークンで、`context:read` が無いことを失敗にしないため。
- **Node が古いとき：** ほかのサブコマンドは起動時に止まるが、`doctor` は止まらず、確かめた結果の1つとして示す。
- **参考の表示：** このディレクトリの `.mcp.json` と Codex の `config.toml` に、`humancompiler` のサーバーがあるかを `[info]` で出す。終了コードには影響しない。

---

## パッケージ

- **名前：** `humancompiler`（スコープなし）。コマンドも `humancompiler`。`humancompiler-roadmap` は公開する前に名前を変えたので、移行は要らない。
- **中身：** 束ねた `dist/cli.js`（約 310KB）、Noto Sans JP の Regular と Bold（OFL）、AGPL のライセンス文。圧縮で 6.7MB、展開で 11.8MB。
- **依存：** 実行時の依存は `@resvg/resvg-js`（ネイティブのバイナリ）だけ。React、react-dom、date-fns は束ねる。
- **ビルド：** `scripts/build.mjs` が esbuild で束ねる。
  - パッケージの `tsconfig.json` を強制し、`@/*` → `../../apps/web/src/*` の別名と `jsx: react-jsx` を Web のファイルにも当てる。
  - `'use client'` の警告は `logOverride` で抑える。
  - `package.json` の `version` を `__VERSION__` として埋め込む（`--version`）。
  - フォントとライセンス文をパッケージにコピーする。どちらも git の管理外。
- **Node：** `engines` は `^20.16.0 || >=22.4.0`。`parseArgs` の `allowNegative`（`--no-image` など）は 22.4.0 で入り、20.16.0 に移植された。21.x と 22.0〜22.3 には無いので、メジャー番号だけでなく、この範囲で確かめる。起動時にも確かめる（`doctor` は止まらずに結果として示す）。

---

## 公開（`.github/workflows/cli-publish.yml`）

### 流れ

- **きっかけ：** main への push で `packages/cli/package.json` が変わったとき。`workflow_dispatch` で手でも動かせる。ただし main 以外から手で動かしても公開しない（ジョブの `if`）。
- **公開するかの判定：** `npm view humancompiler@<version>` で、そのバージョンが公開済みなら何もしない。
  - 未公開のときの `npm view` は、パッケージが無い場合もバージョンが無い場合も E404 で終わる。E404 以外の失敗（通信など）は、公開に進まずに失敗にする。
- **依存のインストール：** `pnpm install --frozen-lockfile --ignore-scripts`。公開のトークンを作れるジョブで、依存のインストールスクリプトを動かさないため。esbuild と resvg は出来合いのバイナリを使うので、スクリプトが無くてもビルドとテストは通る（手元で確かめた）。
- **公開前の確認：** 型チェック、ビルドとテスト、`npm pack --dry-run` で中身の一覧を出す。
- **公開：** `npm publish --provenance --access public --ignore-scripts`。
  - 確認は前の手順で済ませたので、`prepublishOnly`（手で公開するときの同じ確認）は `--ignore-scripts` で飛ばす。
  - Trusted Publishing では provenance が自動で付く。`--provenance` は、意図を明示するために付けた。
- **同時に動かさない：** `concurrency` を `cancel-in-progress: false` にした。公開の途中で止めないため。後から動いた方は、公開済みと判定して何もしない。
- **リリースの手順：** `version` を上げた PR をマージすると、公開される。git のタグや GitHub のリリースは作らない（ワークフローの権限を `contents: read` に保つため）。

### Trusted Publishing の条件

https://docs.npmjs.com/trusted-publishers で確かめた（2026-11-07。この環境から docs.npmjs.com に届かなかったため、同じ文書の元の原稿 `npm/documentation` で確かめた）。

- **npm CLI 11.5.1 以上、Node 22.14.0 以上。** npm 11.0〜11.5.0 は OIDC に対応していない。そのため、メジャー番号だけでなく、全部の番号で比べる。足りなければ `npm install -g npm@^11.5.1` で上げる。Node は既存の CI と同じ 24。
- **権限：** `id-token: write` と `contents: read`。ワークフロー全体は `contents: read` だけにし、公開のジョブにだけ `id-token: write` を付ける。
- **GitHub が用意したランナーだけ。** 自前のランナーには対応していない。
- **`package.json` の `repository.url` が、GitHub のリポジトリと完全に一致すること。** `git+https://github.com/masa10-f/HumanCompiler.git`。大文字・小文字も区別する。テストで確かめている。
- **キャッシュを使わない。** npm の文書が、公開のビルドではキャッシュを使わないよう勧めている（`package-manager-cache: false`）。
- **`workflow_dispatch`：** 同じファイルの中なので、ワークフローのファイル名の照合は変わらない（文書の注意は、`workflow_call` で別のファイルから呼ぶ場合）。

### 初回の公開（手動）

Trusted Publisher は、npm の**既存のパッケージ**の設定画面で登録する。そのため、最初の版は手で公開する。

1. マージ後、最新の main で、ユーザーが `packages/cli` で `npm publish --access public` を実行する（`prepublishOnly` が型チェック、ビルド、テストを先に走らせる）。
2. npmjs.com の **humancompiler → Settings → Trusted publishing** で、GitHub Actions を登録する。
   - Organization or user：`masa10-f`、Repository：`HumanCompiler`、Workflow filename：`cli-publish.yml`、Environment：空欄。
   - **Allowed actions で `npm publish` に印を付ける。** 2026-09-03 より後に作った設定は、既定で `npm stage publish`（承認が要る公開）しか許さない。
   - すべて大文字・小文字を区別する。npm は保存のときに確かめないので、間違いは公開の失敗で初めて分かる。
3. **登録から2日以内に、最初の自動公開を済ませる。** 新しい設定は、2日以内に公開に成功しないと失効する。次の版を出す準備ができてから登録し、`version` を上げた PR を2日以内にマージする。失効したら、消して登録し直す。
4. 以降は、`version` を上げた PR をマージすると自動で公開される。自動公開が通ったら、npm が勧めるとおり **Publishing access → Require two-factor authentication and disallow tokens** にする（Trusted Publishing はトークンを使わないので、影響しない）。

---

## テスト

- **バックエンド（pytest、`tests/test_agent_v1_timeline.py`）：**
  - ゴール、タスク、依存、作業ログと容量設定を返す。
  - 他人のプロジェクトも、存在しないプロジェクトも 404 になる。
  - 4つのスコープのどれが欠けても 403 になる。
  - 監査ログに4つのスコープが記録される。
  - トークンが無ければ 401 になる。
- **CLI（`node:test`、`packages/cli/test/*.test.mjs`）：** ビルドした `dist/cli.js` を子プロセスで実際に起動して確かめる。トークン、API の URL、`CODEX_HOME` は空にし、HOME は一時ディレクトリにする。本物の API や `~/.codex` には触らない。
  - **入口（`cli.test.mjs`）：** 全体と各サブコマンドの `--help`、`help <command>`、`--version`、引数なし、知らないサブコマンド、エラーの頭のコマンド名、パッケージ名・`bin`・`repository.url`。
  - **`roadmap`（`roadmap.test.mjs`）：** ファイルから描く（PNG と Markdown、JSON、`--weekly-hours`、容量が無いときの仮の値、ページ分け、SVG と題のエスケープ、`--no-image`、`--hide-completed`、不正な引数と小数の `--width`）。模擬 API から取得する（トークンとパス、401・403・404、JSON でない応答、プロキシのエラー、トークンが無いとき、http の外部ホストを拒む）。古い Node で止まる。
  - **`context`（`context.test.mjs`）：** 標準出力とファイル、クエリパラメータ、403・404・422・401 のメッセージ、引数の誤り（API を呼ばない）、トークンが無いとき、http の外部ホストを拒む。
  - **`doctor`（`doctor.test.mjs`）：** すべて揃っていれば 0、スコープの不足、サブコマンドで絞る、無効なトークン、429 の待ち時間、トークンが無いとき（`/me` を呼ばない）、API の 503、届かない API、http の外部ホスト、古い Node、`setup` の状態の表示。
  - **`setup`（`setup.test.mjs`）：** 新しく作る、2回目は何も変えない、既存のファイルへのマージ（ほかのサーバー、字下げ、文章）、違う内容は `--force` が要り何も書かない、案内の更新、壊れた JSON、`--no-guide`・`--guide-file`・`--dir`・`--api-url`、`HUMANCOMPILER_API_URL` を見ないこと、Codex の作成、`CODEX_HOME`、TOML のコメントやほかの表を残すこと、同じ意味の既存の表、`--force` で他の設定を残すこと、編集しない形の検出、`AGENTS.md` を両方で使っても重複しないこと。どのテストでもトークンの値がファイルに出ないことを確かめる。
- **CI：** `.github/workflows/cli.yml`。`packages/cli` と、Web のロードマップのコードが変わったときに、型チェックとテストを走らせる。

---

## 後で直すもの

- **Web の型。** `TimelineTask.goal_id` は型にあるが、API は返さない。
- **画像で ID を指定する。** `--goal-ids` で特定のゴールだけを描く、という絞り込みが要るかもしれない。必要になったら足す。
- **Web の描画を変えた PR で `version` を上げ忘れる。** 今は README とこのメモに書いただけ。忘れが続くようなら、CI で「`apps/web/src/lib/timeline` などが変わったのに `version` が同じ」を警告する。
