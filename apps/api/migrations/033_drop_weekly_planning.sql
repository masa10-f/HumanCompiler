-- Migration: Drop weekly planning tables
-- Date: 2026-09-26
-- Description: Removes saved weekly plans and weekly recurring tasks. The daily
-- plan note no longer reads weekly plans, and weekly recurring tasks only fed
-- the weekly plan solver. Weekly work reports read work logs and are unaffected.
-- Stored weekly plans and recurring tasks are deleted; back up both tables
-- first to keep them.
-- Apply only after deploying the API that no longer serves weekly plans: the
-- previous API reads weekly_schedules on every task workspace request.

DROP TABLE IF EXISTS public.weekly_schedules;
DROP TABLE IF EXISTS public.weekly_recurring_tasks;

-- Enum type used only by weekly_recurring_tasks.category
DROP TYPE IF EXISTS public.taskcategory;
