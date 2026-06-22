-- Rollback: Add capacity triage tables

DROP TRIGGER IF EXISTS update_task_triage_items_updated_at ON task_triage_items;
DROP TRIGGER IF EXISTS update_task_triage_runs_updated_at ON task_triage_runs;
DROP TRIGGER IF EXISTS update_triage_capacity_settings_updated_at ON triage_capacity_settings;

DROP POLICY IF EXISTS task_triage_items_policy ON task_triage_items;
DROP POLICY IF EXISTS task_triage_runs_policy ON task_triage_runs;
DROP POLICY IF EXISTS triage_capacity_settings_policy ON triage_capacity_settings;

DROP TABLE IF EXISTS task_triage_items;
DROP TABLE IF EXISTS task_triage_runs;
DROP TABLE IF EXISTS triage_capacity_settings;
