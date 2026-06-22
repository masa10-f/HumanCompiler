-- Rollback: Add capacity triage tables

DROP TRIGGER IF EXISTS update_task_triage_items_updated_at ON public.task_triage_items;
DROP TRIGGER IF EXISTS update_task_triage_runs_updated_at ON public.task_triage_runs;
DROP TRIGGER IF EXISTS update_triage_capacity_settings_updated_at ON public.triage_capacity_settings;

DROP POLICY IF EXISTS task_triage_items_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_select_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_insert_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_update_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_delete_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_runs_policy ON public.task_triage_runs;
DROP POLICY IF EXISTS triage_capacity_settings_policy ON public.triage_capacity_settings;

REVOKE SELECT, INSERT, UPDATE, DELETE ON public.task_triage_items FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.task_triage_runs FROM authenticated;
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.triage_capacity_settings FROM authenticated;

DROP TABLE IF EXISTS public.task_triage_items;
DROP TABLE IF EXISTS public.task_triage_runs;
DROP TABLE IF EXISTS public.triage_capacity_settings;
