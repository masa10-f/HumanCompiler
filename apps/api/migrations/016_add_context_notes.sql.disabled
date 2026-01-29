-- Migration: Add context notes tables for rich text notes on projects, goals, and tasks
-- Created: 2026-01-28

-- Create context_notes table
CREATE TABLE IF NOT EXISTS context_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

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

-- Create note_attachments table for images and files
CREATE TABLE IF NOT EXISTS note_attachments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id UUID NOT NULL REFERENCES context_notes(id) ON DELETE CASCADE,

    -- File information
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size INTEGER NOT NULL,
    storage_path VARCHAR(500) NOT NULL,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_context_notes_project_id ON context_notes(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_notes_goal_id ON context_notes(goal_id) WHERE goal_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_context_notes_task_id ON context_notes(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_attachments_note_id ON note_attachments(note_id);

-- Enable RLS
ALTER TABLE context_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE note_attachments ENABLE ROW LEVEL SECURITY;

-- RLS policies for context_notes
-- Users can only access notes for their own projects/goals/tasks
CREATE POLICY context_notes_select_policy ON context_notes
    FOR SELECT
    USING (
        (project_id IS NOT NULL AND project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        ))
        OR
        (goal_id IS NOT NULL AND goal_id IN (
            SELECT g.id FROM goals g
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
        OR
        (task_id IS NOT NULL AND task_id IN (
            SELECT t.id FROM tasks t
            JOIN goals g ON t.goal_id = g.id
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
    );

CREATE POLICY context_notes_insert_policy ON context_notes
    FOR INSERT
    WITH CHECK (
        (project_id IS NOT NULL AND project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        ))
        OR
        (goal_id IS NOT NULL AND goal_id IN (
            SELECT g.id FROM goals g
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
        OR
        (task_id IS NOT NULL AND task_id IN (
            SELECT t.id FROM tasks t
            JOIN goals g ON t.goal_id = g.id
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
    );

CREATE POLICY context_notes_update_policy ON context_notes
    FOR UPDATE
    USING (
        (project_id IS NOT NULL AND project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        ))
        OR
        (goal_id IS NOT NULL AND goal_id IN (
            SELECT g.id FROM goals g
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
        OR
        (task_id IS NOT NULL AND task_id IN (
            SELECT t.id FROM tasks t
            JOIN goals g ON t.goal_id = g.id
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
    );

CREATE POLICY context_notes_delete_policy ON context_notes
    FOR DELETE
    USING (
        (project_id IS NOT NULL AND project_id IN (
            SELECT id FROM projects WHERE owner_id = auth.uid()
        ))
        OR
        (goal_id IS NOT NULL AND goal_id IN (
            SELECT g.id FROM goals g
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
        OR
        (task_id IS NOT NULL AND task_id IN (
            SELECT t.id FROM tasks t
            JOIN goals g ON t.goal_id = g.id
            JOIN projects p ON g.project_id = p.id
            WHERE p.owner_id = auth.uid()
        ))
    );

-- RLS policies for note_attachments
-- Users can access attachments for notes they own
CREATE POLICY note_attachments_select_policy ON note_attachments
    FOR SELECT
    USING (
        note_id IN (SELECT id FROM context_notes)
    );

CREATE POLICY note_attachments_insert_policy ON note_attachments
    FOR INSERT
    WITH CHECK (
        note_id IN (SELECT id FROM context_notes)
    );

CREATE POLICY note_attachments_delete_policy ON note_attachments
    FOR DELETE
    USING (
        note_id IN (SELECT id FROM context_notes)
    );

-- Add comments
COMMENT ON TABLE context_notes IS 'Rich text context notes for projects, goals, and tasks';
COMMENT ON TABLE note_attachments IS 'File attachments (images, etc.) for context notes';
COMMENT ON COLUMN context_notes.content_type IS 'Content format: markdown, html, or tiptap_json';
