-- Rollback: Remove agent tokens
-- Run this before rolling back to an API without agent tokens.
-- Revocations made in agent_tokens are written back to hook_tokens first, so a
-- token revoked after the migration does not become valid again in the old API.
-- Tokens created after the migration exist only in agent_tokens and stop
-- working; recreate them with the old API.
-- logs.updated_at is kept with its default: clients may already read it, and
-- the old API ignores it.

UPDATE public.hook_tokens h
SET revoked_at = a.revoked_at, updated_at = NOW()
FROM public.agent_tokens a
WHERE a.id = h.id AND a.revoked_at IS NOT NULL AND h.revoked_at IS NULL;

DROP INDEX IF EXISTS public.idx_projects_updated_at_id;
DROP INDEX IF EXISTS public.idx_goals_updated_at_id;
DROP INDEX IF EXISTS public.idx_tasks_updated_at_id;
DROP INDEX IF EXISTS public.idx_quick_tasks_updated_at_id;
DROP INDEX IF EXISTS public.idx_logs_updated_at_id;
DROP INDEX IF EXISTS public.idx_work_sessions_updated_at_id;
DROP INDEX IF EXISTS public.idx_context_notes_updated_at_id;
DROP INDEX IF EXISTS public.idx_daily_plan_documents_updated_at_id;

DROP TRIGGER IF EXISTS update_logs_updated_at ON public.logs;
DROP TRIGGER IF EXISTS update_quick_tasks_updated_at ON public.quick_tasks;
DROP TRIGGER IF EXISTS update_context_notes_updated_at ON public.context_notes;
DROP TRIGGER IF EXISTS update_daily_plan_documents_updated_at ON public.daily_plan_documents;

DROP TABLE IF EXISTS public.agent_tokens;

COMMENT ON TABLE public.hook_tokens IS 'User-scoped hashed tokens for external hook ingestion';
