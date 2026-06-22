-- Migration: Add capacity triage tables
-- Date: 2026-06-22
-- Description: Store user capacity settings, generated triage runs, and item audit history.

CREATE TABLE IF NOT EXISTS public.triage_capacity_settings (
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

CREATE TABLE IF NOT EXISTS public.task_triage_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'scheduled')),
    status TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready', 'applied', 'partially_applied')),
    summary_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.task_triage_items (
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
    CONSTRAINT triage_item_source_shape CHECK (
        (item_type = 'task' AND quick_task_id IS NULL)
        OR (item_type = 'quick_task' AND task_id IS NULL AND project_id IS NULL AND goal_id IS NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_triage_capacity_settings_user_id ON public.triage_capacity_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_task_triage_runs_user_created ON public.task_triage_runs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_triage_runs_status ON public.task_triage_runs(status);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_run_id ON public.task_triage_items(run_id);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_recommendation ON public.task_triage_items(recommendation);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_task_id ON public.task_triage_items(task_id);
CREATE INDEX IF NOT EXISTS idx_task_triage_items_quick_task_id ON public.task_triage_items(quick_task_id);

ALTER TABLE public.triage_capacity_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_triage_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_triage_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS triage_capacity_settings_policy ON public.triage_capacity_settings;
DROP POLICY IF EXISTS task_triage_runs_policy ON public.task_triage_runs;
DROP POLICY IF EXISTS task_triage_items_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_select_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_insert_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_update_policy ON public.task_triage_items;
DROP POLICY IF EXISTS task_triage_items_delete_policy ON public.task_triage_items;

CREATE POLICY triage_capacity_settings_policy
    ON public.triage_capacity_settings
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY task_triage_runs_policy
    ON public.task_triage_runs
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY task_triage_items_select_policy
    ON public.task_triage_items
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.task_triage_runs r
            WHERE r.id = task_triage_items.run_id
            AND auth.uid()::text = r.user_id::text
        )
    );

CREATE POLICY task_triage_items_insert_policy
    ON public.task_triage_items
    FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.task_triage_runs r
            WHERE r.id = task_triage_items.run_id
            AND auth.uid()::text = r.user_id::text
        )
        AND (
            (
                item_type = 'task'
                AND task_id IS NOT NULL
                AND quick_task_id IS NULL
                AND EXISTS (
                    SELECT 1 FROM public.tasks t
                    JOIN public.goals g ON g.id = t.goal_id
                    JOIN public.projects p ON p.id = g.project_id
                    WHERE t.id = task_triage_items.task_id
                    AND auth.uid()::text = p.owner_id::text
                )
                AND (
                    project_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM public.projects p
                        WHERE p.id = task_triage_items.project_id
                        AND auth.uid()::text = p.owner_id::text
                    )
                )
                AND (
                    goal_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM public.goals g
                        JOIN public.projects p ON p.id = g.project_id
                        WHERE g.id = task_triage_items.goal_id
                        AND auth.uid()::text = p.owner_id::text
                    )
                )
            )
            OR (
                item_type = 'quick_task'
                AND task_id IS NULL
                AND quick_task_id IS NOT NULL
                AND project_id IS NULL
                AND goal_id IS NULL
                AND EXISTS (
                    SELECT 1 FROM public.quick_tasks q
                    WHERE q.id = task_triage_items.quick_task_id
                    AND auth.uid()::text = q.owner_id::text
                )
            )
        )
    );

CREATE POLICY task_triage_items_update_policy
    ON public.task_triage_items
    FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.task_triage_runs r
            WHERE r.id = task_triage_items.run_id
            AND auth.uid()::text = r.user_id::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.task_triage_runs r
            WHERE r.id = task_triage_items.run_id
            AND auth.uid()::text = r.user_id::text
        )
        AND (
            (
                item_type = 'task'
                AND quick_task_id IS NULL
                AND (
                    task_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM public.tasks t
                        JOIN public.goals g ON g.id = t.goal_id
                        JOIN public.projects p ON p.id = g.project_id
                        WHERE t.id = task_triage_items.task_id
                        AND auth.uid()::text = p.owner_id::text
                    )
                )
                AND (
                    project_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM public.projects p
                        WHERE p.id = task_triage_items.project_id
                        AND auth.uid()::text = p.owner_id::text
                    )
                )
                AND (
                    goal_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM public.goals g
                        JOIN public.projects p ON p.id = g.project_id
                        WHERE g.id = task_triage_items.goal_id
                        AND auth.uid()::text = p.owner_id::text
                    )
                )
            )
            OR (
                item_type = 'quick_task'
                AND task_id IS NULL
                AND project_id IS NULL
                AND goal_id IS NULL
                AND (
                    quick_task_id IS NULL
                    OR EXISTS (
                        SELECT 1 FROM public.quick_tasks q
                        WHERE q.id = task_triage_items.quick_task_id
                        AND auth.uid()::text = q.owner_id::text
                    )
                )
            )
        )
    );

CREATE POLICY task_triage_items_delete_policy
    ON public.task_triage_items
    FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.task_triage_runs r
            WHERE r.id = task_triage_items.run_id
            AND auth.uid()::text = r.user_id::text
        )
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON public.triage_capacity_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_triage_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_triage_items TO authenticated;

DROP TRIGGER IF EXISTS update_triage_capacity_settings_updated_at ON public.triage_capacity_settings;
CREATE TRIGGER update_triage_capacity_settings_updated_at
    BEFORE UPDATE ON public.triage_capacity_settings
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_triage_runs_updated_at ON public.task_triage_runs;
CREATE TRIGGER update_task_triage_runs_updated_at
    BEFORE UPDATE ON public.task_triage_runs
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_task_triage_items_updated_at ON public.task_triage_items;
CREATE TRIGGER update_task_triage_items_updated_at
    BEFORE UPDATE ON public.task_triage_items
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.triage_capacity_settings IS 'Per-user capacity and cadence settings for capacity triage';
COMMENT ON TABLE public.task_triage_runs IS 'Generated task triage review batches';
COMMENT ON TABLE public.task_triage_items IS 'Task-level triage recommendations and apply audit records';
