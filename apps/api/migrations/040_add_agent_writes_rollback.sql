-- Rollback: Remove agent writes
-- Run this after rolling back to the API without agent writes.
-- Change history is deleted with agent_changes; the goals, tasks and notes that
-- the changes touched are kept as they are.
-- The proposal kinds go back to the 7 kinds of migration 039. Restoring the
-- constraint fails if proposals with goal_change, task_change or note_replace
-- still exist; the first statement stops the rollback before anything is
-- dropped. Decide or delete those proposals first.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.agent_proposals
        WHERE kind IN (''goal_change'', ''task_change'', ''note_replace'')
    ) THEN
        RAISE EXCEPTION ''Proposals with kind goal_change, task_change or note_replace exist. Delete them before rolling back 040_add_agent_writes.sql.'';
    END IF;
END
';

ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS ck_agent_proposals_kind;

ALTER TABLE public.agent_proposals ADD CONSTRAINT ck_agent_proposals_kind CHECK (
    kind IN ('goal', 'task', 'quick_task', 'note_append', 'contradiction', 'decision_request', 'experiment')
);

DROP TABLE IF EXISTS public.agent_changes;
