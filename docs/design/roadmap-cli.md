# ロードマップ CLI 設計（`humancompiler-roadmap`）

作成日: 2026-11-07
状態: 実装済み（この PR）
関連: [エージェントの書き込みと MCP サーバー設計](agent-mcp.md)、タイムラインの描画の作り直し（#431）、容量設定からの週の作業時間（#433）

## 概要

### 何のためか

タイムライン画面のロードマップ（#431）を、エージェントにも使わせたい。エージェントはプロジェクトの計画を知りたいし、ユーザーに図を見せたいこともある。

### 決めたこと（ユーザーとの相談、2026-11-06）

| 項目 | 決定 |
|---|---|
| 画像の作り方 | MCP で画像を返さない。軽い情報だけを取得し、描画は**利用者の手元**で行う |
| 配布の形 | npm の CLI（`npx humancompiler-roadmap`） |
| 先に作った PR | MCP から PNG を返す #432 は閉じて、この方式で作り直す |

### MCP で画像を返さない理由

#432 では、MCP ツールが Vercel 上の Web に描画させて、PNG を返していた。試して分かった問題は次のとおり。

- **ページを跨げない。** 画像を見るモデルは、長辺を約 1.5k px に縮める。ゴールが20〜25件を超えると文字が潰れる。モデルはスクロールもズームもできない。
- **サイズの上限がある。** 大きいプロジェクトでは PNG が 7.5MB になった。画像 API は約 5MB を超える画像を受け付けない。
- **数値は画像から正確に読めない。** 完了見込みの日付などは、テキストで渡す方が確実。
- **SVG もよくない。** SVG をテキストで渡すと、ゴール6件で約6k トークン、80件では約50k トークンになる。中身は座標の羅列なので、モデルは絵として読めない。
- **構成が重い。** Web に描画用の内部ルートを置き、API と Web で共有シークレットを持つ必要があった。

### 何を作るか

- **Agent API：** `GET /api/agent/v1/projects/{id}/timeline`。タイムライン画面が描画に使うデータと同じものを返す。
- **npm パッケージ `humancompiler-roadmap`**（`packages/roadmap`）。CLI は次の2つを行う。
  - Agent API からデータを取得して、ロードマップを PNG か SVG で保存する。
  - スケジュールの要約を Markdown か JSON で標準出力に出す。

---

## 構成

```
エージェント（Claude Code / Codex など）
  │  npx humancompiler-roadmap <project-id>     ← HUMANCOMPILER_TOKEN
  ▼
humancompiler-roadmap（利用者の手元）
  ├ GET /api/agent/v1/projects/{id}/timeline ──▶ API (Fly)：build_project_timeline
  ├ buildSchedule → buildChartLayout → TimelineExportDocument（Web と同じコード）
  ├ resvg で PNG（Noto Sans JP を同梱）→ roadmap.png
  └ 標準出力：要約（Markdown / JSON）
```

- **データはエージェントのコンテキストを通らない。** CLI が API から直接取得するため。エージェントは標準出力の要約だけを読み、図が必要なときだけ画像を開く。
- **描画は Web と同じコードで行う。** CLI は、ビルド時に `apps/web/src` のロードマップのコードを `@/...` の別名で取り込み、1つのファイルに束ねる（esbuild）。対象は次のとおり。
  - `lib/timeline` の `schedule`、`chart-layout`、`geometry`、`utils`、`types`
  - `components/timeline` の `timeline-export`、`timeline-chart-layers`、`timeline-palette`
  - タイムライン画面の描画を変えれば、CLI の画像も同じになる。Web 側のコードは変えていない。
- **MCP の役割は今までどおり。** プロジェクトを探す（`find`）、ゴールやタスクを読む、更新する、といった軽い操作に使う。

---

## Agent API：`GET /api/agent/v1/projects/{project_id}/timeline`

- **スコープ：** `projects:read`、`goals:read`、`tasks:read`、`logs:read` のすべて。図には Goal、Task と、作業ログから描く過去のバーが出るため。
- **依存関数：** 複数のスコープを求めるため、`require_scopes(*scopes)` を `agent_auth` に足した。`require_scope` はこれを使う形に変えた。監査ログの `required_scope` には、MCP と同じくカンマ区切りで記録する（4つで45文字、列は `VARCHAR(50)`）。
- **応答：** Web の `GET /api/timeline/projects/{id}` と同じ `ProjectTimelineResponse`。週の作業時間は、容量設定から求めた `project.capacity` を含む（#433）。
- **持ち主の確認：** 他人のプロジェクトも、存在しないプロジェクトも、同じ 404 にする。
- **データの組み立て：** `routers/timeline.py` から `build_project_timeline(session, project, ...)` に切り出し、Web の API と共有する。Web の API の挙動は変えていない。

---

## CLI：`humancompiler-roadmap`

### 使い方

```bash
export HUMANCOMPILER_TOKEN=hc_agent_...
npx humancompiler-roadmap <project-id> [-o roadmap.png] [--goals-per-page 20] [--json]
```

| オプション | 既定 | 内容 |
|---|---|---|
| `-o, --output` | `roadmap.png` | `.png` か `.svg`。複数ページなら `roadmap-1.png`、`roadmap-2.png`、… |
| `--goals-per-page` | 0（1枚） | 1枚あたりのゴール数。約20にすると、1枚ずつモデルが読める大きさになる |
| `--json` / `--no-image` | | 要約を JSON で出す / 画像を作らない |
| `--weekly-hours` | 容量設定 | 計画に使う週の作業時間。既定は容量設定のプロジェクトの割り当て。割合が0なら、画面と同じ仮の20時間を使い、標準エラーに注意を出す |
| `--zoom`、`--width`、`--expand-tasks`、`--hide-completed`、`--no-dependencies`、`--pixel-ratio`、`--now` | | 画面の表示切り替えと同じ |
| `--input` | | API の応答を保存した JSON から描く（試験用） |
| `--api-url` | `$HUMANCOMPILER_API_URL`、無ければ本番 | API の URL |

### ページ分け

- スケジュールはプロジェクト全体で1回だけ計算する。そのため、どのページの日付、合計、完了見込みも同じになる。
- 各ページは、自分のゴールだけでレイアウトする。ページを跨ぐ依存の線は描かない。レイアウト側が、行の無いゴールへの線を省くため。
- 各ページの題に「(1/3)」のような番号を付ける。

### 要約

- **Markdown（既定）：** 時点、進捗、残り時間、完了見込み、週の作業時間とその出どころ、遅れる見込みのゴールの数。続けて、ゴールごとの表（状態、開始、完了〔見込み・推定〕、期限、遅れ、残り、前提待ち）と、作った画像の一覧。文言は画面に合わせて日本語にする。
- **JSON（`--json`）：** 同じ内容を ISO 8601 の日時で出す。エージェントが計算に使う想定。

### セキュリティ

- トークンは環境変数 `HUMANCOMPILER_TOKEN` だけから読む。コマンドラインの引数では受け取らない（シェルの履歴に残るため）。MCP の設定と同じ変数名にした。
- API の URL は https に限る。http を使えるのは localhost だけ。
- リダイレクトは辿らない（`redirect: 'error'`）。トークンが別のホストに送られないようにするため。

### パッケージ

- **名前：** `humancompiler-roadmap`（スコープなし）。スコープ付きの名前にするには npm で組織を作る必要があるため、今回は見送った。
- **中身：** 束ねた `dist/cli.js`（約 215KB）、Noto Sans JP の Regular と Bold（OFL）、AGPL のライセンス文。圧縮で 6.7MB、展開で 11.7MB。
- **依存：** 実行時の依存は `@resvg/resvg-js`（ネイティブのバイナリ）だけ。React、react-dom、date-fns は束ねる。
- **ビルド：** `scripts/build.mjs` が esbuild で束ねる。あわせて、フォントとライセンス文をパッケージにコピーする。どちらも git の管理外。
- **公開：** `packages/roadmap` で `npm publish` を実行する。`prepublishOnly` が、先に型チェックとテストを走らせる。公開はユーザーが手で行う。

---

## テスト

- **バックエンド（pytest、`tests/test_agent_v1_timeline.py`）：**
  - ゴール、タスク、依存、作業ログと容量設定を返す。
  - 他人のプロジェクトも、存在しないプロジェクトも 404 になる。
  - 4つのスコープのどれが欠けても 403 になる。
  - 監査ログに4つのスコープが記録される。
  - トークンが無ければ 401 になる。
- **CLI（`node:test`、`packages/roadmap/test/cli.test.mjs`）：** ビルドした CLI を実際に起動して確かめる。
  - **ファイルから描く：** PNG と Markdown、JSON、`--weekly-hours` の上書き、容量が無いときの仮の値と注意、ページ分け、SVG と題のエスケープ、`--no-image`、`--hide-completed`、不正な引数。
  - **ローカルの模擬 API から取得する：** トークンとパスの送り方、401・403・404 のメッセージ、トークンが無いとき、http の外部ホストを拒むこと。
- **CI：** `.github/workflows/roadmap-cli.yml`。`packages/roadmap` と、Web のロードマップのコードが変わったときに、型チェックとテストを走らせる。

---

## 後で直すもの

- **npm への公開。** ユーザーが手で行う。公開してから、MCP の案内（`INSTRUCTIONS`）と設定画面のトークンの使い方ガイドに、この CLI を載せる。
- **Web の型。** `TimelineTask.goal_id` は型にあるが、API は返さない。
- **画像で ID を指定する。** `--goal-ids` で特定のゴールだけを描く、という絞り込みが要るかもしれない。必要になったら足す。
