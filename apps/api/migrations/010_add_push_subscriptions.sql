-- Migration: Add push_subscriptions table for Web Push notifications
-- Issue: #228 - Notification/Escalation for checkout reminders

-- Push subscription table for storing Web Push API subscription data
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Web Push API subscription data
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,

    -- Device/browser identification
    user_agent TEXT,
    device_type TEXT CHECK (device_type IN ('desktop', 'mobile', 'tablet')),

    -- Status tracking
    is_active BOOLEAN DEFAULT TRUE,
    last_successful_push TIMESTAMP WITH TIME ZONE,
    failure_count INTEGER DEFAULT 0,

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Unique constraint: one subscription per endpoint per user
    UNIQUE(user_id, endpoint)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id
    ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active
    ON push_subscriptions(user_id) WHERE is_active = TRUE;

-- Enable Row Level Security
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only access their own subscriptions
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE tablename = 'push_subscriptions'
        AND policyname = 'push_subscriptions_user_policy'
    ) THEN
        CREATE POLICY push_subscriptions_user_policy ON push_subscriptions
            FOR ALL USING (user_id = auth.uid());
    END IF;
END $$;

-- Comments for documentation
COMMENT ON TABLE push_subscriptions IS 'Stores Web Push API subscriptions for checkout notifications';
COMMENT ON COLUMN push_subscriptions.endpoint IS 'Web Push API endpoint URL';
COMMENT ON COLUMN push_subscriptions.p256dh_key IS 'P-256 Diffie-Hellman public key for encryption';
COMMENT ON COLUMN push_subscriptions.auth_key IS 'Authentication secret for Web Push';
COMMENT ON COLUMN push_subscriptions.failure_count IS 'Number of consecutive push failures';
