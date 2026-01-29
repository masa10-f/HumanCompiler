-- Migration: Add context notes tables with simplified RLS
-- Created: 2026-01-29
-- Description: Context notes for projects and goals with simple user_id-based RLS

-- Create context_notes table with user_id for simple RLS
CREATE TABLE IF NOT EXISTS context_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Owner (for RLS - no complex JOINs needed)
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Target entity (exactly one must be set)
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    goal_id UUID REFERENCES goals(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,

    -- Content
    content TEXT NOT NULL DEFAULT '',
    content_type VARCHAR(20) NOT NULL DEFAULT 'markdown',

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Constraints
    CONSTRAINT unique_project_note UNIQUE (project_id),
    CONSTRAINT unique_goal_note UNIQUE (goal_id),
    CONSTRAINT unique_task_note UNIQUE (task_id),
    CONSTRAINT at_least_one_entity CHECK (
        (CASE WHEN project_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN goal_id IS NOT NULL THEN 1 ELSE 0 END +
         CASE WHEN task_id IS NOT NULL THEN 1 ELSE 0 END) = 1
    )
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_context_notes_user_id ON context_notes(user_id);
CREATE INDEX IF NOT EXISTS idx_context_notes_project_id ON context_notes(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_notes_goal_id ON context_notes(goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_notes_task_id ON context_notes(task_id) WHERE task_id IS NOT NULL;

-- Enable RLS
ALTER TABLE context_notes ENABLE ROW LEVEL SECURITY;

-- Simple RLS policy: users can only access their own notes
CREATE POLICY context_notes_user_policy ON context_notes
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Add comments
COMMENT ON TABLE context_notes IS 'Rich text context notes for projects, goals, and tasks';
COMMENT ON COLUMN context_notes.user_id IS 'Owner of the note, used for RLS';
COMMENT ON COLUMN context_notes.content_type IS 'Content format: markdown, html, or tiptap_json';
