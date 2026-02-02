-- Migration: Add slot templates table for day-of-week scheduling presets
-- Created: 2026-02-02

-- Create slot_templates table
CREATE TABLE IF NOT EXISTS slot_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    slots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_slot_templates_user_id ON slot_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_slot_templates_user_day ON slot_templates(user_id, day_of_week);

-- Unique constraint to ensure only one default template per user per day
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_templates_unique_default
    ON slot_templates(user_id, day_of_week)
    WHERE is_default = true;

-- Enable Row Level Security
ALTER TABLE slot_templates ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own templates
DROP POLICY IF EXISTS slot_templates_user_policy ON slot_templates;
CREATE POLICY slot_templates_user_policy ON slot_templates
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Grant permissions to authenticated users
GRANT ALL ON slot_templates TO authenticated;

-- Add comment for documentation
COMMENT ON TABLE slot_templates IS 'Stores day-of-week slot presets for scheduling. Each user can have multiple templates per day with one marked as default.';
COMMENT ON COLUMN slot_templates.day_of_week IS 'Day of week following ISO 8601: 0=Monday, 6=Sunday';
COMMENT ON COLUMN slot_templates.slots_json IS 'Array of TimeSlot objects with start, end, kind, and optional capacity_hours/assigned_project_id';
COMMENT ON COLUMN slot_templates.is_default IS 'Whether this template is automatically applied for the day of week';
