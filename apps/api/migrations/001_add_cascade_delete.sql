-- Migration: Add CASCADE DELETE constraints for optimized project deletion
-- This migration adds ON DELETE CASCADE to foreign key constraints
-- to enable database-level cascade deletion for improved performance

-- Note: SQLite doesn't support ALTER TABLE ... ADD CONSTRAINT with CASCADE
-- For PostgreSQL/production, these would be the proper statements:

/*
-- For PostgreSQL (production environment):
ALTER TABLE goals DROP CONSTRAINT IF EXISTS goals_project_id_fkey;
ALTER TABLE goals ADD CONSTRAINT goals_project_id_fkey 
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_goal_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_goal_id_fkey 
    FOREIGN KEY (goal_id) REFERENCES goals(id) ON DELETE CASCADE;

ALTER TABLE logs DROP CONSTRAINT IF EXISTS logs_task_id_fkey;
ALTER TABLE logs ADD CONSTRAINT logs_task_id_fkey 
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE;
*/

-- For development (SQLite), the schema will be recreated with proper CASCADE constraints
-- when the application restarts and SQLModel creates the tables

-- This file serves as documentation of the schema changes for production deployment