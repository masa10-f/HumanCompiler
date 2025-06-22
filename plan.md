# タスク管理ウェブアプリ設計ガイド

## 目的

研究・開発プロジェクトを **大目標 → 週 → 日 → 実績** の４階層で管理し、LLM と制約ソルバにより自動スケジューリング・進捗可視化・リスケを行う。

## 技術スタック

| レイヤ           | 採用技術                                                                                      |
| ---------------- | --------------------------------------------------------------------------------------------- |
| フロントエンド   | **Next.js 14 (App Router) / React 19**, **TypeScript**, TailwindCSS, shadcn/ui, PWA (workbox) |
| バックエンド     | **FastAPI (Python 3.11)** + Uvicorn, LangGraph cron worker                                    |
| データベース     | Supabase Postgres + pgvector                                                                  |
| AI               | OpenAI Assistants API (function calling)                                                      |
| スケジューラ     | OR‑Tools CP‑SAT                                                                               |
| CI/CD & インフラ | GitHub Actions, Vercel (frontend), Fly.io (API & worker)                                      |

## ディレクトリ構成 (monorepo)

```text
repo-root/
├── apps/
│   ├── web/        # Next.js アプリ (TypeScript)
│   └── api/        # FastAPI サービス (Python)
├── packages/
│   ├── db/         # Prisma/SQLModel スキーマ & マイグレーション
│   └── scheduler/  # OR-Tools ラッパ (Python パッケージ)
└── .github/workflows/
```

## ER 図（論理モデル）

```text
users(id, email, ...)
projects(id, owner_id, title, description)
goals(id, project_id, title, estimate_hours)
tasks(id, goal_id, title, estimate_hours, due, status)
schedules(id, user_id, date, plan_json)
logs(id, task_id, actual_minutes, comment, created_at)
```

## API 仕様（抜粋）

### POST `/api/tasks`

| フィールド    | 型     | 必須 | 説明         |
| ------------- | ------ | ---- | ------------ |
| title         | string | ✓    | タスク名     |
| goalId        | uuid   | ✓    | 紐付くゴール |
| estimateHours | number | ✓    | 見積時間 (h) |

### POST `/api/schedule/daily`

入力 JSON:

```json
{
  "date": "2025-06-23",
  "availableSlots": [
    {"start": "08:30", "end": "11:30", "kind": "study"},
    {"start": "11:30", "end": "18:00", "kind": "deep"},
    {"start": "20:00", "end": "23:00", "kind": "light"}
  ]
}
```

処理フロー: Next → FastAPI → OR‑Tools `solve()` → LLM `explain_schedule()` → JSON レスポンス

## LLM オーケストレーション

* **Function schema**

  * `create_week_plan(goals[], capacity_hours, prefs)`
  * `update_plan(progress_delta)`
* LangGraph ノード構成

  1. `FetchContextNode` — DB からゴール & 実績取得
  2. `CallLLMNode` — OpenAI Assistants API 呼び出し
  3. `PersistPlanNode` — 生成結果を `schedules` へ保存
* cron: 「毎週日曜 07:00」「毎朝 08:30」

## スケジューリングロジック (OR‑Tools)

1. タスク集合 **T** とスロット集合 **S** を入力
2. 変数 `x_{i,s} ∈ {0,1}`: スロット s にタスク t\_i を割当
3. 制約

   * `Σ_s x_{i,s}·len(s) = d_i` (所要時間充足)
   * 同一スロット内重複禁止
   * 締切ペナルティ & 時間帯プリファレンス (soft)
4. 目的関数: ペナルティ最小化 (遅延 + プリファレンス違反)

## TypeScript 設定

* `tsconfig.json`: `"strict": true`, `"noUncheckedIndexedAccess": true`
* バリデーション: `zod` でスキーマ共有 (`packages/validation`)
* API 呼び出しは tRPC or REST + `fetchApi` ラッパ

## 開発規約

* **ESLint** (`eslint-config-next` + `@typescript-eslint`) & **Prettier**
* Git hooks: Husky + lint‑staged
* Commit: Conventional Commits (`feat:`, `fix:`, ...)
* テスト: Jest (web) / Vitest 可、Pytest (API)

## セットアップ

```bash
pnpm i
cp .env.example .env
supabase start
pnpm --filter web dev # Next.js
fly launch             # API コンテナ初期化
```

## デプロイ

```bash
# web (Vercel)
vercel --prod

# api (Fly.io)
fly deploy
```

Secrets:

* `OPENAI_API_KEY`
* `SUPABASE_URL`, `SUPABASE_ANON_KEY`
* `DATABASE_URL`

## 開発計画・進捗状況

### Phase 1: 基盤構築 ✅ **完了**

1. **monorepo構造セットアップ** ✅
   - pnpm workspace設定
   - apps/web (Next.js)、apps/api (FastAPI)ディレクトリ作成
   - packages/db、packages/schedulerパッケージ構成
   - 基本的なpackage.json、tsconfig.json設定

2. **Supabase Postgresデータベース** ✅
   - Supabaseプロジェクト作成・設定
   - テーブル設計: users, projects, goals, tasks, schedules, logs
   - RLS (Row Level Security) 設定
   - 初期マイグレーション実行

3. **FastAPI基盤セットアップ** ✅
   - FastAPI + Uvicorn基本構成
   - CORS設定、環境変数管理
   - Supabase接続設定
   - ヘルスチェックエンドポイント

4. **Next.js 14基盤セットアップ** ✅
   - App Router構成
   - TailwindCSS、shadcn/ui導入
   - TypeScript strict設定
   - 基本レイアウト・ルーティング

5. **Supabase認証機能実装** ✅
   - ユーザー登録・ログイン画面
   - セッション管理・ミドルウェア
   - 認証状態管理 (Context/Zustand)

### Phase 2: コア機能開発 🔄 **進行中**

6. **基本CRUD API実装** ✅ **完了**
   - SQLModel/Pydanticモデル定義 (User, Project, Goal, Task, Schedule, Log)
   - FastAPI エンドポイント実装 (projects, goals, tasks の全CRUD操作)
   - バリデーション・エラーハンドリング (カスタム例外クラス)
   - 所有権ベースのアクセス制御実装
   - サービス層による業務ロジック分離
   - 包括的なテストスイート (8個のテストが通過)

7. **タスク・ゴール管理UI** 🚧 **次のタスク**
   - 🚧 プロジェクト一覧・作成画面 ← **現在実装中**
   - ⏳ ゴール管理画面
   - ⏳ タスク作成・編集・削除機能
   - ⏳ shadcn/ui Table、Dialog、Form使用

8. **OR-Toolsスケジューラパッケージ** ⏳
   - packages/scheduler Python パッケージ
   - 制約充足問題定義・実装
   - タスク割り当て最適化ロジック
   - API用ラッパー関数

9. **スケジューリングAPI実装** ⏳
   - POST /api/schedule/daily エンドポイント
   - 利用可能時間スロット入力処理
   - OR-Tools CP-SAT ソルバー呼び出し
   - 最適化結果JSON返却

10. **OpenAI Assistants API統合** ⏳
    - OpenAI関数定義 (create_week_plan, update_plan)
    - 週間計画生成ロジック
    - プロンプトエンジニアリング
    - API呼び出し・レスポンス処理

### Phase 3: 高度な機能・運用 (低優先度)

11. **LangGraph cron worker実装**
    - LangGraphノード構成 (FetchContext, CallLLM, PersistPlan)
    - cronスケジュール設定 (週間・日次)
    - バックグラウンドタスク実行

12. **PWA機能実装**
    - service worker設定
    - オフライン対応・キャッシュ戦略
    - Push通知機能
    - アプリインストール対応

13. **デプロイ・CI/CD構築**
    - Vercel (Next.js) デプロイ設定
    - Fly.io (FastAPI) デプロイ設定
    - GitHub Actions CI/CD
    - 環境変数・シークレット管理

## 実装完了済みの詳細

### API実装 (2025-06-22時点)

**実装済みファイル:**
- `apps/api/models.py` - SQLModel/Pydanticモデル定義
- `apps/api/services.py` - サービス層の業務ロジック
- `apps/api/routers/projects.py` - プロジェクトCRUD API
- `apps/api/routers/goals.py` - ゴールCRUD API
- `apps/api/routers/tasks.py` - タスクCRUD API
- `apps/api/exceptions.py` - カスタム例外・エラーハンドリング
- `apps/api/main.py` - FastAPIアプリケーション設定
- `apps/api/tests/test_api.py` - APIテストスイート

**実装済みAPI エンドポイント:**
```
GET    /api/projects/           - プロジェクト一覧取得
POST   /api/projects/           - プロジェクト作成
GET    /api/projects/{id}       - プロジェクト詳細取得
PUT    /api/projects/{id}       - プロジェクト更新
DELETE /api/projects/{id}       - プロジェクト削除

GET    /api/goals/project/{project_id} - プロジェクトのゴール一覧
POST   /api/goals/              - ゴール作成
GET    /api/goals/{id}          - ゴール詳細取得
PUT    /api/goals/{id}          - ゴール更新
DELETE /api/goals/{id}          - ゴール削除

GET    /api/tasks/goal/{goal_id}        - ゴールのタスク一覧
GET    /api/tasks/project/{project_id}  - プロジェクトの全タスク
POST   /api/tasks/              - タスク作成
GET    /api/tasks/{id}          - タスク詳細取得
PUT    /api/tasks/{id}          - タスク更新
DELETE /api/tasks/{id}          - タスク削除
```

**最新コミット:**
- `b7667ce` - feat: implement comprehensive CRUD APIs with service layer and validation

## 次に実装すべきタスク

### 🚧 **現在のタスク: プロジェクト一覧・作成画面**

**実装場所:**
- `apps/web/src/app/projects/page.tsx` - プロジェクト一覧ページ
- `apps/web/src/components/projects/` - プロジェクト関連コンポーネント

**実装すべき機能:**
1. プロジェクト一覧表示（shadcn/ui Table使用）
2. 新規プロジェクト作成フォーム（shadcn/ui Dialog + Form）
3. プロジェクト編集・削除機能
4. FastAPI CRUD APIとの統合
5. 認証チェック・リダイレクト機能
6. TypeScript型定義（API レスポンス型）

**参考にすべきコード:**
- 既存の認証ページ: `apps/web/src/app/login/page.tsx`
- Supabase接続: `apps/web/src/lib/supabase.ts`
- shadcn/uiコンポーネント使用例

**API URL:**
- バックエンドAPI: `http://localhost:8000/api/projects/`
- 認証ヘッダー: `Authorization: Bearer {token}`

### 次回作業開始時のコマンド

```bash
# プロジェクトルートで
cd /home/masato/git-repos/lifemanagement/TaskAgent

# 既存の進捗確認
cat plan.md

# フロントエンド開発サーバー起動
cd apps/web
pnpm dev

# 新しいターミナルでバックエンドも起動
cd apps/api
uv pip install -r requirements.txt
python main.py
```

## 今後の拡張アイデア

* Google Calendar incremental sync
* Notion DB 双方向同期
* Web Push & Expo iOS 通知
* Operator ベースの UI オートメーション
