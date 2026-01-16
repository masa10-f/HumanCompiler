-- Migration: Add pause/resume functionality to work_sessions
-- Issue: #243

-- Add paused_at column to track when a session was paused
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP WITH TIME ZONE;

-- Add total_paused_seconds column to accumulate total pause time
-- Defaults to 0 for backward compatibility
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS total_paused_seconds INTEGER DEFAULT 0;

-- Create index for efficiently querying paused sessions
CREATE INDEX IF NOT EXISTS idx_work_sessions_paused_at ON work_sessions (paused_at) WHERE paused_at IS NOT NULL;

-- Comment explaining the columns
COMMENT ON COLUMN work_sessions.paused_at IS 'Timestamp when the session was paused. NULL means session is active or ended.';
COMMENT ON COLUMN work_sessions.total_paused_seconds IS 'Total accumulated pause time in seconds across all pause/resume cycles.';
