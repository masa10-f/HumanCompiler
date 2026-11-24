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
- `037_add_agent_audit_logs.sql` - Create `agent_audit_logs` (one row per Agent Gateway request: token, route template, scope, status, duration, client IP; no bodies or query values). Rows are deleted with the user; deleting a token keeps its rows with `token_id` set to NULL. `authenticated` can read only its own rows, and only through the granted columns. Additive and compatible with the previously deployed API, and safe to apply twice. Requires 035. The rollback drops the table and its rows: run it after rolling back to the API without audit logs, and before the 035 rollback (the table references `agent_tokens`).
- `038_drop_hook_tokens.sql` - Drop `hook_tokens`. 035 already copied its rows into `agent_tokens`, and no code reads it since PR4b, so apply this after the PR4b API is deployed. It stops with an error if `agent_tokens` is missing, has no `CASCADE` (a dependent view or foreign key makes it fail), and is safe to apply twice. **There is no rollback**: take a backup first if you want to keep the rows. After 038 the 035 rollback no longer works either (its first `UPDATE public.hook_tokens` fails). Before applying, run these pre-checks. (1) Tokens that were never copied: `SELECT count(*) FROM public.hook_tokens h WHERE NOT EXISTS (SELECT 1 FROM public.agent_tokens a WHERE a.id = h.id);`. A non-zero count means those rows were created by the old API after 035; the PR1+ code cannot use them, so dropping them does not affect any working hook. (2) Revocations that exist only in `hook_tokens`: `SELECT count(*) FROM public.hook_tokens h JOIN public.agent_tokens a ON a.id = h.id WHERE h.revoked_at IS NOT NULL AND a.revoked_at IS NULL;`. A non-zero count means a user revoked a token through the old API after 035 ran, and its `agent_tokens` copy is still active. Run this first, or 038 destroys the only record of the revocation: `UPDATE public.agent_tokens a SET revoked_at = h.revoked_at FROM public.hook_tokens h WHERE a.id = h.id AND h.revoked_at IS NOT NULL AND a.revoked_at IS NULL;`. (3) If you use `migrate.py`, `SELECT 1 FROM schema_migrations WHERE version = '035_add_agent_tokens';` must return a row. Otherwise record 035 before applying 038, or `migrate.py apply` stops at 035, which can no longer run once `hook_tokens` is gone. Dropping the foreign key to `users` briefly takes an `ACCESS EXCLUSIVE` lock on `public.users`: run `SET lock_timeout = '5s';` before applying, and retry if it times out.
- `039_add_agent_proposals.sql` - Create `agent_proposals`, the inbox of changes that agents propose through the Agent Gateway and the user accepts, edits or rejects. `payload` keeps what the agent sent, unchanged; `final_payload` holds the payload used at accept (the edited one if the user edited it); it is set on every accept and stays NULL while pending and on reject. `agent_name` is a copy of the sending token's name at intake, which the user chose; the agent does not supply it. Rows are deleted with the user; deleting a token keeps its proposals with `token_id` set to NULL. `authenticated` can read only its own rows. Additive and compatible with the previously deployed API, and safe to apply twice. Requires 035 (`agent_tokens`). The rollback drops the table and every proposal in it, pending and decided; entities already created from accepted proposals are kept. Apply it to production by hand before merging the PR that uses it.
- `041_add_agent_log_changes.sql` - Allow `log` in `agent_changes.entity_type`, so work logs (time records) written by agents with the `logs:write` scope are kept in the change history. Additive and compatible with the previously deployed API, and safe to apply twice. Requires 040 (`agent_changes`). The rollback deletes the `log` change rows (the work logs themselves are kept) and restores the four entity types of 040; run it after rolling back to the API without agent log writes.
- `042_add_weekly_rhythm.sql` - Create `weekly_rhythm_blocks`, the weekday template that daily notes start from (/schedule lines with an optional project and work type, fixed events and breaks; `weekday` 0 = Monday ... 6 = Sunday). Deleting a project keeps its blocks with `project_id` set to NULL; deleting a user deletes them. `authenticated` can read and write only its own rows. Additive and compatible with the previously deployed API, and safe to apply twice. Apply before deploying the API that serves `/api/weekly-rhythm`. The rollback drops the table and every template; daily notes started from a template keep their own copy of the lines.
- `043_add_weekly_notes.sql` - Create `weekly_notes`, one free-form note per user and week (seven days from `week_start`), and add `user_settings.week_start_day`, the weekday new weeks start on (`sunday` by default, or `monday` ... `saturday`). The API creates a note on the first day of a week under the user's setting; notes keep their days when the setting changes, so `week_start` is not limited to one weekday. `content` is the web editor's HTML, `''` for an empty note. Deleting a user deletes their notes. `authenticated` can read and write only its own rows. Additive and compatible with the previously deployed API, and safe to apply twice. Apply before deploying the API that serves `/api/weekly-notes`. The rollback drops the table, every weekly note and the `week_start_day` column: back up `weekly_notes` first if the notes should be kept.
- `044_merge_task_text_into_notes.sql` - Make a task's note its body. Adds `context_notes.content_text` (the note's visible text, which the API rebuilds on every note write and uses for task search and list excerpts) and fills it for existing notes without changing their `updated_at`. Copies each task's `description` and `memo` to the top of the task's note (description first, then the memo under a bold "メモ" line, then the existing note; a note stored as Markdown becomes HTML paragraphs of the same text), creating the note when the task has none; `tasks.note_merged_at` records the copy, so applying the migration again copies nothing twice. Nothing is deleted: `tasks.description` and `tasks.memo` keep their values and are dropped by a later migration. **Apply before deploying the API that reads notes** (that API selects `content_text`, so it fails without the column), and do not edit task descriptions or memos between applying and deploying: for a task already merged, text written through the old API in between is not copied again. Tasks created in between are copied by applying the migration once more. Safe to apply twice. The rollback drops the two new columns and keeps descriptions, memos and notes; the notes keep the copied text, and tasks created after 044 have their text only in the note.
- `045_link_logs_to_work_sessions.sql` - Link a Runner session to its time log. Adds `logs.work_session_id` (nullable, `ON DELETE SET NULL`, one log per session through a partial unique index), the session a log was measured in; logs entered by hand, in the daily note or by an agent keep it NULL. A Runner checkout and a task switch have always written both a `work_sessions` row and a `logs` row for the same work, unlinked, so a task's work records listed it twice. Existing rows are paired by task and time: a log whose `created_at` is within 10 seconds of the session's `ended_at`, and only when the two are each other's closest match, so nothing is linked twice. No row is deleted and no time or comment is changed; linked logs get a new `updated_at`. Additive and compatible with the previously deployed API, and safe to apply twice. **Apply before deploying the API that reads `logs.work_session_id`** (that API selects the column, so log reads fail without it). The rollback drops the index, the foreign key and the column; logs and sessions are kept.
- `046_add_note_attachments.sql` - Create `note_attachments`, one row per image attached to the note of a project, goal or task. The image itself (a WebP preview and a thumbnail; the original is never stored) is in the private Supabase Storage bucket `note-attachments` (`ATTACHMENTS_BUCKET`), which must be **created by hand in the Supabase dashboard as a private bucket, with no storage policies**: only the API, with the service role, reads and writes it, and it hands out signed URLs that expire after 10 minutes. The row holds `bucket` and `object_key`, never a URL. `detached_at` is the time since which the note has not referred to the attachment; the API's daily cleanup job deletes the files and the row of one detached for 7 days. Deleting a note (or its project, goal or task) keeps the row with `note_id` NULL so the cleanup job still finds the files; deleting a user deletes the rows, and the files under `{user_id}/` must then be deleted by hand. `authenticated` can read only its own rows and cannot write. Additive and compatible with the previously deployed API, and safe to apply twice. It stops with an error if a `note_attachments` table with the layout of the disabled migration 016 exists: check that it is empty (`SELECT count(*) FROM public.note_attachments;`), drop it, and apply again. **Apply before deploying the API that serves attachments, and create the bucket before the first upload** (without the bucket uploads answer 503; nothing else is affected). The rollback drops the table and with it the only record of which files are in the bucket: empty the bucket by hand afterwards.
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
