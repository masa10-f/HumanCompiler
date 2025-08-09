-- Rollback Migration: Remove performance indexes
-- Date: 2025-08-06
-- Description: Remove performance indexes if needed

-- Remove API usage logs table indexes
DROP INDEX IF EXISTS idx_api_usage_logs_endpoint;
DROP INDEX IF EXISTS idx_api_usage_logs_user_id_timestamp;
DROP INDEX IF EXISTS idx_api_usage_logs_user_id;

-- Remove Logs table indexes
DROP INDEX IF EXISTS idx_logs_task_id_created_at;
DROP INDEX IF EXISTS idx_logs_task_id;

-- Remove Schedules table indexes
DROP INDEX IF EXISTS idx_schedules_user_id_date;
DROP INDEX IF EXISTS idx_schedules_user_id;

-- Remove Tasks table indexes
DROP INDEX IF EXISTS idx_tasks_goal_id_created_at;
DROP INDEX IF EXISTS idx_tasks_goal_id_status;
DROP INDEX IF EXISTS idx_tasks_due_date;
DROP INDEX IF EXISTS idx_tasks_status;
DROP INDEX IF EXISTS idx_tasks_goal_id;

-- Remove Goals table indexes
DROP INDEX IF EXISTS idx_goals_project_id_created_at;
DROP INDEX IF EXISTS idx_goals_project_id;

-- Remove Projects table indexes
DROP INDEX IF EXISTS idx_projects_owner_id_created_at;
DROP INDEX IF EXISTS idx_projects_owner_id;
