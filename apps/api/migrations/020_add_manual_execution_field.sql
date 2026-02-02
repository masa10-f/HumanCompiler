-- Migration: Add manual execution flag to work_sessions table
-- Feature: Manual task execution in Runner
-- Allows users to execute tasks not in today's schedule

-- Add is_manual_execution column to work_sessions table
ALTER TABLE work_sessions
    ADD COLUMN IF NOT EXISTS is_manual_execution BOOLEAN DEFAULT FALSE;

-- Comment for documentation
COMMENT ON COLUMN work_sessions.is_manual_execution IS 'True if the task was manually selected (not from today''s schedule)';

-- Index for querying manual execution sessions (optional, for analytics)
CREATE INDEX IF NOT EXISTS idx_work_sessions_manual_execution
    ON work_sessions(is_manual_execution, started_at)
    WHERE is_manual_execution = TRUE;
