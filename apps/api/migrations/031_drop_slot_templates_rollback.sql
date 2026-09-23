-- Rollback: Recreate the empty slot templates table from migration 021
-- Rows deleted by 031 are not restored; reload them from a backup if needed.

CREATE TABLE IF NOT EXISTS public.slot_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
    slots_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_default BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_slot_templates_user_id ON public.slot_templates(user_id);
CREATE INDEX IF NOT EXISTS idx_slot_templates_user_day ON public.slot_templates(user_id, day_of_week);
CREATE UNIQUE INDEX IF NOT EXISTS idx_slot_templates_unique_default
    ON public.slot_templates(user_id, day_of_week)
    WHERE is_default = true;

ALTER TABLE public.slot_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "slot_templates_own_data" ON public.slot_templates;
CREATE POLICY "slot_templates_own_data" ON public.slot_templates
    FOR ALL
    TO authenticated
    USING (auth.uid()::text = user_id::text)
    WITH CHECK (auth.uid()::text = user_id::text);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.slot_templates TO authenticated;
