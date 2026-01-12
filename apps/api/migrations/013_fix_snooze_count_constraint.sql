-- Migration: Fix snooze_count constraint mismatch
-- Issue: #228 Code Review - Database constraint allows 3 but code enforces 2
--
-- Problem: The check constraint allowed snooze_count up to 3 ("with buffer"),
-- but MAX_SNOOZE_COUNT in the code is 2. This creates inconsistency.
-- Fix: Align database constraint with business logic (max 2 snoozes).

-- Drop the existing constraint
ALTER TABLE work_sessions DROP CONSTRAINT IF EXISTS check_snooze_count;

-- Add constraint with correct value matching MAX_SNOOZE_COUNT = 2
ALTER TABLE work_sessions ADD CONSTRAINT check_snooze_count
    CHECK (snooze_count >= 0 AND snooze_count <= 2);

-- Update comment to be accurate
COMMENT ON COLUMN work_sessions.snooze_count IS
    'Number of times user has snoozed checkout (max 2 allowed, enforced by constraint and application)';
