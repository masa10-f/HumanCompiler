-- Migration: Drop hook_tokens
-- Date: 2026-10-27
-- Description: Drops the legacy hook_tokens table. Migration 035 already
-- copied every row into agent_tokens, and since PR4b no code reads or writes
-- hook_tokens.
-- There is no rollback. After this migration 035_add_agent_tokens_rollback.sql
-- can no longer be applied either, because its first UPDATE reads
-- public.hook_tokens. Take a backup first if you want to keep the rows.
-- Refuses to run while public.agent_tokens is missing, so the rows are never
-- dropped before 035 has copied them. DROP TABLE has no CASCADE: a view or
-- foreign key that still depends on hook_tokens makes the migration fail
-- instead of being dropped silently.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- The DO body is single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes.

DO '
BEGIN
    IF to_regclass(''public.hook_tokens'') IS NOT NULL
       AND to_regclass(''public.agent_tokens'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.agent_tokens is missing. Apply 035_add_agent_tokens.sql before 038_drop_hook_tokens.sql.'';
    END IF;
END
';

DROP TABLE IF EXISTS public.hook_tokens;
