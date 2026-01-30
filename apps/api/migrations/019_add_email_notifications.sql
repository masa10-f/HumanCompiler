-- Migration: Add email notification settings and log table
-- Issue: #261 - Task deadline email notification feature

-- Add email notification settings columns to user_settings table
ALTER TABLE user_settings
    ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_deadline_reminder_hours INTEGER DEFAULT 24,
    ADD COLUMN IF NOT EXISTS email_overdue_alerts_enabled BOOLEAN DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS email_daily_digest_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS email_daily_digest_hour INTEGER DEFAULT 9;

-- Create email_notification_logs table for tracking sent emails
CREATE TABLE IF NOT EXISTS email_notification_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Target task (either task_id or quick_task_id, or null for digest)
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    quick_task_id UUID REFERENCES quick_tasks(id) ON DELETE SET NULL,

    -- Notification type and status
    notification_type TEXT NOT NULL CHECK (
        notification_type IN ('deadline_reminder', 'overdue_alert', 'daily_digest')
    ),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (
        status IN ('pending', 'sent', 'failed')
    ),
    error_message TEXT,

    -- Timestamps
    sent_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_email_notification_logs_user_id
    ON email_notification_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_notification_logs_task_id
    ON email_notification_logs(task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_notification_logs_quick_task_id
    ON email_notification_logs(quick_task_id) WHERE quick_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_notification_logs_status
    ON email_notification_logs(status, created_at);

-- Composite index for checking duplicate notifications
CREATE INDEX IF NOT EXISTS idx_email_notification_logs_dedup
    ON email_notification_logs(user_id, task_id, notification_type, created_at);
CREATE INDEX IF NOT EXISTS idx_email_notification_logs_dedup_quick
    ON email_notification_logs(user_id, quick_task_id, notification_type, created_at);

-- Enable Row Level Security
ALTER TABLE email_notification_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own notification logs
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'email_notification_logs'
        AND policyname = 'email_notification_logs_user_policy'
    ) THEN
        CREATE POLICY email_notification_logs_user_policy ON email_notification_logs
            FOR ALL USING (user_id = auth.uid());
    END IF;
END $$;

-- Comments for documentation
COMMENT ON TABLE email_notification_logs IS 'Tracks email notifications sent for task deadlines (Issue #261)';
COMMENT ON COLUMN email_notification_logs.notification_type IS 'Type: deadline_reminder, overdue_alert, daily_digest';
COMMENT ON COLUMN email_notification_logs.status IS 'Delivery status: pending, sent, failed';
COMMENT ON COLUMN user_settings.email_notifications_enabled IS 'Master toggle for email notifications';
COMMENT ON COLUMN user_settings.email_deadline_reminder_hours IS 'Hours before deadline to send reminder (1-168)';
COMMENT ON COLUMN user_settings.email_overdue_alerts_enabled IS 'Send alerts when tasks become overdue';
COMMENT ON COLUMN user_settings.email_daily_digest_enabled IS 'Send daily summary of upcoming deadlines';
COMMENT ON COLUMN user_settings.email_daily_digest_hour IS 'Hour of day (0-23) to send daily digest';
