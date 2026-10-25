-- Rollback: Remove agent audit logs
-- Run this after rolling back to the API without audit logs, and before the
-- rollback of 035 (agent_audit_logs references agent_tokens).
-- The recorded audit rows are deleted with the table.

DROP TABLE IF EXISTS public.agent_audit_logs;
