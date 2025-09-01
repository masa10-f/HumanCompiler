-- Add composite indexes for common sort combinations
-- This migration improves performance for sorting operations

-- Projects table indexes
CREATE INDEX IF NOT EXISTS idx_projects_status_created_at ON public.projects(status, created_at);
CREATE INDEX IF NOT EXISTS idx_projects_status_updated_at ON public.projects(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_projects_title ON public.projects(title);

-- Goals table indexes
CREATE INDEX IF NOT EXISTS idx_goals_status_created_at ON public.goals(status, created_at);
CREATE INDEX IF NOT EXISTS idx_goals_status_updated_at ON public.goals(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_goals_title ON public.goals(title);

-- Tasks table indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status_created_at ON public.tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_updated_at ON public.tasks(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status_priority ON public.tasks(status, priority);
CREATE INDEX IF NOT EXISTS idx_tasks_title ON public.tasks(title);
CREATE INDEX IF NOT EXISTS idx_tasks_priority ON public.tasks(priority);

-- Weekly recurring tasks indexes
CREATE INDEX IF NOT EXISTS idx_weekly_recurring_tasks_title ON public.weekly_recurring_tasks(title);
CREATE INDEX IF NOT EXISTS idx_weekly_recurring_tasks_created_at ON public.weekly_recurring_tasks(created_at);

-- Logs table indexes
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_updated_at ON public.logs(updated_at);

-- Performance optimization: Add covering indexes for common queries
-- These indexes include frequently accessed columns to avoid table lookups
CREATE INDEX IF NOT EXISTS idx_projects_owner_status_covering
ON public.projects(owner_id, status)
INCLUDE (title, created_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_goals_project_status_covering
ON public.goals(project_id, status)
INCLUDE (title, created_at, updated_at);

CREATE INDEX IF NOT EXISTS idx_tasks_goal_status_covering
ON public.tasks(goal_id, status)
INCLUDE (title, priority, created_at, updated_at);

-- Comments for documentation
COMMENT ON INDEX idx_projects_status_created_at IS 'Composite index for projects sorting by status and creation date';
COMMENT ON INDEX idx_goals_status_created_at IS 'Composite index for goals sorting by status and creation date';
COMMENT ON INDEX idx_tasks_status_created_at IS 'Composite index for tasks sorting by status and creation date';
COMMENT ON INDEX idx_projects_owner_status_covering IS 'Covering index for project list queries with status sorting';
COMMENT ON INDEX idx_goals_project_status_covering IS 'Covering index for goal list queries with status sorting';
COMMENT ON INDEX idx_tasks_goal_status_covering IS 'Covering index for task list queries with status sorting';
