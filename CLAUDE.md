# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
プロンプトに対する返答は必ず日本語で答えてください。
機能単位の変更に対してgit commitを行うようにしてください。git pushは行わないでください。

## プロジェクト概要

研究・開発プロジェクトを「大目標 → 週 → 日 → 実績」の4階層で管理し、LLMと制約ソルバによる自動スケジューリング・進捗可視化・リスケジューリングを行うタスク管理ウェブアプリケーション。

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
pnpm --filter web dev    # Next.js フロントエンド
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

## 主要API

### POST `/api/tasks`
タスク作成 (title, goalId, estimateHours)

### POST `/api/schedule/daily`
日次スケジュール生成 - OR-Tools制約ソルバによる最適化

処理フロー: Next.js → FastAPI → OR-Tools → LLM説明生成 → JSONレスポンス

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
- `OPENAI_API_KEY`
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`  
- `DATABASE_URL`

## 特記事項

- OR-Toolsによる制約充足問題として最適スケジューリング実装
- OpenAI Function Callingによる自然言語からの計画生成
- Supabase + pgvectorによるベクトル検索対応
- PWA対応でオフライン機能あり