-- Rollback: Remove goal due date

ALTER TABLE public.goals
    DROP COLUMN IF EXISTS due_date;
