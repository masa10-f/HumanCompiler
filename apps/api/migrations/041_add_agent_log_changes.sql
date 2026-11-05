-- Migration: Record agent work logs in agent_changes
-- Date: 2026-11-04
-- Description: Widens ck_agent_changes_entity_type with log, so a work log
-- (time record) written through the Agent Gateway is kept in the change
-- history like the goal, task and note writes.
-- Additive only: the API deployed before this migration never writes log
-- rows, and every row it writes is still accepted.
-- Safe to apply twice: the constraint is dropped by name and recreated.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.agent_changes'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.agent_changes is missing. Apply 040_add_agent_writes.sql before 041_add_agent_log_changes.sql.'';
    END IF;
END
';

ALTER TABLE public.agent_changes DROP CONSTRAINT IF EXISTS ck_agent_changes_entity_type;

ALTER TABLE public.agent_changes ADD CONSTRAINT ck_agent_changes_entity_type CHECK (
    entity_type IN ('goal', 'task', 'context_note', 'task_dependency', 'log')
);

COMMENT ON TABLE public.agent_changes IS 'History of changes made to goals, tasks, notes, task dependencies and work logs by agents (and user reverts); rows older than 365 days are purged daily';
