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

### Phase 2: コア機能開発 ✅ **完了**

6. **基本CRUD API実装** ✅ **完了**
   - SQLModel/Pydanticモデル定義 (User, Project, Goal, Task, Schedule, Log)
   - FastAPI エンドポイント実装 (projects, goals, tasks の全CRUD操作)
   - バリデーション・エラーハンドリング (カスタム例外クラス)
   - 所有権ベースのアクセス制御実装
   - サービス層による業務ロジック分離
   - 包括的なテストスイート (8個のテストが通過)

7. **OR-Toolsスケジューラパッケージ** ✅ **完了**
   - packages/scheduler Python パッケージ実装
   - 制約充足問題定義・実装 (CP-SAT solver)
   - タスク割り当て最適化ロジック
   - API用ラッパー関数 (optimize_schedule)
   - タスク種別とスロット種別のマッピング

8. **スケジューリングAPI実装** ✅ **完了**
   - POST /api/schedule/daily エンドポイント実装
   - 利用可能時間スロット入力処理
   - OR-Tools CP-SAT ソルバー呼び出し
   - 最適化結果JSON返却
   - 包括的なテストスイート (12個のテストが通過)

9. **OpenAI Assistants API統合** ✅ **完了**
   - OpenAI関数定義 (create_week_plan, update_plan)
   - 週間計画生成ロジック実装
   - 研究開発特化のプロンプトエンジニアリング
   - AI計画エンドポイント (weekly-plan, analyze-workload, suggest-priorities)
   - エラーハンドリングと適切なフォールバック

### Phase 3: フロントエンド開発 ✅ **完了**

10. **タスク・ゴール管理UI** ✅ **完了**
    - ✅ プロジェクト一覧・作成画面
    - ✅ ゴール管理画面
    - ✅ タスク作成・編集・削除機能
    - ✅ shadcn/ui Table、Dialog、Form使用
    - ✅ FastAPI CRUD APIとの統合

### Phase 4: 高度な機能・運用 (低優先度)

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

### Phase 2完了: コア機能開発 (2025-06-23時点)

#### **1. 基本CRUD API実装** ✅
**実装済みファイル:**
- `apps/api/models.py` - SQLModel/Pydanticモデル定義
- `apps/api/services.py` - サービス層の業務ロジック
- `apps/api/routers/projects.py` - プロジェクトCRUD API
- `apps/api/routers/goals.py` - ゴールCRUD API
- `apps/api/routers/tasks.py` - タスクCRUD API
- `apps/api/exceptions.py` - カスタム例外・エラーハンドリング
- `apps/api/main.py` - FastAPIアプリケーション設定
- `apps/api/tests/test_api.py` - APIテストスイート

#### **2. OR-Toolsスケジューラパッケージ** ✅
**実装済みファイル:**
- `packages/scheduler/` - 独立したPythonパッケージ
- `packages/scheduler/scheduler/core.py` - CP-SATソルバー実装
- `packages/scheduler/scheduler/models.py` - タスク・スロットモデル
- `packages/scheduler/scheduler/api.py` - APIラッパー関数

#### **3. スケジューリングAPI実装** ✅
**実装済みファイル:**
- `apps/api/routers/scheduler.py` - スケジューリングエンドポイント
- `apps/api/tests/test_scheduler.py` - スケジューラテストスイート (12テスト)

#### **4. OpenAI Assistants API統合** ✅
**実装済みファイル:**
- `apps/api/ai_service.py` - OpenAI統合サービス
- `apps/api/routers/ai_planning.py` - AI計画エンドポイント

**実装済みAPI エンドポイント:**
```
# CRUD APIs
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

# スケジューリングAPIs
GET    /api/schedule/test       - スケジューラテストエンドポイント
POST   /api/schedule/daily      - 日次スケジュール最適化

# AI計画APIs
GET    /api/ai/weekly-plan/test - OpenAI統合テストエンドポイント
POST   /api/ai/weekly-plan      - AI週間計画生成
POST   /api/ai/analyze-workload - ワークロード分析
POST   /api/ai/suggest-priorities - タスク優先度提案
```

**最新コミット:**
- `56f108e` - feat: implement OpenAI Assistants API integration for weekly planning

## 次に実装すべきタスク

### 🚧 **Phase 4: 高度な機能・運用**

#### **1. AI週間計画機能のUI実装** ← **次の実装タスク**

**実装場所:**
- `apps/web/src/app/ai-planning/page.tsx` - AI計画ページ
- `apps/web/src/components/ai-planning/` - AI計画関連コンポーネント

**実装すべき機能:**
1. 週間計画生成フォーム
2. 生成された計画の表示
3. ワークロード分析結果の可視化
4. タスク優先度提案の表示
5. 計画の調整・再生成機能

#### **2. スケジューリング結果表示UI**
- OR-Toolsによる最適化結果の可視化
- カレンダー形式での計画表示
- スケジュール調整機能

#### **3. LangGraph cron worker実装**
- バックグラウンドでの自動計画生成
- 定期的な進捗チェック・リスケジューリング

### 次回作業開始時のコマンド

```bash
# プロジェクトルートで
cd /home/masato/git-repos/lifemanagement/TaskAgent

# 既存の進捗確認
cat plan.md

# 環境設定確認（必要に応じて.envファイル編集）
# OpenAI API keyを設定: OPENAI_API_KEY=your_actual_key

# フロントエンド開発サーバー起動
cd apps/web
pnpm dev

# 新しいターミナルでバックエンドも起動
cd apps/api
pip install -r requirements.txt  # scheduler パッケージも含む
python main.py
```

### 🎯 **Phase 2-3 完了の成果**

✅ **フル機能のAI駆動タスク管理ウェブアプリケーション**を構築:

**Phase 2 (バックエンド):**
- **OR-Tools制約ソルバー**による最適スケジューリング
- **OpenAI GPT-4**による自然言語週間計画生成
- **包括的なCRUD API**（20以上のエンドポイント）
- **堅牢なテストスイート**（20以上のテスト）
- **研究開発プロジェクト**に特化した設計

**Phase 3 (フロントエンド):**
- **Next.js 14 + shadcn/ui**による現代的なUI
- **プロジェクト・ゴール・タスク**の完全CRUD機能
- **Supabase認証**との統合
- **レスポンシブデザイン**でモバイル対応
- **TypeScript型安全性**の完全実装

## 今後の拡張アイデア

* Google Calendar incremental sync
* Notion DB 双方向同期
* Web Push & Expo iOS 通知
* Operator ベースの UI オートメーション
