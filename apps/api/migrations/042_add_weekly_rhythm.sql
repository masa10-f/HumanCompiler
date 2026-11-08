-- Migration: Add weekly rhythm
-- Date: 2026-11-08
-- Description: Creates weekly_rhythm_blocks, the weekday template that a daily
-- note starts from: /schedule lines (with an optional project and work type),
-- fixed events and breaks for each weekday. weekday follows Python's
-- date.weekday(): 0 = Monday ... 6 = Sunday. locked marks blocks that later
-- in-week rebalancing must not move; nothing reads it yet.
-- Deleting a project keeps its blocks with project_id set to NULL, so the
-- weekday keeps its time structure; deleting a user deletes the blocks.
-- Additive only: the API deployed before this migration does not know the
-- table and keeps working. Apply it before deploying the API that serves
-- /api/weekly-rhythm.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 042_add_weekly_rhythm.sql.'';
    END IF;
    IF to_regclass(''public.projects'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.projects is missing. Apply earlier migrations before 042_add_weekly_rhythm.sql.'';
    END IF;
END
';

CREATE TABLE IF NOT EXISTS public.weekly_rhythm_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    weekday SMALLINT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    kind TEXT NOT NULL DEFAULT 'schedule',
    title VARCHAR(200),
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    work_type TEXT NOT NULL DEFAULT 'light_work',
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_weekly_rhythm_blocks_weekday CHECK (weekday BETWEEN 0 AND 6),
    CONSTRAINT ck_weekly_rhythm_blocks_range CHECK (start_time < end_time),
    CONSTRAINT ck_weekly_rhythm_blocks_kind CHECK (
        kind IN ('schedule', 'event', 'break')
    ),
    CONSTRAINT ck_weekly_rhythm_blocks_work_type CHECK (
        work_type IN ('light_work', 'focused_work', 'study')
    ),
    CONSTRAINT ck_weekly_rhythm_blocks_event_shape CHECK (
        kind = 'schedule' OR (project_id IS NULL AND title IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_weekly_rhythm_blocks_user_weekday
    ON public.weekly_rhythm_blocks(user_id, weekday, start_time);

CREATE INDEX IF NOT EXISTS idx_weekly_rhythm_blocks_project
    ON public.weekly_rhythm_blocks(project_id);

ALTER TABLE public.weekly_rhythm_blocks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_rhythm_blocks_own_rows" ON public.weekly_rhythm_blocks;

CREATE POLICY "weekly_rhythm_blocks_own_rows" ON public.weekly_rhythm_blocks
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

REVOKE ALL ON public.weekly_rhythm_blocks FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_rhythm_blocks TO authenticated;

COMMENT ON TABLE public.weekly_rhythm_blocks IS 'Weekday template that daily notes start from; replaced as a whole per user';
COMMENT ON COLUMN public.weekly_rhythm_blocks.weekday IS '0 = Monday ... 6 = Sunday (Python date.weekday())';
COMMENT ON COLUMN public.weekly_rhythm_blocks.kind IS 'schedule: /schedule line; event: fixed event; break: break';
COMMENT ON COLUMN public.weekly_rhythm_blocks.locked IS 'Excluded from future in-week rebalancing; not read yet';
