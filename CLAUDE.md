# CLAUDE.md

プロンプトへの返答は日本語でお願いします。
TaskAgentがgit repositoryです。
pythonは仮想環境 .venv/bin/ を使用してください。
コード中のコメント、コミットメッセージ、issue, PRの記述は英語でお願いします。
コードの実装面で問題だと思うことがあればissueとして切り出してください。
This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

**TaskAgent** - 研究・開発プロジェクトを「プロジェクト → ゴール → タスク → 実績」の4階層で管理し、**OpenAI GPT-4** と **OR-Tools制約ソルバ** による自動スケジューリング・進捗可視化・リスケジューリングを行う **AI駆動タスク管理ウェブアプリケーション**。

### 技術スタック
- **フロントエンド**: Next.js 14 (App Router), React 18, TypeScript (strict), TailwindCSS, shadcn/ui
- **バックエンド**: FastAPI (Python 3.11+), Uvicorn
- **データベース**: Supabase Postgres
- **AI・最適化**: OpenAI GPT-4 (Assistants API), OR-Tools CP-SAT制約ソルバ
- **デプロイ**: Vercel (フロントエンド), Fly.io (バックエンド)

### アーキテクチャ（monorepo構成）
```
TaskAgent/
├── apps/
│   ├── web/        # Next.js アプリ (TypeScript)
│   └── api/        # FastAPI サービス (Python)
├── packages/       # 共通パッケージ (未使用)
├── pnpm-workspace.yaml
└── .venv/          # Python仮想環境
```

## 開発コマンド

### セットアップ
```bash
# 依存関係のインストール
pnpm i

# Python仮想環境のセットアップ
cd apps/api
source ../../.venv/bin/activate
# 仮想環境がない場合: python -m venv ../../.venv
uv pip install -r requirements.txt
```

### 開発サーバー起動
```bash
# フロントエンド (ターミナル1)
cd apps/web
npm run dev              # Next.js → http://localhost:3000

# バックエンド (ターミナル2)
cd apps/api
source ../../.venv/bin/activate
python src/taskagent_api/main.py  # FastAPI → http://localhost:8000
```

### ビルド
```bash
# フロントエンド
cd apps/web
pnpm run build           # Next.js ビルド (出力: .next/)
pnpm install             # 依存関係インストール (Vercel設定)
```

### テスト & リンティング
```bash
# フロントエンド
cd apps/web
npm run type-check      # TypeScript型チェック
npm run lint            # ESLint

# バックエンド
cd apps/api
source ../../.venv/bin/activate
PYTHONPATH=src python -m pytest tests/ -v
ruff check .            # リンティング
ruff format .           # フォーマット
mypy src                # 型チェック
```

## データモデル

```sql
users(id, email, created_at, updated_at)
projects(id, owner_id, title, description, created_at, updated_at)
goals(id, project_id, title, description, estimate_hours, created_at, updated_at)
tasks(id, goal_id, title, description, estimate_hours, due_date, status, created_at, updated_at)
schedules(id, user_id, date, plan_json, created_at, updated_at)
logs(id, task_id, actual_minutes, comment, created_at)
user_settings(id, user_id, openai_api_key_encrypted, openai_model, ai_features_enabled)
api_usage_logs(id, user_id, endpoint, tokens_used, cost_usd, response_status, request_timestamp)
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

# ユーザー設定
GET/POST/PUT /api/user-settings/
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

### **監視・ヘルスチェック**
```bash
GET /health                        # アプリケーションヘルスチェック
GET /api/monitoring/health         # 詳細ヘルスチェック
GET /api/monitoring/metrics        # パフォーマンスメトリクス
```

処理フロー: Next.js UI → FastAPI → OR-Tools/OpenAI → JSONレスポンス → UI表示

完全なAPIドキュメント: http://localhost:8000/docs

## 実装完了機能
- ✅ **プロジェクト・ゴール・タスク管理** - 完全CRUD操作
- ✅ **AI週間計画生成** - OpenAI GPT-4による自動計画
- ✅ **ワークロード分析** - タスク量・締切・配分分析
- ✅ **タスク優先度提案** - AI分析による優先度最適化
- ✅ **OR-Tools制約最適化** - CP-SAT制約ソルバスケジューリング
- ✅ **統合ナビゲーション** - レスポンシブUI・shadcn/ui

## AI機能の技術的詳細

### OpenAI統合
- **GPT-4 Assistants API** (function calling)
- **プランニングサービス**: `apps/api/src/taskagent_api/ai/planning_service.py`
- **ワークロード分析**: タスク量・締切・配分の自動分析
- **優先度提案**: AI分析による最適な優先順位決定

### OR-Tools制約最適化
- **CP-SAT制約ソルバ** による最適スケジューリング
- **制約条件**: 工数・締切・優先度・リソース制限
- **最適化目標**: 期日遵守・工数効率・優先度考慮

## デプロイ・CI/CD

### 自動デプロイ
- **フロントエンド**: Vercel (GitHub連携)
  - Build Command: `pnpm run build`
  - Output Directory: `.next`
  - Install Command: `pnpm install`
  - Development Command: `npm run dev`
  - mainブランチ → 本番環境 (https://taskagent-web.vercel.app/)
  - Pull Request → プレビュー環境
- **バックエンド**: Fly.io
  - Production: `taskagent-api-masa` (https://taskagent-api-masa.fly.dev/)
  - Preview: `taskagent-api-masa-preview`

### 手動デプロイ (必要時のみ)
```bash
# バックエンドのみ
cd apps/api
~/.fly/bin/flyctl deploy --remote-only
```

**注意**: mainブランチ・各Pull requestでpushするごとに自動デプロイが実行されます。ローカルでのデプロイは不要です。

## 開発規約

- **TypeScript**: strict mode, noUncheckedIndexedAccess有効
- **リンティング**: ESLint (フロントエンド), Ruff (バックエンド)
- **フォーマット**: Prettier (フロントエンド), Ruff (バックエンド)
- **型チェック**: TypeScript (フロントエンド), mypy (バックエンド)
- **テスト**: Jest/Vitest (フロントエンド), Pytest (バックエンド)
- **コミット**: Conventional Commits (feat:, fix:, ...)
- **バリデーション**: Zod (フロントエンド), Pydantic (バックエンド)

## 環境変数

### 必須シークレット
```bash
# OpenAI
OPENAI_API_KEY=sk-proj-your-key-here

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIs...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
DATABASE_URL=postgresql://postgres:password@db.supabase.co:5432/postgres

# FastAPI設定
ENVIRONMENT=development
HOST=localhost
PORT=8000
DEBUG=true
```

### Fly.io Secrets
```bash
# 本番環境用 (fly secrets set で設定)
fly secrets set DATABASE_URL=postgresql://...
fly secrets set OPENAI_API_KEY=sk-proj-...
fly secrets set SUPABASE_URL=https://...
fly secrets set SUPABASE_SERVICE_ROLE_KEY=eyJh...
```

## アクセスURL

### 開発環境
- **フロントエンド**: http://localhost:3000
- **バックエンドAPI**: http://localhost:8000
- **API ドキュメント**: http://localhost:8000/docs
- **OpenAPI仕様書**: http://localhost:8000/openapi.json

### 本番環境
- **フロントエンド**: https://taskagent-web.vercel.app/
- **バックエンドAPI**: https://taskagent-api-masa.fly.dev/
- **API ドキュメント**: https://taskagent-api-masa.fly.dev/docs

## セキュリティ機能

- ✅ **認証**: Supabase Auth統合
- ✅ **HTTPS**: 本番環境で強制
- ✅ **CORS設定**: 適切なオリジン制限
- ✅ **レート制限**: API呼び出し制限
- ✅ **暗号化**: OpenAI APIキーの安全な保存
- ✅ **セキュリティヘッダー**: CSP, XSS保護, フレーム拒否
- ✅ **入力検証**: Pydantic/Zodによる厳密なバリデーション

## パフォーマンス最適化

- ✅ **キャッシュ**: AI分析結果のキャッシング
- ✅ **データベースインデックス**: 高速クエリ対応
- ✅ **バンドル最適化**: Next.js 14最適化
- ✅ **メモリ効率**: SQLModel + FastAPIの効率的なORM
- ✅ **監視**: パフォーマンスメトリクス収集

## 開発時の注意事項

- プロンプトに対する返答は必ず日本語で行う
- 機能単位の変更に対してgit commitを実行 (git pushは不要)
- 既存ファイルの編集を優先し、新規ファイル作成は最小限に
- エラーハンドリング・ログ出力を適切に実装
- テストケースの作成・実行を忘れずに行う
