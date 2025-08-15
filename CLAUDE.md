# CLAUDE.md

プロンプトへの返答は日本語でお願いします。
TaskAgentがgit repositoryです。
pythonは仮想環境 .venv/bin/ を使用してください。
コード中のコメント、コミットメッセージ、issue, PRの記述は英語でお願いします。
コードの実装面で問題だと思うことがあればissueとして切り出してください。
データベースに登録されているデータを初期化するような操作は行わないでください。
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
- ✅ **Row Level Security (RLS)**: 全テーブルでユーザーレベルアクセス制御
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

## データベースマイグレーション戦略

**⚠️ 重要**: 2025年8月14日にWorkType機能実装時にデータ消失事故が発生しました。今後は以下の安全なマイグレーション手順を必須とします。

### 安全なマイグレーション手順

#### 1. **事前バックアップ（必須）**
```python
from taskagent_api.safe_migration import DataBackupManager

# 必ずマイグレーション前にバックアップを作成
backup_manager = DataBackupManager()
backup_path = backup_manager.create_backup("pre_migration_backup")
print(f"Backup created: {backup_path}")
```

#### 2. **テーブル構造変更の禁止事項**
以下の操作は**絶対に実行しないこと**：
- `SQLModel.metadata.drop_all(engine)` - 全テーブル削除
- `DROP TABLE` - テーブル削除
- `TRUNCATE TABLE` - データ削除
- 本番環境での直接SQL実行

#### 3. **安全な変更方法**

##### **新しいカラム追加**
```python
from taskagent_api.safe_migration import AddColumnMigration

# 安全にカラムを追加
migration = AddColumnMigration(
    table_name="tasks",
    column_definition="new_column VARCHAR(255) DEFAULT 'default_value'"
)
backup_path = migration.execute_safe_migration("add_new_column")
```

##### **Enum値の変更**
```python
from taskagent_api.safe_migration import EnumMigration

# 安全にEnum値を変更
migration = EnumMigration(
    enum_name="worktype",
    old_values=["light_work", "study", "focused_work"],
    new_values=["light_work", "study", "focused_work", "meeting"]
)
backup_path = migration.execute_safe_migration("update_work_type_enum")
```

#### 4. **マイグレーション実行コマンド**
```bash
# 開発環境での安全なマイグレーション
PYTHONPATH=src python -c "
from taskagent_api.safe_migration import SafeMigrationManager
migration = SafeMigrationManager()
migration.execute_safe_migration('migration_name')
"

# バックアップの復旧（緊急時）
PYTHONPATH=src python -c "
from taskagent_api.safe_migration import DataBackupManager
manager = DataBackupManager()
manager.restore_backup('backups/backup_20250814_120000.json')
"
```

#### 5. **マイグレーション検証手順**
1. **ローカルテスト**: 必ずローカル環境で先にテスト
2. **バックアップ確認**: バックアップファイルの内容を確認
3. **ロールバックテスト**: 復旧手順をテスト実行
4. **段階的実行**: 本番環境では段階的に実行

#### 6. **緊急時の対応**
データ消失が発生した場合：
```bash
# 1. 最新バックアップを確認
ls -la backups/

# 2. バックアップから復旧
PYTHONPATH=src python -c "
from taskagent_api.safe_migration import DataBackupManager
manager = DataBackupManager()
manager.restore_backup('backups/最新のバックアップファイル.json')
"

# 3. データ整合性チェック
PYTHONPATH=src python -c "
from taskagent_api.database import db
from sqlmodel import Session, select, text
from taskagent_api.models import User, Project, Goal, Task

engine = db.get_engine()
with Session(engine) as session:
    users = len(session.exec(select(User)).all())
    projects = len(session.exec(select(Project)).all())
    goals = len(session.exec(select(Goal)).all())
    tasks = len(session.exec(select(Task)).all())
    print(f'Data check - Users: {users}, Projects: {projects}, Goals: {goals}, Tasks: {tasks}')
"
```

### スキーマ変更時のチェックリスト

- [ ] 事前バックアップ作成済み
- [ ] ローカル環境でテスト済み
- [ ] ロールバック手順確認済み
- [ ] 本番データへの影響評価済み
- [ ] チーム内でレビュー済み

### 自動バックアップ設定

マイグレーション実行時に自動バックアップを作成する設定：
```python
# apps/api/src/taskagent_api/database.py に追加
import atexit
from taskagent_api.safe_migration import DataBackupManager

# アプリ終了時に自動バックアップ
backup_manager = DataBackupManager()
atexit.register(lambda: backup_manager.create_backup("auto_shutdown_backup"))
```

## Row Level Security (RLS) セキュリティ対策

**⚠️ 重要**: TaskAgentではSupabaseデータベースのRow Level Security (RLS)を有効化し、ユーザーデータの安全性を確保しています。

### RLSセキュリティルール

#### 1. **新しいテーブル作成時の必須対応**
新しいテーブルを作成する場合、以下の手順を**必ず**実行してください：

```sql
-- 1. テーブル作成後、直ちにRLSを有効化
ALTER TABLE public.新しいテーブル名 ENABLE ROW LEVEL SECURITY;

-- 2. 適切なアクセスポリシーを作成
CREATE POLICY "テーブル名_user_access" ON public.新しいテーブル名
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)  -- ユーザー自身のデータのみアクセス可能
    WITH CHECK (auth.uid()::text = user_id::text);

-- 3. 必要な権限を付与
GRANT SELECT, INSERT, UPDATE, DELETE ON public.新しいテーブル名 TO authenticated;
```

#### 2. **RLSポリシー設計パターン**

**ユーザー所有データ（直接所有）:**
```sql
-- users, schedules, user_settings, api_usage_logs等
USING (auth.uid()::text = user_id::text)
```

**プロジェクト階層データ（間接所有）:**
```sql
-- goals, tasks, logs等
USING (
    EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = 関連プロジェクトID
        AND auth.uid()::text = p.owner_id::text
    )
)
```

**依存関係データ（両方のデータが所有者のもの）:**
```sql
-- goal_dependencies, task_dependencies等
USING (
    EXISTS (SELECT 1 FROM public.goals g JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = goal_id AND auth.uid()::text = p.owner_id::text)
    AND
    EXISTS (SELECT 1 FROM public.goals g JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = depends_on_goal_id AND auth.uid()::text = p.owner_id::text)
)
```

#### 3. **RLS実装チェックリスト**

新しいテーブル作成時：
- [ ] RLS有効化 (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- [ ] 適切なポリシー作成 (`CREATE POLICY`)
- [ ] 権限付与 (`GRANT ... TO authenticated`)
- [ ] ポリシーテスト実行（異なるユーザーでアクセステスト）
- [ ] セキュリティ監査（外部からのアクセステスト）

#### 4. **RLS検証コマンド**

```bash
# RLS有効状況確認
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

# ポリシー一覧確認
SELECT schemaname, tablename, policyname, permissive, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;
```

#### 5. **セキュリティ违反の防止**

以下の操作は**絶対に実行しないこと**：
- RLSを無効化する操作 (`ALTER TABLE ... DISABLE ROW LEVEL SECURITY`)
- 過度に広いアクセス権限の付与 (`TO public`)
- ポリシーなしでのテーブル公開
- セキュリティバイパス可能な条件の記述

#### 6. **既存RLS実装状況（2025年8月対応済み）**

全12テーブルでRLS有効化・ポリシー設定完了：
- ✅ users, projects, goals, tasks
- ✅ schedules, weekly_schedules, weekly_recurring_tasks
- ✅ logs, user_settings, api_usage_logs
- ✅ goal_dependencies, task_dependencies

マイグレーションスクリプト: `apps/api/migrations/enable_rls_security.sql`
実行スクリプト: `apps/api/src/taskagent_api/enable_rls_migration.py`

## 開発時の注意事項

- プロンプトに対する返答は必ず日本語で行う
- 機能単位の変更に対してgit commitを実行 (git pushは不要)
- 既存ファイルの編集を優先し、新規ファイル作成は最小限に
- エラーハンドリング・ログ出力を適切に実装
- テストケースの作成・実行を忘れずに行う
- **データベース変更時は必ず上記のマイグレーション手順に従う**
- **新しいテーブル作成時は必ず上記のRLSセキュリティ対策を実装する**
