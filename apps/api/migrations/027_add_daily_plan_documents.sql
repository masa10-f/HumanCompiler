-- Description: Add versioned source documents for lightweight daily planning

CREATE TABLE IF NOT EXISTS public.daily_plan_documents (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
    document_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_daily_plan_documents_user_date UNIQUE(user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_plan_documents_user_date
    ON public.daily_plan_documents(user_id, date DESC);

ALTER TABLE public.daily_plan_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_plan_documents_own_data
    ON public.daily_plan_documents;
CREATE POLICY daily_plan_documents_own_data
    ON public.daily_plan_documents
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON public.daily_plan_documents TO authenticated;

COMMENT ON TABLE public.daily_plan_documents IS
    'Versioned source documents for lightweight daily planning.';
