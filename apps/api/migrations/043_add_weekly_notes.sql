-- Migration: Add weekly notes
-- Date: 2026-11-08
-- Description: Creates weekly_notes, one free-form note per user and week.
-- A week starts on Monday (ISO 8601, the same week as weekly_rhythm_blocks'
-- weekday 0) and week_start holds that Monday. content is the HTML the web
-- editor saves (content_type 'html'); an empty note is stored as ''.
-- Deleting a user deletes their weekly notes.
-- Additive only: the API deployed before this migration does not know the
-- table and keeps working. Apply it before deploying the API that serves
-- /api/weekly-notes.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 043_add_weekly_notes.sql.'';
    END IF;
END
';

CREATE TABLE IF NOT EXISTS public.weekly_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    week_start DATE NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    content_type VARCHAR(20) NOT NULL DEFAULT 'html',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_weekly_notes_user_week UNIQUE (user_id, week_start),
    CONSTRAINT ck_weekly_notes_week_start_monday CHECK (
        EXTRACT(ISODOW FROM week_start) = 1
    ),
    CONSTRAINT ck_weekly_notes_content_type CHECK (
        content_type IN ('html', 'markdown')
    )
);

-- Agent incremental reads page by (updated_at, id).
CREATE INDEX IF NOT EXISTS idx_weekly_notes_user_updated
    ON public.weekly_notes(user_id, updated_at, id);

ALTER TABLE public.weekly_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_notes_own_rows" ON public.weekly_notes;

CREATE POLICY "weekly_notes_own_rows" ON public.weekly_notes
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

REVOKE ALL ON public.weekly_notes FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_notes TO authenticated;

COMMENT ON TABLE public.weekly_notes IS 'One free-form note per user and ISO week (Monday start)';
COMMENT ON COLUMN public.weekly_notes.week_start IS 'Monday of the week (ISO 8601)';
COMMENT ON COLUMN public.weekly_notes.content IS 'Editor HTML; empty string for an empty note';
