-- Rollback: Remove agent proposals
-- Run this after rolling back to the API without the proposal inbox.
-- Pending and decided proposals are deleted with the table; entities already
-- created from accepted proposals are kept.

DROP TABLE IF EXISTS public.agent_proposals;
