-- Migration: Add agent tokens and copy hook tokens
-- Date: 2026-10-18
-- Description: Scoped agent tokens for the Agent Gateway. Copies every hook
-- token (including revoked ones) into agent_tokens with the quick_tasks:write
-- scope, adds logs.updated_at, keeps updated_at current with triggers, and adds
-- (updated_at, id) indexes for incremental reads.
-- Additive only: the API deployed before this migration keeps working on the
-- new schema (logs.updated_at has a default). Do not create or revoke tokens
-- between applying this migration and finishing the deploy; the old API still
-- writes hook_tokens, and those changes are not copied.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.hook_tokens'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.hook_tokens is missing. Apply 024_add_hook_tokens.sql before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.logs'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.logs is missing. Apply earlier migrations before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.quick_tasks'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.quick_tasks is missing. Apply 018_add_quick_tasks.sql before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.context_notes'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.context_notes is missing. Apply 017_add_context_notes_simple.sql before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.daily_plan_documents'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.daily_plan_documents is missing. Apply 027_add_daily_plan_documents.sql before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.projects'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.projects is missing. Apply earlier migrations before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.goals'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.goals is missing. Apply earlier migrations before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.tasks'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.tasks is missing. Apply earlier migrations before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regclass(''public.work_sessions'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.work_sessions is missing. Apply 007_add_work_sessions.sql before 035_add_agent_tokens.sql.'';
    END IF;
    IF to_regprocedure(''public.update_updated_at_column()'') IS NULL THEN
        RAISE EXCEPTION ''Required function public.update_updated_at_column() is missing. Apply earlier migrations before 035_add_agent_tokens.sql.'';
    END IF;
END
';

-- 1. agent_tokens

CREATE TABLE IF NOT EXISTS public.agent_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(500),
    scopes TEXT[] NOT NULL CHECK (cardinality(scopes) > 0),
    token_hash CHAR(64) NOT NULL UNIQUE,
    token_prefix VARCHAR(32) NOT NULL,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_user_id
    ON public.agent_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_active_by_user
    ON public.agent_tokens(user_id, created_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_agent_tokens_token_hash
    ON public.agent_tokens(token_hash)
    WHERE revoked_at IS NULL;

ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_tokens_own_metadata" ON public.agent_tokens;

CREATE POLICY "agent_tokens_own_metadata" ON public.agent_tokens
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

REVOKE ALL ON public.agent_tokens FROM anon, authenticated;

GRANT SELECT (
    id,
    user_id,
    name,
    description,
    scopes,
    token_prefix,
    last_used_at,
    revoked_at,
    created_at,
    updated_at
) ON public.agent_tokens TO authenticated;

DROP TRIGGER IF EXISTS update_agent_tokens_updated_at ON public.agent_tokens;
CREATE TRIGGER update_agent_tokens_updated_at
    BEFORE UPDATE ON public.agent_tokens
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.agent_tokens IS 'User-scoped hashed tokens for agents, limited by scopes';
COMMENT ON COLUMN public.agent_tokens.user_id IS 'Owner of the agent token';
COMMENT ON COLUMN public.agent_tokens.name IS 'User-facing token label';
COMMENT ON COLUMN public.agent_tokens.description IS 'Optional purpose or device that uses the token';
COMMENT ON COLUMN public.agent_tokens.scopes IS 'Granted scopes; fixed when the token is created';
COMMENT ON COLUMN public.agent_tokens.token_hash IS 'SHA-256 hash of the agent token secret';
COMMENT ON COLUMN public.agent_tokens.token_prefix IS 'Non-secret public token id shown in the UI';
COMMENT ON COLUMN public.agent_tokens.last_used_at IS 'Most recent successful use, updated at most every 5 minutes';
COMMENT ON COLUMN public.agent_tokens.revoked_at IS 'Set when the token is revoked';

-- 2. Copy hook tokens, including revoked ones. Already copied rows are kept as
-- they are, so a second run does not undo revocations made in agent_tokens.

INSERT INTO public.agent_tokens (id, user_id, name, scopes, token_hash, token_prefix,
                                 last_used_at, revoked_at, created_at, updated_at)
SELECT h.id, h.user_id, h.name, ARRAY['quick_tasks:write'], h.token_hash,
       h.token_prefix, h.last_used_at, h.revoked_at,
       COALESCE(h.created_at, NOW()), COALESCE(h.updated_at, h.created_at, NOW())
FROM public.hook_tokens h
ON CONFLICT (id) DO NOTHING;

-- 3. logs.updated_at: add, backfill, then set the default and NOT NULL, so
-- existing rows get created_at rather than the time of this migration.

ALTER TABLE public.logs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE public.logs SET updated_at = COALESCE(created_at, NOW()) WHERE updated_at IS NULL;
ALTER TABLE public.logs ALTER COLUMN updated_at SET DEFAULT NOW(),
                        ALTER COLUMN updated_at SET NOT NULL;

-- 4. Keep updated_at current on every write path.

DROP TRIGGER IF EXISTS update_logs_updated_at ON public.logs;
CREATE TRIGGER update_logs_updated_at
    BEFORE UPDATE ON public.logs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_quick_tasks_updated_at ON public.quick_tasks;
CREATE TRIGGER update_quick_tasks_updated_at
    BEFORE UPDATE ON public.quick_tasks
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_context_notes_updated_at ON public.context_notes;
CREATE TRIGGER update_context_notes_updated_at
    BEFORE UPDATE ON public.context_notes
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_daily_plan_documents_updated_at ON public.daily_plan_documents;
CREATE TRIGGER update_daily_plan_documents_updated_at
    BEFORE UPDATE ON public.daily_plan_documents
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 5. Keyset pagination on (updated_at, id) for incremental reads.

CREATE INDEX IF NOT EXISTS idx_projects_updated_at_id ON public.projects(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_goals_updated_at_id ON public.goals(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_tasks_updated_at_id ON public.tasks(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_quick_tasks_updated_at_id ON public.quick_tasks(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_logs_updated_at_id ON public.logs(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_updated_at_id ON public.work_sessions(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_context_notes_updated_at_id ON public.context_notes(updated_at, id);
CREATE INDEX IF NOT EXISTS idx_daily_plan_documents_updated_at_id ON public.daily_plan_documents(updated_at, id);

-- 6. hook_tokens stays until a later migration drops it.

COMMENT ON TABLE public.hook_tokens IS 'DEPRECATED: migrated to agent_tokens (035). Not read or written since the Agent Gateway PR1; dropped in a later migration.';
