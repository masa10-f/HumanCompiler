-- Migration: Add status column to goals table
-- This migration adds a status field to track goal progress

-- Add status column with default value to prevent NULL constraint issues
ALTER TABLE goals
ADD COLUMN status VARCHAR(50) DEFAULT 'pending' NOT NULL;

-- Add comment for clarity
COMMENT ON COLUMN goals.status IS 'Goal status: pending, in_progress, completed, cancelled';

-- Create index for performance on status queries
CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
