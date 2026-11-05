-- Migration: Add agent writes
-- Date: 2026-11-03
-- Description: Creates agent_changes, the history of changes made to goals,
-- tasks, notes and task dependencies through the Agent Gateway (and, later,
-- the user's own reverts). before and after keep the entity state as JSON so a
-- change can be shown and reverted. Also widens ck_agent_proposals_kind with
-- goal_change, task_change and note_replace, the kinds a write that lacks the
-- writes:unconfirmed scope turns into.
-- Additive only: the API deployed before this migration does not know the
-- table and keeps working, and it never writes the new proposal kinds.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 040_add_agent_writes.sql.'';
    END IF;
    IF to_regclass(''public.agent_tokens'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.agent_tokens is missing. Apply 035_add_agent_tokens.sql before 040_add_agent_writes.sql.'';
    END IF;
    IF to_regclass(''public.agent_proposals'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.agent_proposals is missing. Apply 039_add_agent_proposals.sql before 040_add_agent_writes.sql.'';
    END IF;
END
';

CREATE TABLE IF NOT EXISTS public.agent_changes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    actor TEXT NOT NULL,
    agent_token_id UUID REFERENCES public.agent_tokens(id) ON DELETE SET NULL,
    agent_name VARCHAR(100),
    proposal_id UUID,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    project_id UUID,
    goal_id UUID,
    action TEXT NOT NULL,
    before JSONB,
    after JSONB NOT NULL,
    destructive BOOLEAN NOT NULL DEFAULT FALSE,
    reverts_change_id UUID,
    reverted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_agent_changes_actor CHECK (
        actor IN ('agent', 'user')
    ),
    CONSTRAINT ck_agent_changes_entity_type CHECK (
        entity_type IN ('goal', 'task', 'context_note', 'task_dependency')
    ),
    CONSTRAINT ck_agent_changes_action CHECK (
        action IN ('create', 'update', 'append', 'replace', 'revert')
    ),
    CONSTRAINT ck_agent_changes_user_actor_no_agent CHECK (
        actor <> 'user' OR (agent_token_id IS NULL AND agent_name IS NULL)
    ),
    CONSTRAINT ck_agent_changes_revert_has_target CHECK (
        action <> 'revert' OR reverts_change_id IS NOT NULL
    )
);

CREATE INDEX IF NOT EXISTS idx_agent_changes_user_created
    ON public.agent_changes(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_changes_entity
    ON public.agent_changes(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_agent_changes_user_project_created
    ON public.agent_changes(user_id, project_id, created_at);

CREATE INDEX IF NOT EXISTS idx_agent_changes_user_goal_created
    ON public.agent_changes(user_id, goal_id, created_at);

ALTER TABLE public.agent_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_changes_own_rows" ON public.agent_changes;

CREATE POLICY "agent_changes_own_rows" ON public.agent_changes
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

REVOKE ALL ON public.agent_changes FROM anon, authenticated;

-- No column holds a secret, so every column is readable by the owner.
GRANT SELECT (
    id,
    user_id,
    actor,
    agent_token_id,
    agent_name,
    proposal_id,
    entity_type,
    entity_id,
    project_id,
    goal_id,
    action,
    before,
    after,
    destructive,
    reverts_change_id,
    reverted_at,
    created_at
) ON public.agent_changes TO authenticated;

COMMENT ON TABLE public.agent_changes IS 'History of changes made to goals, tasks, notes and task dependencies by agents (and user reverts); rows older than 365 days are purged daily';
COMMENT ON COLUMN public.agent_changes.agent_name IS 'Copy of the name of the writing token when the change was made; NULL for user changes';
COMMENT ON COLUMN public.agent_changes.proposal_id IS 'Proposal that was accepted to make this change, if any; no foreign key';
COMMENT ON COLUMN public.agent_changes.entity_id IS 'ID of the changed entity; no foreign key, the entity may be deleted later';
COMMENT ON COLUMN public.agent_changes.project_id IS 'Project of the changed entity, for filtering the history; no foreign key';
COMMENT ON COLUMN public.agent_changes.goal_id IS 'Goal of the changed entity, for filtering the history; no foreign key';
COMMENT ON COLUMN public.agent_changes.before IS 'Entity state before the change; NULL for creates; no foreign key';
COMMENT ON COLUMN public.agent_changes.after IS 'Entity state after the change (the changed fields); no foreign key';
COMMENT ON COLUMN public.agent_changes.destructive IS 'TRUE when the change removes information (cancel, overwrite, move, note replace, dependency removal)';
COMMENT ON COLUMN public.agent_changes.reverts_change_id IS 'For action = revert, the change that was reverted; no foreign key';
COMMENT ON COLUMN public.agent_changes.reverted_at IS 'Set when a later change reverted this one';

-- Widen the proposal kinds. The result_type CHECK stays as it is: the new
-- kinds report their result as goal, task or context_note.
ALTER TABLE public.agent_proposals DROP CONSTRAINT IF EXISTS ck_agent_proposals_kind;

ALTER TABLE public.agent_proposals ADD CONSTRAINT ck_agent_proposals_kind CHECK (
    kind IN (
        'goal', 'task', 'quick_task', 'note_append', 'contradiction', 'decision_request', 'experiment',
        'goal_change', 'task_change', 'note_replace'
    )
);
