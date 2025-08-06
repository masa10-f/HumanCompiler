-- Migration: Add performance indexes for TaskAgent database
-- Date: 2025-08-06
-- Description: Add indexes to improve query performance based on common access patterns

-- Projects table indexes
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_owner_id_created_at ON projects(owner_id, created_at DESC);

-- Goals table indexes
CREATE INDEX IF NOT EXISTS idx_goals_project_id ON goals(project_id);
CREATE INDEX IF NOT EXISTS idx_goals_project_id_created_at ON goals(project_id, created_at DESC);

-- Tasks table indexes
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id_status ON tasks(goal_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id_created_at ON tasks(goal_id, created_at DESC);

-- Schedules table indexes
CREATE INDEX IF NOT EXISTS idx_schedules_user_id ON schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_schedules_user_id_date ON schedules(user_id, date DESC);

-- Logs table indexes
CREATE INDEX IF NOT EXISTS idx_logs_task_id ON logs(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_task_id_created_at ON logs(task_id, created_at DESC);

-- API usage logs table indexes
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id ON api_usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_user_id_timestamp ON api_usage_logs(user_id, request_timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_api_usage_logs_endpoint ON api_usage_logs(endpoint);

-- Add comments to document index purposes
COMMENT ON INDEX idx_projects_owner_id IS 'Speed up project lookups by owner';
COMMENT ON INDEX idx_projects_owner_id_created_at IS 'Speed up paginated project listings with consistent ordering';

COMMENT ON INDEX idx_goals_project_id IS 'Speed up goal lookups by project';
COMMENT ON INDEX idx_goals_project_id_created_at IS 'Speed up paginated goal listings with consistent ordering';

COMMENT ON INDEX idx_tasks_goal_id IS 'Speed up task lookups by goal';
COMMENT ON INDEX idx_tasks_status IS 'Speed up task filtering by status';
COMMENT ON INDEX idx_tasks_due_date IS 'Speed up task filtering and sorting by due date';
COMMENT ON INDEX idx_tasks_goal_id_status IS 'Speed up task lookups by goal and status (composite)';
COMMENT ON INDEX idx_tasks_goal_id_created_at IS 'Speed up paginated task listings with consistent ordering';

COMMENT ON INDEX idx_schedules_user_id IS 'Speed up schedule lookups by user';
COMMENT ON INDEX idx_schedules_user_id_date IS 'Speed up schedule lookups by user and date (composite)';

COMMENT ON INDEX idx_logs_task_id IS 'Speed up log lookups by task';
COMMENT ON INDEX idx_logs_task_id_created_at IS 'Speed up paginated log listings with consistent ordering';

COMMENT ON INDEX idx_api_usage_logs_user_id IS 'Speed up API usage lookups by user';
COMMENT ON INDEX idx_api_usage_logs_user_id_timestamp IS 'Speed up API usage analytics queries';
COMMENT ON INDEX idx_api_usage_logs_endpoint IS 'Speed up API usage analytics by endpoint';
