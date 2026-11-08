-- Rollback: Remove weekly notes
-- Run this after rolling back to the API without /api/weekly-notes.
-- Every user's weekly notes are deleted with the table: back up
-- public.weekly_notes first if they should be kept.

DROP TABLE IF EXISTS public.weekly_notes;
