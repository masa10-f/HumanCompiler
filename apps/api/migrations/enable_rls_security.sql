-- Row Level Security Migration for TaskAgent
-- This script enables RLS and creates security policies for all public tables
-- to restrict data access to authenticated users only

-- Enable Row Level Security on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_recurring_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goal_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (for idempotent script)
DROP POLICY IF EXISTS "users_own_data" ON public.users;
DROP POLICY IF EXISTS "projects_own_data" ON public.projects;
DROP POLICY IF EXISTS "goals_via_projects" ON public.goals;
DROP POLICY IF EXISTS "tasks_via_goals" ON public.tasks;
DROP POLICY IF EXISTS "schedules_own_data" ON public.schedules;
DROP POLICY IF EXISTS "weekly_schedules_own_data" ON public.weekly_schedules;
DROP POLICY IF EXISTS "weekly_recurring_tasks_own_data" ON public.weekly_recurring_tasks;
DROP POLICY IF EXISTS "logs_via_tasks" ON public.logs;
DROP POLICY IF EXISTS "user_settings_own_data" ON public.user_settings;
DROP POLICY IF EXISTS "api_usage_logs_own_data" ON public.api_usage_logs;
DROP POLICY IF EXISTS "goal_dependencies_via_goals" ON public.goal_dependencies;
DROP POLICY IF EXISTS "task_dependencies_via_tasks" ON public.task_dependencies;

-- 1. Users table: Users can only access their own record
CREATE POLICY "users_own_data" ON public.users
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = id::text)
    WITH CHECK (auth.uid()::text = id::text);

-- 2. Projects table: Users can only access their own projects
CREATE POLICY "projects_own_data" ON public.projects
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = owner_id::text)
    WITH CHECK (auth.uid()::text = owner_id::text);

-- 3. Goals table: Users can access goals from their own projects
CREATE POLICY "goals_via_projects" ON public.goals
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = goals.project_id
            AND auth.uid()::text = p.owner_id::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects p
            WHERE p.id = goals.project_id
            AND auth.uid()::text = p.owner_id::text
        )
    );

-- 4. Tasks table: Users can access tasks from their own goals/projects
CREATE POLICY "tasks_via_goals" ON public.tasks
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.goals g
            JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = tasks.goal_id
            AND auth.uid()::text = p.owner_id::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.goals g
            JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = tasks.goal_id
            AND auth.uid()::text = p.owner_id::text
        )
    );

-- 5. Schedules table: Users can only access their own schedules
CREATE POLICY "schedules_own_data" ON public.schedules
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

-- 6. Weekly schedules table: Users can only access their own weekly schedules
CREATE POLICY "weekly_schedules_own_data" ON public.weekly_schedules
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

-- 7. Weekly recurring tasks table: Users can only access their own tasks
CREATE POLICY "weekly_recurring_tasks_own_data" ON public.weekly_recurring_tasks
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

-- 8. Logs table: Users can access logs from their own tasks
CREATE POLICY "logs_via_tasks" ON public.logs
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.tasks t
            JOIN public.goals g ON g.id = t.goal_id
            JOIN public.projects p ON p.id = g.project_id
            WHERE t.id = logs.task_id
            AND auth.uid()::text = p.owner_id::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tasks t
            JOIN public.goals g ON g.id = t.goal_id
            JOIN public.projects p ON p.id = g.project_id
            WHERE t.id = logs.task_id
            AND auth.uid()::text = p.owner_id::text
        )
    );

-- 9. User settings table: Users can only access their own settings
CREATE POLICY "user_settings_own_data" ON public.user_settings
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

-- 10. API usage logs table: Users can only access their own usage logs
CREATE POLICY "api_usage_logs_own_data" ON public.api_usage_logs
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

-- 11. Goal dependencies table: Users can access dependencies from their own goals
CREATE POLICY "goal_dependencies_via_goals" ON public.goal_dependencies
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.goals g
            JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = goal_dependencies.goal_id
            AND auth.uid()::text = p.owner_id::text
        )
        AND
        EXISTS (
            SELECT 1 FROM public.goals g
            JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = goal_dependencies.depends_on_goal_id
            AND auth.uid()::text = p.owner_id::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.goals g
            JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = goal_dependencies.goal_id
            AND auth.uid()::text = p.owner_id::text
        )
        AND
        EXISTS (
            SELECT 1 FROM public.goals g
            JOIN public.projects p ON p.id = g.project_id
            WHERE g.id = goal_dependencies.depends_on_goal_id
            AND auth.uid()::text = p.owner_id::text
        )
    );

-- 12. Task dependencies table: Users can access dependencies from their own tasks
CREATE POLICY "task_dependencies_via_tasks" ON public.task_dependencies
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.tasks t
            JOIN public.goals g ON g.id = t.goal_id
            JOIN public.projects p ON p.id = g.project_id
            WHERE t.id = task_dependencies.task_id
            AND auth.uid()::text = p.owner_id::text
        )
        AND
        EXISTS (
            SELECT 1 FROM public.tasks t
            JOIN public.goals g ON g.id = t.goal_id
            JOIN public.projects p ON p.id = g.project_id
            WHERE t.id = task_dependencies.depends_on_task_id
            AND auth.uid()::text = p.owner_id::text
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tasks t
            JOIN public.goals g ON g.id = t.goal_id
            JOIN public.projects p ON p.id = g.project_id
            WHERE t.id = task_dependencies.task_id
            AND auth.uid()::text = p.owner_id::text
        )
        AND
        EXISTS (
            SELECT 1 FROM public.tasks t
            JOIN public.goals g ON g.id = t.goal_id
            JOIN public.projects p ON p.id = g.project_id
            WHERE t.id = task_dependencies.depends_on_task_id
            AND auth.uid()::text = p.owner_id::text
        )
    );

-- Grant necessary permissions to authenticated users
GRANT SELECT, INSERT, UPDATE, DELETE ON public.users TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goals TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_schedules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.weekly_recurring_tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.api_usage_logs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.goal_dependencies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.task_dependencies TO authenticated;

-- Enable RLS for the auth schema tables if needed (Supabase managed)
-- Note: auth.users is managed by Supabase and RLS is already enabled

-- Verification queries (commented for reference)
-- SELECT schemaname, tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual FROM pg_policies WHERE schemaname = 'public';
