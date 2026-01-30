-- Rollback Migration: Remove quick_tasks table
-- Created: 2026-01-30
-- Description: Rollback for 018_add_quick_tasks.sql

-- Drop the policy first
DROP POLICY IF EXISTS "quick_tasks_own_data" ON public.quick_tasks;

-- Revoke permissions
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.quick_tasks FROM authenticated;

-- Drop indexes
DROP INDEX IF EXISTS idx_quick_tasks_owner_id;
DROP INDEX IF EXISTS idx_quick_tasks_status;
DROP INDEX IF EXISTS idx_quick_tasks_due_date;
DROP INDEX IF EXISTS idx_quick_tasks_priority;
DROP INDEX IF EXISTS idx_quick_tasks_owner_status;

-- Drop table
DROP TABLE IF EXISTS public.quick_tasks;
