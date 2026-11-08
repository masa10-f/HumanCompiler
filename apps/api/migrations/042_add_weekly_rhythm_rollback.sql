-- Rollback: Remove weekly rhythm
-- Run this after rolling back to the API without /api/weekly-rhythm.
-- Every user's weekday template is deleted with the table. Daily notes that
-- were started from a template keep their lines: the note holds its own copy.

DROP TABLE IF EXISTS public.weekly_rhythm_blocks;
