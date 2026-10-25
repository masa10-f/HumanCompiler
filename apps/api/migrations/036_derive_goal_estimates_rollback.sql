-- Rollback: Stop storing goal estimates
-- Run this before rolling back to an API that reads goals.estimate_hours,
-- which rejects goals without a positive estimate. Goals created while the
-- column was unused get the sum of their non-cancelled task estimates, or one
-- hour when there is none, capped at the column's 999.99 limit. NOT NULL is
-- not restored because 001 never set it.

UPDATE public.goals AS g
SET estimate_hours = LEAST(
    COALESCE(
        (
            SELECT NULLIF(SUM(t.estimate_hours), 0)
            FROM public.tasks AS t
            WHERE t.goal_id = g.id
              AND t.status::text <> 'cancelled'
        ),
        1
    ),
    999.99
)
WHERE g.estimate_hours IS NULL;
