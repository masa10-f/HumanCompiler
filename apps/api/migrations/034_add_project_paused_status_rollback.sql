-- Rollback: Remove paused project status
-- Run this before rolling back to an API without the paused status, which
-- cannot load paused projects. Paused projects return to in_progress.
-- PostgreSQL cannot drop a value from an enum type, so a native enum keeps
-- the unused paused label.

UPDATE public.projects
SET status = 'in_progress'
WHERE status = 'paused';
