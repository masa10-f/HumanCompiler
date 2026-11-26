-- Migration: Give every project, goal and task an overview and a log
-- Date: 2026-11-26
-- Description: Adds context_notes.section, 'overview' or 'log', and lets an
-- item have one note of each.
-- A note used to hold both what is true now and everything that happened,
-- and it grew with every summary an agent appended. The two are now separate
-- notes of the same item: the overview (short, rewritten in place, what lists
-- and reads show) and the log (appended to, read on request).
--
-- 1. context_notes.section (VARCHAR(20) NOT NULL DEFAULT 'overview') is
--    added, so every existing note is its item's overview. No content changes.
-- 2. The three "one note per item" constraints (unique_project_note,
--    unique_goal_note, unique_task_note) become "one note per item and
--    section".
--
-- Additive for the API deployed before it: that API reads and writes one note
-- per item and does not create logs. It does not tell the two notes apart,
-- though, so it shows either of them once an item has a log: apply this right
-- before deploying the API that reads context_notes.section (that API selects
-- the column, so note reads fail without it), and do not write logs (through a
-- preview of the new API, or migration 048) while the old API still serves.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.context_notes'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.context_notes is missing. Apply earlier migrations before 047_add_note_sections.sql.'';
    END IF;
END
';

ALTER TABLE public.context_notes
    ADD COLUMN IF NOT EXISTS section VARCHAR(20) NOT NULL DEFAULT 'overview';

ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS context_notes_section_check;
ALTER TABLE public.context_notes
    ADD CONSTRAINT context_notes_section_check
    CHECK (section IN ('overview', 'log'));

-- The new constraints are added before the old ones go, so the table is never
-- without them.
ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS unique_project_note_section;
ALTER TABLE public.context_notes
    ADD CONSTRAINT unique_project_note_section UNIQUE (project_id, section);
ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS unique_goal_note_section;
ALTER TABLE public.context_notes
    ADD CONSTRAINT unique_goal_note_section UNIQUE (goal_id, section);
ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS unique_task_note_section;
ALTER TABLE public.context_notes
    ADD CONSTRAINT unique_task_note_section UNIQUE (task_id, section);

ALTER TABLE public.context_notes DROP CONSTRAINT IF EXISTS unique_project_note;
ALTER TABLE public.context_notes DROP CONSTRAINT IF EXISTS unique_goal_note;
ALTER TABLE public.context_notes DROP CONSTRAINT IF EXISTS unique_task_note;

COMMENT ON COLUMN public.context_notes.section IS
    'overview: what is true now, shown by default; log: what happened, appended to and read on request';
