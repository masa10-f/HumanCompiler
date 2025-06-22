-- Enable Row Level Security
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logs ENABLE ROW LEVEL SECURITY;

-- Users table policies
CREATE POLICY "Users can read own data" ON public.users
    FOR SELECT USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update own data" ON public.users
    FOR UPDATE USING (auth.uid()::text = id::text);

-- Projects table policies
CREATE POLICY "Users can read own projects" ON public.projects
    FOR SELECT USING (auth.uid()::text = owner_id::text);

CREATE POLICY "Users can create own projects" ON public.projects
    FOR INSERT WITH CHECK (auth.uid()::text = owner_id::text);

CREATE POLICY "Users can update own projects" ON public.projects
    FOR UPDATE USING (auth.uid()::text = owner_id::text);

CREATE POLICY "Users can delete own projects" ON public.projects
    FOR DELETE USING (auth.uid()::text = owner_id::text);

-- Goals table policies
CREATE POLICY "Users can read goals from own projects" ON public.goals
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.projects 
            WHERE projects.id = goals.project_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can create goals for own projects" ON public.goals
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.projects 
            WHERE projects.id = goals.project_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can update goals from own projects" ON public.goals
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.projects 
            WHERE projects.id = goals.project_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can delete goals from own projects" ON public.goals
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.projects 
            WHERE projects.id = goals.project_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

-- Tasks table policies
CREATE POLICY "Users can read tasks from own goals" ON public.tasks
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.goals 
            JOIN public.projects ON projects.id = goals.project_id
            WHERE goals.id = tasks.goal_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can create tasks for own goals" ON public.tasks
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.goals 
            JOIN public.projects ON projects.id = goals.project_id
            WHERE goals.id = tasks.goal_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can update tasks from own goals" ON public.tasks
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.goals 
            JOIN public.projects ON projects.id = goals.project_id
            WHERE goals.id = tasks.goal_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can delete tasks from own goals" ON public.tasks
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.goals 
            JOIN public.projects ON projects.id = goals.project_id
            WHERE goals.id = tasks.goal_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

-- Schedules table policies
CREATE POLICY "Users can read own schedules" ON public.schedules
    FOR SELECT USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can create own schedules" ON public.schedules
    FOR INSERT WITH CHECK (auth.uid()::text = user_id::text);

CREATE POLICY "Users can update own schedules" ON public.schedules
    FOR UPDATE USING (auth.uid()::text = user_id::text);

CREATE POLICY "Users can delete own schedules" ON public.schedules
    FOR DELETE USING (auth.uid()::text = user_id::text);

-- Logs table policies
CREATE POLICY "Users can read logs from own tasks" ON public.logs
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.tasks 
            JOIN public.goals ON goals.id = tasks.goal_id
            JOIN public.projects ON projects.id = goals.project_id
            WHERE tasks.id = logs.task_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can create logs for own tasks" ON public.logs
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tasks 
            JOIN public.goals ON goals.id = tasks.goal_id
            JOIN public.projects ON projects.id = goals.project_id
            WHERE tasks.id = logs.task_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can update logs from own tasks" ON public.logs
    FOR UPDATE USING (
        EXISTS (
            SELECT 1 FROM public.tasks 
            JOIN public.goals ON goals.id = tasks.goal_id
            JOIN public.projects ON projects.id = goals.project_id
            WHERE tasks.id = logs.task_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );

CREATE POLICY "Users can delete logs from own tasks" ON public.logs
    FOR DELETE USING (
        EXISTS (
            SELECT 1 FROM public.tasks 
            JOIN public.goals ON goals.id = tasks.goal_id
            JOIN public.projects ON projects.id = goals.project_id
            WHERE tasks.id = logs.task_id 
            AND projects.owner_id::text = auth.uid()::text
        )
    );