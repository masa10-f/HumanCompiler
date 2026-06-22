-- Migration: Add capacity triage tables
-- Date: 2026-06-22
-- Description: Store user capacity settings, generated triage runs, and item audit history.

CREATE TABLE IF NOT EXISTS triage_capacity_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    weekly_capacity_hours DECIMAL(5,2) NOT NULL DEFAULT 40.00 CHECK (weekly_capacity_hours > 0),
    meeting_buffer_hours DECIMAL(5,2) NOT NULL DEFAULT 5.00 CHECK (meeting_buffer_hours >= 0),
    project_allocations_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    inbox_allocation_percent INTEGER NOT NULL DEFAULT 0 CHECK (inbox_allocation_percent >= 0 AND inbox_allocation_percent <= 100),
    work_type_caps_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    cadence_days INTEGER NOT NULL DEFAULT 7 CHECK (cadence_days >= 1 AND cadence_days <= 365),
    auto_generate_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    use_ai_rank_adjustment BOOLEAN NOT NULL DEFAULT FALSE,
    last_auto_triage_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_triage_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'scheduled')),
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'applied', 'partially_applied')),
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS task_triage_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES task_triage_runs(id) ON DELETE CASCADE,
    task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
    quick_task_id UUID REFERENCES quick_tasks(id) ON DELETE SET NULL,
    item_type TEXT NOT NULL CHECK (item_type IN ('task', 'quick_task')),
    title TEXT NOT NULL CHECK (length(title) <= 200),
    description TEXT CHECK (length(description) <= 1000),
    project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
    project_title TEXT CHECK (length(project_title) <= 200),
    goal_id UUID REFERENCES goals(id) ON DELETE SET NULL,
    goal_title TEXT CHECK (length(goal_title) <= 200),
    status_at_generation TEXT NOT NULL CHECK (status_at_generation IN ('pending', 'in_progress', 'completed', 'cancelled')),
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),
    work_type TEXT NOT NULL DEFAULT 'light_work' CHECK (work_type IN ('light_work', 'study', 'focused_work')),
    estimate_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (estimate_hours >= 0),
    remaining_hours DECIMAL(5,2) NOT NULL DEFAULT 0.00 CHECK (remaining_hours >= 0),
    due_date TIMESTAMP WITH TIME ZONE,
    bucket_key TEXT NOT NULL CHECK (length(bucket_key) <= 120),
    bucket_title TEXT NOT NULL CHECK (length(bucket_title) <= 200),
    deterministic_score DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    ai_score_delta DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    ai_reason TEXT CHECK (length(ai_reason) <= 1000),
    final_score DECIMAL(7,2) NOT NULL DEFAULT 0.00,
    reason_codes_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    task_snapshot_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    recommendation TEXT NOT NULL DEFAULT 'keep' CHECK (recommendation IN ('keep', 'cancel')),
    user_override TEXT CHECK (user_override IN ('keep', 'cancel')),
    applied_action TEXT CHECK (applied_action IN ('keep', 'cancel')),
    applied_at TIMESTAMP WITH TIME ZONE,
    apply_error TEXT CHECK (length(apply_error) <= 1000),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT triage_item_has_one_task_source CHECK (
        (task_id IS NOT NULL AND quick_task_id IS NULL AND item_type = 'task')
        OR (task_id IS NULL AND quick_task_id IS NOT NULL AND item_type = 'quick_task')
    )
);

CREATE INDEX IF NOT EXISTS idx_triage_capacity_settings_user_id ON triage_capacity_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_task_triage_runs_user_created ON task_triage_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_triage_runs_status ON task_triage_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_run_id ON task_triage_items(run_id);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_recommendation ON task_triage_items(recommendation);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_task_id ON task_triage_items(task_id);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_quick_task_id ON task_triage_items(quick_task_id);

ALTER TABLE triage_capacity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_triage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_triage_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY triage_capacity_settings_policy
    ON triage_capacity_settings
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY task_triage_runs_policy
    ON task_triage_runs
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY task_triage_items_policy
    ON task_triage_items
    FOR ALL
    USING (
        run_id IN (
            SELECT id FROM task_triage_runs WHERE user_id = auth.uid()
        )
    )
    WITH CHECK (
        run_id IN (
            SELECT id FROM task_triage_runs WHERE user_id = auth.uid()
        )
    );

CREATE TRIGGER update_triage_capacity_settings_updated_at
    BEFORE UPDATE ON triage_capacity_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_task_triage_runs_updated_at
    BEFORE UPDATE ON task_triage_runs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_task_triage_items_updated_at
    BEFORE UPDATE ON task_triage_items
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE triage_capacity_settings IS 'Per-user capacity and cadence settings for capacity triage';
COMMENT ON TABLE task_triage_runs IS 'Generated task triage review batches';
COMMENT ON TABLE task_triage_items IS 'Task-level triage recommendations and apply audit records';
