-- Migration: Add notification-related fields to work_sessions table
-- Issue: #228 - Notification/Escalation for checkout reminders

-- Snooze tracking columns
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS snooze_count INTEGER DEFAULT 0;
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS last_snooze_at TIMESTAMP WITH TIME ZONE;

-- Notification state tracking columns
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS notification_5min_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS notification_checkout_sent BOOLEAN DEFAULT FALSE;
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS notification_overdue_sent BOOLEAN DEFAULT FALSE;

-- Unresponsive session tracking
ALTER TABLE work_sessions ADD COLUMN IF NOT EXISTS marked_unresponsive_at TIMESTAMP WITH TIME ZONE;

-- Constraint: Limit snooze count to 3 (with some buffer beyond the 2 allowed)
-- Using DO block to check if constraint exists before adding
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE table_name = 'work_sessions'
        AND constraint_name = 'check_snooze_count'
    ) THEN
        ALTER TABLE work_sessions ADD CONSTRAINT check_snooze_count
            CHECK (snooze_count >= 0 AND snooze_count <= 3);
    END IF;
END $$;

-- Index for finding unresponsive sessions efficiently
CREATE INDEX IF NOT EXISTS idx_work_sessions_unresponsive
    ON work_sessions(user_id, marked_unresponsive_at)
    WHERE marked_unresponsive_at IS NOT NULL AND ended_at IS NULL;

-- Comments for documentation
COMMENT ON COLUMN work_sessions.snooze_count IS 'Number of times user has snoozed checkout (max 2 allowed)';
COMMENT ON COLUMN work_sessions.last_snooze_at IS 'Timestamp of the last snooze action';
COMMENT ON COLUMN work_sessions.notification_5min_sent IS 'Whether the 5-minute warning notification was sent';
COMMENT ON COLUMN work_sessions.notification_checkout_sent IS 'Whether the checkout time notification was sent';
COMMENT ON COLUMN work_sessions.notification_overdue_sent IS 'Whether the overdue notification was sent';
COMMENT ON COLUMN work_sessions.marked_unresponsive_at IS 'When session was marked as unresponsive (10 min after checkout time)';
