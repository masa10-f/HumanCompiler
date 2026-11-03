-- Migration: Add agent proposals
-- Date: 2026-11-02
-- Description: Creates agent_proposals, the inbox of changes that agents propose
-- through the Agent Gateway and the user accepts, edits or rejects in the web UI.
-- payload keeps what the agent sent; final_payload keeps what the user approved.
-- Additive only: the API deployed before this migration does not know the
-- table and keeps working.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 039_add_agent_proposals.sql.'';
    END IF;
    IF to_regclass(''public.agent_tokens'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.agent_tokens is missing. Apply 035_add_agent_tokens.sql before 039_add_agent_proposals.sql.'';
    END IF;
    IF to_regprocedure(''public.update_updated_at_column()'') IS NULL THEN
        RAISE EXCEPTION ''Required function public.update_updated_at_column() is missing. Apply earlier migrations before 039_add_agent_proposals.sql.'';
    END IF;
END
';

CREATE TABLE IF NOT EXISTS public.agent_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    token_id UUID REFERENCES public.agent_tokens(id) ON DELETE SET NULL,
    agent_name VARCHAR(100) NOT NULL,
    kind TEXT NOT NULL,
    title VARCHAR(200) NOT NULL,
    rationale TEXT NOT NULL DEFAULT '',
    payload JSONB NOT NULL,
    final_payload JSONB,
    sources JSONB NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key VARCHAR(200) NOT NULL,
    project_id UUID,
    status TEXT NOT NULL DEFAULT 'pending',
    reject_category TEXT,
    decision_note TEXT,
    decision_option SMALLINT,
    result_type TEXT,
    result_id UUID,
    decided_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT ck_agent_proposals_kind CHECK (
        kind IN ('goal', 'task', 'quick_task', 'note_append', 'contradiction', 'decision_request', 'experiment')
    ),
    CONSTRAINT ck_agent_proposals_status CHECK (
        status IN ('pending', 'accepted', 'edited', 'rejected')
    ),
    CONSTRAINT ck_agent_proposals_reject_category CHECK (
        reject_category IS NULL
        OR reject_category IN ('duplicate', 'wrong', 'not_valuable', 'not_now', 'other')
    ),
    CONSTRAINT ck_agent_proposals_rejected_has_category CHECK (
        status <> 'rejected' OR reject_category IS NOT NULL
    ),
    CONSTRAINT ck_agent_proposals_result_type CHECK (
        result_type IS NULL
        OR result_type IN ('goal', 'task', 'quick_task', 'context_note')
    ),
    CONSTRAINT ck_agent_proposals_decision_note_length CHECK (
        decision_note IS NULL OR char_length(decision_note) <= 4000
    ),
    CONSTRAINT ck_agent_proposals_title_nonempty CHECK (char_length(title) >= 1),
    CONSTRAINT ck_agent_proposals_idempotency_key_nonempty CHECK (char_length(idempotency_key) >= 1),
    CONSTRAINT uq_agent_proposals_user_idempotency UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_proposals_user_status_created
    ON public.agent_proposals(user_id, status, created_at DESC);

-- Keyset pagination for incremental reads.
CREATE INDEX IF NOT EXISTS idx_agent_proposals_user_updated
    ON public.agent_proposals(user_id, updated_at, id);

ALTER TABLE public.agent_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_proposals_own_rows" ON public.agent_proposals;

CREATE POLICY "agent_proposals_own_rows" ON public.agent_proposals
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

REVOKE ALL ON public.agent_proposals FROM anon, authenticated;

-- No column holds a secret, so every column is readable by the owner.
GRANT SELECT (
    id,
    user_id,
    token_id,
    agent_name,
    kind,
    title,
    rationale,
    payload,
    final_payload,
    sources,
    idempotency_key,
    project_id,
    status,
    reject_category,
    decision_note,
    decision_option,
    result_type,
    result_id,
    decided_at,
    created_at,
    updated_at
) ON public.agent_proposals TO authenticated;

DROP TRIGGER IF EXISTS update_agent_proposals_updated_at ON public.agent_proposals;
CREATE TRIGGER update_agent_proposals_updated_at
    BEFORE UPDATE ON public.agent_proposals
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.agent_proposals IS 'Changes proposed by agents, waiting for the user to accept, edit or reject';
COMMENT ON COLUMN public.agent_proposals.agent_name IS 'Copy of the name of the sending token at intake, chosen by the user; not supplied by the agent';
COMMENT ON COLUMN public.agent_proposals.payload IS 'What the agent sent, validated and normalised at intake; never modified after creation';
COMMENT ON COLUMN public.agent_proposals.final_payload IS 'Payload used at accept (the edited one if the user edited it); set on every accept, NULL while pending and on reject';
COMMENT ON COLUMN public.agent_proposals.project_id IS 'Project the proposal belongs to, derived from the payload; no foreign key, used for filtering only';
COMMENT ON COLUMN public.agent_proposals.result_id IS 'ID of the entity created on accept; no foreign key, the entity may be deleted later';
