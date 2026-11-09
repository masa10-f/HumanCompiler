-- Rollback: Remove weekly notes
-- Run this after rolling back to the API without /api/weekly-notes.
-- Every user's weekly notes are deleted with the table, and the week start
-- setting with its column: back up public.weekly_notes first if the notes
-- should be kept.

DROP TABLE IF EXISTS public.weekly_notes;

ALTER TABLE public.user_settings DROP COLUMN IF EXISTS week_start_day;
