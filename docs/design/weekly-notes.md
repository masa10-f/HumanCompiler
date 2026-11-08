# 週次ノート

1週間（月曜〜日曜）ごとに1つ持つ、自由に書けるノート。日次ノートが「その日の予定と記録」なのに対して、週次ノートは「今週の目標」「振り返り」「来週へ持ち越すこと」を1か所にまとめるためのもの。画面は `/notes/weekly`（ノート一覧の「週次ノート」タブ）。エージェントは MCP の `get_weekly_note` / `list_weekly_notes` で読める。

## 週の決め方

- 週は ISO 8601 と同じく **月曜始まり**。週のリズムの `weekday` 0 = 月曜とそろえる。
- 週は、その週の月曜の日付（`week_start`、`YYYY-MM-DD`）で指す。
- 「今週」は日本時間で決める（日次ノートの「今日」と同じ）。

## 画面

- `/notes/weekly?week=YYYY-MM-DD` で開く。`week` は週のどの日でもよく、その週の月曜に直す。省くと今週。
- 前の週・今週・次の週で移動する。見出しは「2026年 第45週」と「2026年11月2日（月）〜8日（日）」。
- 本文はプロジェクト・Goal・Task のノートと同じリッチテキストエディター（`ContextNotePanel`）。保存は入力の 500ms 後で、`expected_updated_at` で競合を検出する。別の場所で変わっていたら、ほかのノートと同じ競合のバナー（最新を読み込む／この内容で上書き）を出す。
- 週を移ると、エディターは週ごとに作り直す（React の `key`）。保存待ちの入力は、移る前にその週へ保存する。
- 横に「この週の日次ノート」（7日分、日次ノートのタイトル、その日の日次ノートへのリンク）と「最近の週次ノート」（新しい週から8件）を出す。

## API（Web）

| メソッド | パス | 内容 |
| --- | --- | --- |
| GET | `/api/weekly-notes` | 空でない週次ノートを新しい週から。`before`（その月曜より前の週）、`limit`（1〜50、既定20）。`next_cursor` を次の `before` に渡す |
| GET | `/api/weekly-notes/{week_start}` | その週のノート。無ければ空のノート（`id`・`updated_at` が `null`）を返し、行は作らない |
| PUT | `/api/weekly-notes/{week_start}` | `{content, content_type?, expected_updated_at?}`。無ければ作る |

- `week_start` が月曜でなければ 400。
- `expected_updated_at` が保存済みの値と違えば 409 `{message, current_updated_at}` で、何も書かない。省くと上書き（競合のバナーの「上書き」）。まだ無い週に初めて保存するときは省く。同じ週を2つのタブで同時に作ると、後から保存したほうが勝つ。
- 見える内容のないノート（エディターの `<p></p>` など）は `""` として保存し、一覧に出さない。
- `content_type` は `html`（既定）か `markdown`。本文は 1,000,000 文字まで。

## エージェント（MCP と REST）

スコープ `weekly_notes:read` が要る。読み取りのプリセット（読み取り専用・提案する・作業するエージェント）に含まれる。

**既存のトークンには付かない。** スコープは作成後に変えない決まりのため（権限が後から広がる経路をなくす、[agent-gateway.md](./agent-gateway.md)）。週次ノートを読ませるには、プリセットでトークンを作り直す。`daily_plans:read` に含めなかったのも同じ理由。

| 入口 | 内容 |
| --- | --- |
| MCP `get_weekly_note` | `date`（週のどの日でもよい。省くと今週）の週の `{week_start, week_end, note}`。`note` は `{id, updated_at, content_markdown}`、無いか空なら `null` |
| MCP `list_weekly_notes` | 空でないノートを新しい週から `limit`（1〜12、既定4）件、Markdown で。`date_from`・`date_to` は任意の日で、範囲に重なる週を返す。`has_more` があれば、いちばん古い `week_start` の前日を `date_to` にして続きを読む |
| REST `GET /api/agent/v1/weekly-notes` | `(updated_at, id)` 順のページ（ほかの一覧と同じ差分同期）。本文は HTML のまま。空のノートも返す（空にしたことを差分で拾えるように） |

MCP は context note と同じ変換（`note_html_to_markdown`）で Markdown にする。書き込みのツールはまだない。

## データ

`weekly_notes`（マイグレーション `043_add_weekly_notes.sql`）。ユーザーと週で一意（`uq_weekly_notes_user_week`）。`week_start` が月曜であることを CHECK で保証する。ユーザーを削除するとノートも削除する。RLS は所有者の行だけを許可する。

## 展開手順

1. `043_add_weekly_notes.sql` を適用する（追加のみで、旧 API はこのテーブルを読まない）。
2. API、次に Web をデプロイする。追加の環境変数やパッケージは不要。
3. `/notes/weekly` で書いて保存し、再読み込みで残ることを確かめる。`weekly_notes:read` を持つトークンで MCP の `get_weekly_note` を呼び、Markdown が返ることを確かめる。

ロールバックは Web と API を戻してから `043_add_weekly_notes_rollback.sql` を適用する。週次ノートはすべて消えるので、残すなら先にテーブルをバックアップする。

## 対象外（今後）

- MCP からの書き込み（例: 週の終わりにエージェントが振り返りを追記する `append_weekly_note`）。
- 週次ノートのテンプレート（「今週の目標」「振り返り」などの見出しを最初に入れる）。
- 週の作業ログの集計（週次レポート）や週のリズムの予定時間を、週次ノートの横に出すこと。
- 週次ノートの全文検索と、データエクスポート・バックアップへの追加。
