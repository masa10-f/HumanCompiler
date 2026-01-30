-- Migration: Add quick_tasks table for unclassified tasks
-- Created: 2026-01-30
-- Description: Quick tasks are standalone tasks that don't belong to any project/goal

-- Create quick_tasks table
CREATE TABLE IF NOT EXISTS public.quick_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Owner (for RLS)
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Task fields (same as regular tasks but without goal_id)
    title VARCHAR(200) NOT NULL,
    description VARCHAR(1000),
    estimate_hours DECIMAL(5,2) NOT NULL DEFAULT 0.50 CHECK (estimate_hours > 0),
    due_date TIMESTAMP WITH TIME ZONE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    work_type VARCHAR(20) NOT NULL DEFAULT 'light_work' CHECK (work_type IN ('light_work', 'study', 'focused_work')),
    priority INTEGER NOT NULL DEFAULT 3 CHECK (priority >= 1 AND priority <= 5),

    -- Timestamps
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_quick_tasks_owner_id ON public.quick_tasks(owner_id);
CREATE INDEX IF NOT EXISTS idx_quick_tasks_status ON public.quick_tasks(status);
CREATE INDEX IF NOT EXISTS idx_quick_tasks_due_date ON public.quick_tasks(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quick_tasks_priority ON public.quick_tasks(priority);
CREATE INDEX IF NOT EXISTS idx_quick_tasks_owner_status ON public.quick_tasks(owner_id, status);

-- Enable Row Level Security
ALTER TABLE public.quick_tasks ENABLE ROW LEVEL SECURITY;

-- RLS policy: Users can only access their own quick tasks
CREATE POLICY "quick_tasks_own_data" ON public.quick_tasks
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = owner_id::text)
    WITH CHECK (auth.uid()::text = owner_id::text);

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.quick_tasks TO authenticated;

-- Add comments
COMMENT ON TABLE public.quick_tasks IS 'Unclassified tasks that do not belong to any project or goal';
COMMENT ON COLUMN public.quick_tasks.owner_id IS 'Owner of the quick task, used for RLS';
COMMENT ON COLUMN public.quick_tasks.title IS 'Task title (1-200 characters)';
COMMENT ON COLUMN public.quick_tasks.description IS 'Optional task description (max 1000 characters)';
COMMENT ON COLUMN public.quick_tasks.estimate_hours IS 'Estimated hours to complete (default 0.5)';
COMMENT ON COLUMN public.quick_tasks.due_date IS 'Optional due date';
COMMENT ON COLUMN public.quick_tasks.status IS 'Task status: pending, in_progress, completed, cancelled';
COMMENT ON COLUMN public.quick_tasks.work_type IS 'Work type for scheduling: light_work, study, focused_work';
COMMENT ON COLUMN public.quick_tasks.priority IS 'Priority level 1-5 (1=highest, 5=lowest)';
