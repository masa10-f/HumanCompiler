-- Migration: Keep goal estimates equal to the sum of their task estimates
-- Date: 2026-10-23
-- Description: The API now sets goals.estimate_hours to the sum of the goal's
-- task estimates whenever a task is created, changed, moved or deleted. Goals
-- without tasks keep the estimate entered for the goal. Project estimates are
-- not stored; the API sums them from the goals.
--   * goals.estimate_hours widens from NUMERIC(5,2) to NUMERIC(7,2), because a
--     total over several tasks can exceed 999.99 hours.
--   * existing goals that have tasks are backfilled with their task total.
-- Apply before deploying the API that keeps the totals in sync. The previous
-- API can still read every goal as long as no total exceeds 999.99 hours.

ALTER TABLE public.goals ALTER COLUMN estimate_hours TYPE NUMERIC(7, 2);

UPDATE public.goals AS g
SET estimate_hours = totals.total
FROM (
    SELECT goal_id, SUM(estimate_hours) AS total
    FROM public.tasks
    GROUP BY goal_id
) AS totals
WHERE totals.goal_id = g.id
  AND totals.total > 0
  AND g.estimate_hours IS DISTINCT FROM totals.total;
