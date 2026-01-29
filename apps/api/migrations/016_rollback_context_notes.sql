-- Rollback Migration: Remove context notes tables
-- This reverses migration 016_add_context_notes.sql

-- Drop RLS policies first
DROP POLICY IF EXISTS note_attachments_delete_policy ON note_attachments;
DROP POLICY IF EXISTS note_attachments_insert_policy ON note_attachments;
DROP POLICY IF EXISTS note_attachments_select_policy ON note_attachments;

DROP POLICY IF EXISTS context_notes_delete_policy ON context_notes;
DROP POLICY IF EXISTS context_notes_update_policy ON context_notes;
DROP POLICY IF EXISTS context_notes_insert_policy ON context_notes;
DROP POLICY IF EXISTS context_notes_select_policy ON context_notes;

-- Drop indexes
DROP INDEX IF EXISTS idx_note_attachments_note_id;
DROP INDEX IF EXISTS idx_context_notes_task_id;
DROP INDEX IF EXISTS idx_context_notes_goal_id;
DROP INDEX IF EXISTS idx_context_notes_project_id;

-- Drop tables (note_attachments first due to foreign key)
DROP TABLE IF EXISTS note_attachments;
DROP TABLE IF EXISTS context_notes;
