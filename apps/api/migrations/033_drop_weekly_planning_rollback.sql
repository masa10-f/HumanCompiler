-- Rollback: Recreate the empty weekly planning tables dropped by 033
-- Rows deleted by 033 are not restored; reload them from a backup if needed.
-- category is recreated as a checked VARCHAR instead of the dropped enum type;
-- the previous API reads and writes the same string values.

CREATE TABLE IF NOT EXISTS public.weekly_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    week_start_date TIMESTAMP NOT NULL,
    schedule_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT unique_user_week UNIQUE (user_id, week_start_date)
);

CREATE INDEX IF NOT EXISTS idx_weekly_schedules_user_id ON public.weekly_schedules(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_week_start_date ON public.weekly_schedules(week_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_schedules_created_at ON public.weekly_schedules(created_at DESC);

CREATE TABLE IF NOT EXISTS public.weekly_recurring_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    estimate_hours NUMERIC(5, 2) NOT NULL CHECK (estimate_hours > 0),
    category VARCHAR(20) NOT NULL DEFAULT 'other' CHECK (
        category IN (
            'meeting', 'study', 'exercise', 'hobby',
            'admin', 'maintenance', 'review', 'other'
        )
    ),
    is_active BOOLEAN NOT NULL DEFAULT true,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_weekly_recurring_tasks_user_id ON public.weekly_recurring_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_weekly_recurring_tasks_title ON public.weekly_recurring_tasks(title);
CREATE INDEX IF NOT EXISTS idx_weekly_recurring_tasks_created_at ON public.weekly_recurring_tasks(created_at);

ALTER TABLE public.weekly_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_recurring_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "weekly_schedules_own_data" ON public.weekly_schedules;
CREATE POLICY "weekly_schedules_own_data" ON public.weekly_schedules
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

DROP POLICY IF EXISTS "weekly_recurring_tasks_own_data" ON public.weekly_recurring_tasks;
CREATE POLICY "weekly_recurring_tasks_own_data" ON public.weekly_recurring_tasks
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_recurring_tasks TO authenticated;
