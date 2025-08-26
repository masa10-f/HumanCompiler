-- Add optimized indexes for memo search functionality
-- Execute this in Supabase SQL Editor after adding memo column

BEGIN;

-- Enable pg_trgm extension for full-text search if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Add GIN index for memo full-text search (future feature)
-- This allows for efficient LIKE '%text%' and similarity searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_memo_gin
ON tasks USING gin(memo gin_trgm_ops)
WHERE memo IS NOT NULL AND memo != '';

-- Add partial index for tasks with memos for better performance
-- This supports queries filtering tasks that have memos
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_memo_exists
ON tasks (created_at DESC)
WHERE memo IS NOT NULL AND memo != '';

-- Add composite index for user-specific memo searches (via goal -> project -> owner)
-- This will be useful when implementing user-scoped memo searches
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tasks_goal_memo
ON tasks (goal_id, created_at DESC)
WHERE memo IS NOT NULL AND memo != '';

COMMIT;
