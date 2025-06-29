# Supabase データベース設定手順書

## 現在の状況
- ✅ DATABASE_URL のエンコーディングは正しい: `VxnZc8.cn%266G%3F`
- ✅ Supabase REST API の接続は正常
- ❌ データベーステーブルが未作成

## 📋 解決手順

### 1. Supabase Dashboard にアクセス
1. ブラウザで [https://supabase.com/dashboard](https://supabase.com/dashboard) を開く
2. プロジェクト `vmnzbdfatpckhqegkntk` を選択

### 2. SQL Editor でテーブル作成
1. 左サイドバーから **SQL Editor** をクリック
2. **New query** ボタンをクリック
3. 以下のSQL全体をコピー&ペーストして実行

```sql
-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create users table (extends auth.users)
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email TEXT UNIQUE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create projects table
CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create goals table
CREATE TABLE IF NOT EXISTS public.goals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    estimate_hours DECIMAL(5,2) NOT NULL CHECK (estimate_hours > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create tasks table
CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    goal_id UUID NOT NULL REFERENCES public.goals(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    estimate_hours DECIMAL(5,2) NOT NULL CHECK (estimate_hours > 0),
    due_date TIMESTAMP WITH TIME ZONE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create schedules table
CREATE TABLE IF NOT EXISTS public.schedules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    plan_json JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, date)
);

-- Create logs table
CREATE TABLE IF NOT EXISTS public.logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    actual_minutes INTEGER NOT NULL CHECK (actual_minutes > 0),
    comment TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_projects_owner_id ON public.projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_goals_project_id ON public.goals(project_id);
CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON public.tasks(goal_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON public.tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_schedules_user_date ON public.schedules(user_id, date);
CREATE INDEX IF NOT EXISTS idx_logs_task_id ON public.logs(task_id);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON public.logs(created_at);

-- Create update trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create update triggers
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON public.users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_goals_updated_at BEFORE UPDATE ON public.goals FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON public.schedules FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 3. Row Level Security (RLS) ポリシーの追加
テーブル作成後、続けて以下のSQLも実行してください：

```sql
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
```

### 4. 接続テスト
SQLが正常に実行されたら、以下のコマンドで接続テストを実行：

```bash
python create_tables.py
```

## 📊 検証確認事項

### DATABASE_URL エンコーディング
- パスワード: `VxnZc8.cn&6G?`
- 正しいエンコード: `VxnZc8.cn%266G%3F`
- ✅ 現在のエンコーディングは正しい

### 特殊文字のマッピング
- `&` → `%26` ✅
- `?` → `%3F` ✅
- `.` → そのまま ✅

## 🔧 トラブルシューティング

### 1. 接続エラーが発生した場合
- Supabase Dashboard で実際のパスワードを再確認
- IP制限設定を確認（Settings → Database → Network restrictions）

### 2. テーブル作成エラーが発生した場合  
- SQL Editorで1つずつ実行してエラー箇所を特定
- 既存テーブルとの競合をチェック

### 3. 権限エラーが発生した場合
- SERVICE_ROLE_KEY が正しく設定されているか確認
- RLSポリシーが適切に設定されているか確認

## 📞 次のステップ
1. 上記SQLをSupabase Dashboard で実行
2. `python create_tables.py` で接続確認
3. FastAPI サーバー (`python main.py`) で動作確認