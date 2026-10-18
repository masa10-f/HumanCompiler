-- Migration: Add agent audit logs
-- Date: 2026-10-19
-- Description: Creates agent_audit_logs, one row per request to the Agent
-- Gateway: token, route template, required scope, status, duration and client IP.
-- Request bodies, query values and token secrets are never stored.
-- Additive only: the API deployed before this migration does not know the
-- table and keeps working.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.users'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.users is missing. Apply earlier migrations before 036_add_agent_audit_logs.sql.'';
    END IF;
    IF to_regclass(''public.agent_tokens'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.agent_tokens is missing. Apply 035_add_agent_tokens.sql before 036_add_agent_audit_logs.sql.'';
    END IF;
END
';

CREATE TABLE IF NOT EXISTS public.agent_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    token_id UUID REFERENCES public.agent_tokens(id) ON DELETE SET NULL,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    token_prefix VARCHAR(32),
    method VARCHAR(10) NOT NULL,
    route VARCHAR(200) NOT NULL,
    required_scope VARCHAR(50),
    status_code SMALLINT NOT NULL,
    duration_ms INTEGER NOT NULL,
    client_ip VARCHAR(45),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_user_created
    ON public.agent_audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_audit_logs_token_created
    ON public.agent_audit_logs(token_id, created_at DESC);

ALTER TABLE public.agent_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_audit_logs_own_rows" ON public.agent_audit_logs;

CREATE POLICY "agent_audit_logs_own_rows" ON public.agent_audit_logs
    FOR SELECT
    TO authenticated
    USING (auth.uid()::text = user_id::text);

REVOKE ALL ON public.agent_audit_logs FROM anon, authenticated;

GRANT SELECT (
    id,
    token_id,
    user_id,
    token_prefix,
    method,
    route,
    required_scope,
    status_code,
    duration_ms,
    client_ip,
    created_at
) ON public.agent_audit_logs TO authenticated;

COMMENT ON TABLE public.agent_audit_logs IS 'One row per Agent Gateway request; deleted after 90 days';
COMMENT ON COLUMN public.agent_audit_logs.token_id IS 'Agent token used; NULL when authentication failed or the token was deleted';
COMMENT ON COLUMN public.agent_audit_logs.user_id IS 'Token owner; NULL when authentication failed';
COMMENT ON COLUMN public.agent_audit_logs.token_prefix IS 'Validated display prefix; NULL when the presented token is malformed';
COMMENT ON COLUMN public.agent_audit_logs.route IS 'Route template; never contains IDs, query values or bodies';
COMMENT ON COLUMN public.agent_audit_logs.required_scope IS 'Scope the route requires, if any';
COMMENT ON COLUMN public.agent_audit_logs.status_code IS 'HTTP status code returned';
COMMENT ON COLUMN public.agent_audit_logs.duration_ms IS 'Time taken to handle the request, in milliseconds';
COMMENT ON COLUMN public.agent_audit_logs.client_ip IS 'Client IP address as seen by the API';
