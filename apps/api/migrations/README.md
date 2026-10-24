# Database Migrations

This directory contains SQL migration files for the HumanCompiler database schema.

## Migration Strategy

All database migrations are managed through SQL files and the MigrationManager. **Only numbered migrations** (`NNN_*.sql` format, e.g., `001_initial_schema.sql`) are automatically applied on application startup for staging and production environments. Non-numbered migrations (like `enable_rls_security.sql`) require manual application.

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
- `022_add_capacity_triage.sql` - Capacity settings and task triage review runs
- `026_add_goal_due_date.sql` - Optional due dates for goals
- `027_add_daily_plan_documents.sql` - Versioned daily plan documents and ownership RLS
- `028_scope_daily_plan_policy.sql` - Limit the daily plan RLS policy to `authenticated`; also required when 027 has already been applied. Changes no document data or ownership predicates.
- `029_add_daily_plan_search.sql` - Add visible-text search for daily notebooks, backfill existing notes, and keep older writers in sync with a trigger. Apply before the new API; rollback preserves document data.
- `030_trim_daily_plan_search.sql` - Normalize leading/trailing Unicode whitespace in notebook search text, including tabs and Japanese spaces. Rebuilds the index text for existing 029 installations; note content is unchanged.
- `031_drop_slot_templates.sql` - Drop the unused `slot_templates` table. Deploy the API that no longer serves slot templates first. Stored templates are deleted, so back up the table beforehand if they should be kept; the rollback recreates an empty table.
- `032_add_daily_plan_line_note_search.sql` - Include memos written under schedule lines (`note` on timed lines and /schedule lines) in notebook search text, and rebuild search text for existing notes. Note content is unchanged; rollback restores the 030 search rules.
- `033_drop_weekly_planning.sql` - Drop the unused `weekly_schedules` and `weekly_recurring_tasks` tables and the `taskcategory` enum type. Deploy the API that no longer serves weekly plans first. Saved weekly plans and weekly recurring tasks are deleted, so back up both tables beforehand if they should be kept; the rollback recreates empty tables. Weekly work reports read work logs and are unaffected.
- `034_add_project_paused_status.sql` - Allow the `paused` project status. On the documented schema `projects.status` is a plain VARCHAR(20) that already accepts the value. On schemas created by the ORM, where the column is a native enum type, the column is converted to `VARCHAR(20) DEFAULT 'pending' NOT NULL` (the stored text is unchanged and the enum type is dropped once unused); a CHECK constraint that rejects `paused` is recreated with the value included. On Supabase-shaped databases (where the `authenticated` role and `auth.uid()` exist) RLS on `projects` is re-enabled and the owner-only policy is recreated only if the table has no policy; plain PostgreSQL databases skip that step. Apply before deploying the API that offers the status; the rollback moves paused projects back to `in_progress` and must run before rolling back the API.
- `035_add_agent_tokens.sql` - Create `agent_tokens` (scoped agent tokens; the token hash is not readable by `authenticated`) and copy every `hook_tokens` row into it, including revoked ones, with the `quick_tasks:write` scope. Add `logs.updated_at` (backfilled from `created_at`, then `DEFAULT NOW()` and NOT NULL), `updated_at` triggers on `logs`, `quick_tasks`, `context_notes` and `daily_plan_documents`, and `(updated_at, id)` indexes on the tables the agent API lists. Additive and compatible with the previously deployed API, and safe to apply twice. **Do not create or revoke tokens between applying the migration and finishing the deploy**: the old API still writes `hook_tokens`, and those changes are not copied. The rollback writes revocations made in `agent_tokens` back to `hook_tokens` and keeps `logs.updated_at`, but tokens created after the migration stop working and must be recreated with the old API.
- `036_derive_goal_estimates.sql` - Drop NOT NULL from `goals.estimate_hours`. The API now computes a goal's estimate on every read as the sum of its non-cancelled task estimates and stops writing the column, which is kept unused so rollback stays possible. A no-op on schemas created by 001 (the column is already nullable); no data is changed. Apply before deploying the API that computes goal estimates; the rollback fills the goals created in the meantime with their task total (or 1 hour) and must run before rolling back the API.
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
