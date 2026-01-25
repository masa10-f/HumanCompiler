-- Migration: 015_add_reschedule_tables
-- Description: Add reschedule_suggestions and reschedule_decisions tables for checkout-based rescheduling (Issue #227)
-- Date: 2026-01-24

-- reschedule_suggestions: Stores reschedule proposals generated at checkout
CREATE TABLE IF NOT EXISTS reschedule_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    work_session_id UUID NOT NULL REFERENCES work_sessions(id) ON DELETE CASCADE,
    trigger_type VARCHAR(50) NOT NULL,  -- "checkout", "overdue_recovery"
    trigger_decision VARCHAR(50),        -- The decision made at checkout (continue/switch/break/complete)
    original_schedule_json JSONB NOT NULL,
    proposed_schedule_json JSONB NOT NULL,
    diff_json JSONB NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending/accepted/rejected/expired
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    decided_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT reschedule_suggestions_trigger_type_check CHECK (trigger_type IN ('checkout', 'overdue_recovery')),
    CONSTRAINT reschedule_suggestions_status_check CHECK (status IN ('pending', 'accepted', 'rejected', 'expired'))
);

-- reschedule_decisions: Logs user decisions for learning (Issue #227)
CREATE TABLE IF NOT EXISTS reschedule_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    suggestion_id UUID NOT NULL REFERENCES reschedule_suggestions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted BOOLEAN NOT NULL,
    reason TEXT,
    context_json JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_reschedule_suggestions_user_id ON reschedule_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_reschedule_suggestions_work_session_id ON reschedule_suggestions(work_session_id);
CREATE INDEX IF NOT EXISTS idx_reschedule_suggestions_status ON reschedule_suggestions(status);
CREATE INDEX IF NOT EXISTS idx_reschedule_suggestions_user_status ON reschedule_suggestions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reschedule_decisions_suggestion_id ON reschedule_decisions(suggestion_id);
CREATE INDEX IF NOT EXISTS idx_reschedule_decisions_user_id ON reschedule_decisions(user_id);

-- Enable RLS for reschedule_suggestions
ALTER TABLE reschedule_suggestions ENABLE ROW LEVEL SECURITY;

-- RLS policies for reschedule_suggestions
CREATE POLICY reschedule_suggestions_select_policy ON reschedule_suggestions
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY reschedule_suggestions_insert_policy ON reschedule_suggestions
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY reschedule_suggestions_update_policy ON reschedule_suggestions
    FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY reschedule_suggestions_delete_policy ON reschedule_suggestions
    FOR DELETE
    USING (user_id = auth.uid());

-- Enable RLS for reschedule_decisions
ALTER TABLE reschedule_decisions ENABLE ROW LEVEL SECURITY;

-- RLS policies for reschedule_decisions
CREATE POLICY reschedule_decisions_select_policy ON reschedule_decisions
    FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY reschedule_decisions_insert_policy ON reschedule_decisions
    FOR INSERT
    WITH CHECK (user_id = auth.uid());

CREATE POLICY reschedule_decisions_update_policy ON reschedule_decisions
    FOR UPDATE
    USING (user_id = auth.uid());

CREATE POLICY reschedule_decisions_delete_policy ON reschedule_decisions
    FOR DELETE
    USING (user_id = auth.uid());
