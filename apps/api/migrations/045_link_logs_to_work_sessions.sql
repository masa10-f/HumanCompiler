-- Migration: Link a Runner session to its time log
-- Date: 2026-11-23
-- Description: Adds logs.work_session_id, the Runner session a time log was
-- measured in, and fills it for existing logs.
-- A Runner checkout (and a task switch) has always written two rows for one
-- piece of work: the work_sessions row and a logs row with the minutes. They
-- were not linked, so a task's work records listed the same work twice. With
-- the link the web shows one record: the log's time with the session's
-- reflection. A log entered by hand, in the daily note or by an agent has no
-- session and keeps work_session_id NULL.
--
-- 1. logs.work_session_id (UUID NULL) references work_sessions(id) with
--    ON DELETE SET NULL: deleting a session keeps the time it measured.
--    A partial unique index allows one log per session.
-- 2. Existing rows are paired by task and time. A checkout writes the log in
--    the same request that ends the session, so a pair is a session and a log
--    of the same task whose created_at is within 10 seconds of the session's
--    ended_at. Only pairs that are each other's closest match are linked, so
--    no log gets two sessions and no session two logs. A session whose log
--    was deleted, or a log entered by hand, stays unlinked.
--
-- No row is deleted and no time or comment is changed. Linked logs get a new
-- updated_at from the trigger of 035, since their API response gains the id.
-- Additive: the API deployed before this migration ignores the column. Apply
-- it before deploying the API that reads logs.work_session_id.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup. A
-- second run links only what is still unlinked.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.logs'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.logs is missing. Apply earlier migrations before 045_link_logs_to_work_sessions.sql.'';
    END IF;
    IF to_regclass(''public.work_sessions'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.work_sessions is missing. Apply earlier migrations before 045_link_logs_to_work_sessions.sql.'';
    END IF;
END
';

ALTER TABLE public.logs
    ADD COLUMN IF NOT EXISTS work_session_id UUID;

DO '
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = ''public.logs''::regclass
          AND conname = ''logs_work_session_id_fkey''
    ) THEN
        ALTER TABLE public.logs
            ADD CONSTRAINT logs_work_session_id_fkey
            FOREIGN KEY (work_session_id)
            REFERENCES public.work_sessions(id) ON DELETE SET NULL;
    END IF;
END
';

CREATE UNIQUE INDEX IF NOT EXISTS uq_logs_work_session_id
    ON public.logs(work_session_id)
    WHERE work_session_id IS NOT NULL;

COMMENT ON COLUMN public.logs.work_session_id IS
    'Runner session this time was measured in; NULL for a time entered by hand, in the daily note or by an agent';

-- 2. Pair existing sessions and logs.
WITH candidates AS (
    SELECT
        s.id AS session_id,
        l.id AS log_id,
        abs(extract(epoch FROM (l.created_at - s.ended_at))) AS gap
    FROM public.work_sessions AS s
    JOIN public.logs AS l ON l.task_id = s.task_id
    WHERE s.ended_at IS NOT NULL
      AND l.work_session_id IS NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.logs AS linked WHERE linked.work_session_id = s.id
      )
      AND l.created_at BETWEEN s.ended_at - INTERVAL '10 seconds'
                           AND s.ended_at + INTERVAL '10 seconds'
),
ranked AS (
    SELECT
        session_id,
        log_id,
        row_number() OVER (PARTITION BY session_id ORDER BY gap, log_id) AS by_session,
        row_number() OVER (PARTITION BY log_id ORDER BY gap, session_id) AS by_log
    FROM candidates
)
UPDATE public.logs AS l
SET work_session_id = ranked.session_id
FROM ranked
WHERE l.id = ranked.log_id
  AND ranked.by_session = 1
  AND ranked.by_log = 1;
