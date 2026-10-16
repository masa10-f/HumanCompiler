-- Description: Restore the daily plan policy role used by migration 027

-- Ownership predicates and table grants remain unchanged.
ALTER POLICY daily_plan_documents_own_data
    ON public.daily_plan_documents
    TO PUBLIC;
