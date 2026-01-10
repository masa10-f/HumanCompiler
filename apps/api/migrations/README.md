# Database Migrations

This directory contains SQL migration files for the HumanCompiler database schema.

## Migration Strategy

All database migrations are managed through SQL files and the MigrationManager. SQL migrations are automatically applied on application startup for staging and production environments.

### Available Migrations

- `001_initial_schema.sql` - Initial database schema with all base tables
- `002_add_user_settings_and_api_usage.sql` - Adds user settings and API usage tracking tables
- `003_add_performance_indexes.sql` - Performance optimization indexes
- `004_add_task_dependencies.sql` - Task dependency relationships
- `005_add_weekly_schedules.sql` - Weekly scheduling functionality
- `006_drop_api_usage_logs.sql` - Remove API usage logs table
- `007_add_work_sessions.sql` - Work sessions tracking
- `008_add_priority_column.sql` - Task priority column
- `009_add_project_status.sql` - Project status column
- `enable_rls_security.sql` - Row Level Security policies (manual application)

## Data Loss Prevention Policy

After the 2025-08-14 data loss incident, all production migrations must:
1. Create comprehensive backups before changes
2. Use transaction-based rollback capabilities
3. Include verification steps after completion
4. Provide detailed logging of all operations
5. Support resume functionality if interrupted

**NEVER use simple SQL migrations in production without safety features.**

## Running Migrations

### Using the Migration Manager (Recommended)

The project includes a migration manager that tracks applied migrations and ensures they're run in order:

```bash
# From the api directory
cd HumanCompiler/apps/api

# Check migration status
python migrate.py status

# Apply all pending migrations
python migrate.py apply

# Rollback a specific migration
python migrate.py rollback --version=003
```

### Manual Application

You can also apply migrations manually through:

1. **Supabase Dashboard**:
   - Go to SQL Editor in your Supabase project
   - Copy and paste the migration content
   - Execute the query

2. **Supabase CLI**:
   ```bash
   supabase db push
   ```

3. **Direct PostgreSQL connection**:
   ```bash
   psql -h <your-db-host> -U postgres -d postgres -f migrations/001_initial_schema.sql
   ```

## Migration Guidelines

1. **Naming Convention**:
   - Format: `XXX_description.sql` where XXX is a 3-digit sequential number
   - Rollback files: `XXX_description_rollback.sql`

2. **Content Structure**:
   ```sql
   -- Migration: Brief title
   -- Date: YYYY-MM-DD
   -- Description: Detailed description of changes

   -- Your SQL statements here
   ```

3. **Best Practices**:
   - Always include IF NOT EXISTS/IF EXISTS clauses for idempotency
   - Add comments to document complex changes
   - Include a corresponding rollback file for reversibility
   - Test migrations in development before production

## Notes

- Migrations are designed to be idempotent (safe to run multiple times)
- The migration manager tracks which migrations have been applied
- Always backup your database before running migrations in production
- Test migrations in a development environment first

## Supabase 本番環境セットアップ

### 1. Supabase プロジェクト作成
1. [Supabase Dashboard](https://supabase.com/dashboard) でプロジェクト作成
2. 地域: `Northeast Asia (Tokyo)` を選択
3. プロジェクト名: `humancompiler-production`

### 2. データベーススキーマの適用

#### オプション A: SQL Editor を使用
1. Supabase Dashboard → SQL Editor
2. `001_initial_schema.sql` の内容をコピー＆ペースト
3. "RUN" ボタンをクリック

#### オプション B: Supabase CLI を使用
```bash
# Supabase CLI インストール
npm install -g supabase

# プロジェクトにリンク
supabase link --project-ref your-project-ref

# マイグレーション実行
supabase db push
```

### 3. 認証設定
1. Authentication → Settings
2. Email confirmation: 無効化 (開発用)
3. Email templates: カスタマイズ (オプション)

### 4. API キーの取得
1. Settings → API
2. 以下をコピー:
   - Project URL
   - anon public key
   - service_role secret key (注意: 本番環境でのみ使用)

### 5. Database URL の取得
1. Settings → Database
2. Connection string をコピー
3. パスワードを実際のパスワードに置換

### 6. セキュリティ設定の確認
- [ ] Row Level Security (RLS) が有効
- [ ] 適切なポリシーが設定済み
- [ ] service_role key が安全に管理されている

## トラブルシューティング

### マイグレーションエラー
```sql
-- エラーが発生した場合、テーブルを削除して再実行
DROP TABLE IF EXISTS logs, schedules, tasks, goals, projects, users CASCADE;
```

### RLS ポリシーエラー
```sql
-- ポリシーを削除して再作成
DROP POLICY IF EXISTS "policy_name" ON table_name;
```

### インデックスエラー
```sql
-- インデックスを削除して再作成
DROP INDEX IF EXISTS index_name;
```
