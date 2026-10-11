-- Rollback: Remove paused project status
-- Run this before rolling back to an API without the paused status, which
-- cannot load paused projects. Paused projects return to in_progress.
-- The VARCHAR(20) column and any CHECK constraint recreated by 034 are kept:
-- they match 009, and the previous API reads and writes the same string
-- values. The RLS policy is kept as well. The text comparison also works on a
-- database whose status column is still a native enum without a paused label.

UPDATE public.projects
SET status = 'in_progress'
WHERE status::text = 'paused';
