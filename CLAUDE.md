# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
プロンプトに対する返答は必ず日本語で答えてください。
機能単位の変更に対してgit commitを行うようにしてください。git pushは行わないでください。

## プロジェクト概要

**TaskAgent** - 研究・開発プロジェクトを「大目標 → 週 → 日 → 実績」の4階層で管理し、**OpenAI GPT-4** と **OR-Tools制約ソルバ** による自動スケジューリング・進捗可視化・リスケジューリングを行う **完全機能のAI駆動タスク管理ウェブアプリケーション**。

### 🚀 実装完了状況
- ✅ **Phase 1**: 基盤構築 (monorepo, Supabase, 認証)
- ✅ **Phase 2**: バックエンドAPI + AI統合 (FastAPI, OpenAI, OR-Tools)  
- ✅ **Phase 3**: フロントエンドCRUD UI (Next.js, shadcn/ui)
- ✅ **Phase 4**: AI機能UI + 制約最適化UI (完全実装)

## 技術スタック

### フロントエンド
- **Next.js 14 (App Router) / React 19**
- **TypeScript** (strict mode)
- TailwindCSS, shadcn/ui
- PWA (workbox)

### バックエンド
- **FastAPI (Python 3.13)** + Uvicorn
- LangGraph cron worker
- Pythonのカーネルは ../.venv/bin にあるカーネルを使用してください。

### データベース・インフラ
- Supabase Postgres + pgvector
- Vercel (frontend), Fly.io (API & worker)

### AI・スケジューリング
- OpenAI Assistants API (function calling)
- OR-Tools CP-SAT

## アーキテクチャ（monorepo構成）

```
repo-root/
├── apps/
│   ├── web/        # Next.js アプリ (TypeScript)
│   └── api/        # FastAPI サービス (Python)
├── packages/
│   ├── db/         # Prisma/SQLModel スキーマ & マイグレーション
│   └── scheduler/  # OR-Tools ラッパ (Python パッケージ)
└── .github/workflows/
```

## 開発コマンド

### セットアップ
```bash
pnpm i
cp .env.example .env
supabase start
```

### 開発サーバー起動
```bash
# フロントエンド (ターミナル1)
cd apps/web
npm run dev              # Next.js フロントエンド → http://localhost:3001

# バックエンド (ターミナル2)  
cd apps/api
python main.py          # FastAPI サーバー → http://localhost:8000
```

### デプロイ
```bash
vercel --prod           # フロントエンド (Vercel)
fly deploy             # API (Fly.io)
```

## データモデル

```
users(id, email, ...)
projects(id, owner_id, title, description)
goals(id, project_id, title, estimate_hours)
tasks(id, goal_id, title, estimate_hours, due, status)
schedules(id, user_id, date, plan_json)
logs(id, task_id, actual_minutes, comment, created_at)
```

## 主要API (実装完了済み)

### **CRUD APIs** 
```bash
# プロジェクト管理
GET/POST/PUT/DELETE /api/projects/

# ゴール管理  
GET/POST/PUT/DELETE /api/goals/
GET /api/goals/project/{project_id}

# タスク管理
GET/POST/PUT/DELETE /api/tasks/
GET /api/tasks/goal/{goal_id}
GET /api/tasks/project/{project_id}
```

### **AI機能APIs**
```bash
# AI週間計画生成
POST /api/ai/weekly-plan           # OpenAI GPT-4による計画生成
POST /api/ai/analyze-workload      # ワークロード分析
POST /api/ai/suggest-priorities    # タスク優先度提案
GET  /api/ai/weekly-plan/test      # AI統合テスト
```

### **制約最適化APIs**
```bash  
# OR-Toolsスケジューリング
POST /api/schedule/daily           # CP-SAT制約ソルバ最適化
GET  /api/schedule/test            # スケジューラテスト
```

処理フロー: Next.js UI → FastAPI → OR-Tools/OpenAI → JSONレスポンス → UI表示

## LLMオーケストレーション

LangGraph構成:
1. `FetchContextNode` - DBからゴール・実績取得
2. `CallLLMNode` - OpenAI Assistants API呼び出し
3. `PersistPlanNode` - 生成結果をschedules保存

cron実行: 毎週日曜07:00、毎朝08:30

## 開発規約

- **TypeScript**: strict mode, noUncheckedIndexedAccess有効
- **Linting**: ESLint + Prettier, Husky + lint-staged
- **Commit**: Conventional Commits (feat:, fix:, ...)
- **Validation**: zodスキーマ共有
- **Testing**: Jest (web), Pytest (API)

## 環境変数

必須シークレット:
- `OPENAI_API_KEY` - OpenAI Platform (https://platform.openai.com/) でキー取得
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase (https://supabase.com/) でプロジェクト作成
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase Settings > API で取得
- `DATABASE_URL` - Supabase Database接続文字列

**設定例:**
```bash
# .env ファイル
OPENAI_API_KEY=sk-proj-your-key-here
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
DATABASE_URL=postgresql://postgres:password@localhost:54322/postgres
```

## 特記事項

### **実装済み主要機能**
- ✅ **プロジェクト・ゴール・タスク管理** - 完全CRUD操作
- ✅ **AI週間計画生成** - OpenAI GPT-4による自動計画
- ✅ **ワークロード分析** - タスク量・締切・配分分析  
- ✅ **タスク優先度提案** - AI分析による優先度最適化
- ✅ **OR-Tools制約最適化** - CP-SAT制約ソルバスケジューリング
- ✅ **統合ナビゲーション** - レスポンシブUI・shadcn/ui

### **技術的特徴**
- OR-Toolsによる制約充足問題として最適スケジューリング実装
- OpenAI Function Callingによる自然言語からの計画生成  
- Supabase認証統合による安全なデータ管理
- TypeScript strict modeによる型安全性確保
- Next.js App Router + shadcn/uiによる現代的なUI

### **アクセスURL**
- フロントエンド: http://localhost:3001
- バックエンドAPI: http://localhost:8000  
- API ドキュメント: http://localhost:8000/docs