-- Rollback: Stop recording agent work logs in agent_changes
-- Run this after rolling back to the API without agent log writes.
-- The change rows for work logs are deleted; the work logs themselves are
-- kept. Then the entity types go back to the 4 of migration 040.

DELETE FROM public.agent_changes WHERE entity_type = 'log';

ALTER TABLE public.agent_changes DROP CONSTRAINT IF EXISTS ck_agent_changes_entity_type;

ALTER TABLE public.agent_changes ADD CONSTRAINT ck_agent_changes_entity_type CHECK (
    entity_type IN ('goal', 'task', 'context_note', 'task_dependency')
);

COMMENT ON TABLE public.agent_changes IS 'History of changes made to goals, tasks, notes and task dependencies by agents (and user reverts); rows older than 365 days are purged daily';
