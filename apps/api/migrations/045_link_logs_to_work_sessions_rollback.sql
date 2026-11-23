-- Rollback: Link a Runner session to its time log
-- Run this after rolling back to the API that does not read
-- logs.work_session_id. It drops the link only: every log keeps its time and
-- comment, and every session is kept. A task's work records then list a
-- Runner checkout twice again, as before 045.
-- A later 045 pairs the rows again by task and time.

DROP INDEX IF EXISTS public.uq_logs_work_session_id;

ALTER TABLE public.logs DROP CONSTRAINT IF EXISTS logs_work_session_id_fkey;

ALTER TABLE public.logs DROP COLUMN IF EXISTS work_session_id;
