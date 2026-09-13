-- Migration: Scope daily plan RLS policy to authenticated users
-- Created: 2026-09-13
-- Description: Align the daily plan policy role without changing ownership predicates

-- Keep 027 immutable: this also upgrades databases where it is already applied.
-- ALTER POLICY preserves USING/WITH CHECK and does not touch stored documents.
ALTER POLICY daily_plan_documents_own_data
    ON public.daily_plan_documents
    TO authenticated;
