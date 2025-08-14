-- Migration: Add weekly_schedules table for storing weekly task selections
-- Created: 2025-08-14
-- Description: Stores AI-generated weekly schedules with selected tasks and optimization data

-- Create weekly_schedules table
CREATE TABLE IF NOT EXISTS weekly_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start_date TIMESTAMP NOT NULL,
    schedule_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- Unique constraint to prevent duplicate schedules for same week/user
    CONSTRAINT unique_user_week UNIQUE (user_id, week_start_date)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_user_id ON weekly_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_week_start_date ON weekly_schedules(week_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_created_at ON weekly_schedules(created_at DESC);

-- Add RLS policies for security
ALTER TABLE weekly_schedules ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own schedules
CREATE POLICY weekly_schedules_select_policy
    ON weekly_schedules
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can only insert their own schedules
CREATE POLICY weekly_schedules_insert_policy
    ON weekly_schedules
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can only update their own schedules
CREATE POLICY weekly_schedules_update_policy
    ON weekly_schedules
    FOR UPDATE
    USING (auth.uid() = user_id);

-- Policy: Users can only delete their own schedules
CREATE POLICY weekly_schedules_delete_policy
    ON weekly_schedules
    FOR DELETE
    USING (auth.uid() = user_id);

-- Comment on table
COMMENT ON TABLE weekly_schedules IS 'Stores AI-generated weekly task schedules with selected tasks and optimization insights';
COMMENT ON COLUMN weekly_schedules.week_start_date IS 'Monday of the week for this schedule';
COMMENT ON COLUMN weekly_schedules.schedule_json IS 'JSON data containing selected tasks, allocations, and insights';
