-- Rollback: Keep goal estimates equal to the sum of their task estimates
-- Run this after rolling back to an API that stores goal estimates as
-- NUMERIC(5,2). Goal totals above 999.99 hours are capped at 999.99 so the
-- column fits again. The estimates entered for goals before 036 backfilled
-- them with their task totals are not restored.

UPDATE public.goals
SET estimate_hours = 999.99
WHERE estimate_hours > 999.99;

ALTER TABLE public.goals ALTER COLUMN estimate_hours TYPE NUMERIC(5, 2);
