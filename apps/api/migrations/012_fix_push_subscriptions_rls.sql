-- Migration: Fix RLS policy security hole in push_subscriptions table
-- Issue: #228 Code Review - Missing WITH CHECK clause
--
-- Problem: The existing policy only has USING clause, allowing users to
-- INSERT/UPDATE records with a different user_id (security vulnerability).
-- Fix: Add WITH CHECK clause to enforce user_id = auth.uid() on writes.

-- Drop the existing policy
DROP POLICY IF EXISTS push_subscriptions_user_policy ON push_subscriptions;

-- Recreate with proper WITH CHECK clause for INSERT/UPDATE protection
CREATE POLICY push_subscriptions_user_policy ON push_subscriptions
    FOR ALL
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

-- Comment for documentation
COMMENT ON POLICY push_subscriptions_user_policy ON push_subscriptions IS
    'RLS policy ensuring users can only access and modify their own push subscriptions';
