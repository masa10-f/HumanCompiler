-- Migration: Add hook tokens for external quick task ingestion
-- Created: 2026-07-07
-- Description: User-scoped hook tokens for creating quick tasks from external tools

CREATE TABLE IF NOT EXISTS public.hook_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    token_hash CHAR(64) NOT NULL UNIQUE,
    token_prefix VARCHAR(16) NOT NULL,
    last_used_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hook_tokens_user_id
    ON public.hook_tokens(user_id);

CREATE INDEX IF NOT EXISTS idx_hook_tokens_active_by_user
    ON public.hook_tokens(user_id, created_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_hook_tokens_token_hash
    ON public.hook_tokens(token_hash)
    WHERE revoked_at IS NULL;

ALTER TABLE public.hook_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hook_tokens_own_data" ON public.hook_tokens
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

COMMENT ON TABLE public.hook_tokens IS 'User-scoped hashed tokens for external hook ingestion';
COMMENT ON COLUMN public.hook_tokens.user_id IS 'Owner of the hook token';
COMMENT ON COLUMN public.hook_tokens.name IS 'User-facing token label';
COMMENT ON COLUMN public.hook_tokens.token_hash IS 'SHA-256 hash of the hook token secret';
COMMENT ON COLUMN public.hook_tokens.token_prefix IS 'Non-secret token prefix shown in the UI';
COMMENT ON COLUMN public.hook_tokens.last_used_at IS 'Most recent successful hook use';
COMMENT ON COLUMN public.hook_tokens.revoked_at IS 'Set when the token is revoked';
