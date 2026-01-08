-- Migration: Add work_sessions table for Runner/Focus mode
-- Created: 2025-01-08
-- Description: Stores work session data with KPT reflection and checkout information
-- Related Issue: #225

-- Create enum types for work sessions
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'checkout_type') THEN
        CREATE TYPE checkout_type AS ENUM ('manual', 'scheduled', 'overdue', 'interrupted');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'session_decision') THEN
        CREATE TYPE session_decision AS ENUM ('continue', 'switch', 'break', 'complete');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'continue_reason') THEN
        CREATE TYPE continue_reason AS ENUM (
            'good_stopping_point',
            'waiting_for_blocker',
            'need_research',
            'in_flow_state',
            'unexpected_complexity',
            'time_constraint',
            'other'
        );
    END IF;
END$$;

-- Create work_sessions table
CREATE TABLE IF NOT EXISTS work_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,

    -- Timing
    started_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    planned_checkout_at TIMESTAMP WITH TIME ZONE NOT NULL,
    ended_at TIMESTAMP WITH TIME ZONE,

    -- Session outcome
    checkout_type checkout_type,
    decision session_decision,
    continue_reason continue_reason,

    -- KPT reflection (1-2 minutes input)
    kpt_keep TEXT CHECK (length(kpt_keep) <= 500),
    kpt_problem TEXT CHECK (length(kpt_problem) <= 500),
    kpt_try TEXT CHECK (length(kpt_try) <= 500),

    -- Additional metadata
    remaining_estimate_hours DECIMAL(5,2) CHECK (remaining_estimate_hours >= 0),
    planned_outcome TEXT CHECK (length(planned_outcome) <= 500),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_work_sessions_user_id ON work_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_task_id ON work_sessions(task_id);
CREATE INDEX IF NOT EXISTS idx_work_sessions_started_at ON work_sessions(started_at DESC);

-- Partial unique index: 1 user can have at most 1 active session
-- This enforces the constraint at database level
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_sessions_active_unique
    ON work_sessions(user_id)
    WHERE ended_at IS NULL;

-- Add RLS policies for security
ALTER TABLE work_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only access their own sessions (unified policy for all operations)
CREATE POLICY "work_sessions_own_data" ON public.work_sessions
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_sessions TO authenticated;

-- Trigger for automatic updated_at timestamp
DROP TRIGGER IF EXISTS update_work_sessions_updated_at ON work_sessions;
CREATE TRIGGER update_work_sessions_updated_at
    BEFORE UPDATE ON work_sessions
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Comments
COMMENT ON TABLE work_sessions IS 'Runner/Focus実行セッション管理テーブル';
COMMENT ON COLUMN work_sessions.user_id IS 'セッション所有者';
COMMENT ON COLUMN work_sessions.task_id IS '作業対象タスク';
COMMENT ON COLUMN work_sessions.started_at IS 'セッション開始時刻';
COMMENT ON COLUMN work_sessions.planned_checkout_at IS '予定チェックアウト時刻';
COMMENT ON COLUMN work_sessions.ended_at IS 'セッション終了時刻（NULLならアクティブ）';
COMMENT ON COLUMN work_sessions.checkout_type IS 'チェックアウト種別: manual/scheduled/overdue/interrupted';
COMMENT ON COLUMN work_sessions.decision IS 'セッション終了後の判断: continue/switch/break/complete';
COMMENT ON COLUMN work_sessions.continue_reason IS '継続理由（decisionがcontinueの場合）';
COMMENT ON COLUMN work_sessions.kpt_keep IS 'KPT: うまくいったこと';
COMMENT ON COLUMN work_sessions.kpt_problem IS 'KPT: 詰まり/不確実性';
COMMENT ON COLUMN work_sessions.kpt_try IS 'KPT: 次に試すこと';
COMMENT ON COLUMN work_sessions.remaining_estimate_hours IS '残見積時間（時間）';
COMMENT ON COLUMN work_sessions.planned_outcome IS '予定成果';
