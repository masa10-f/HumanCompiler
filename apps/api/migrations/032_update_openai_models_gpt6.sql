-- Migration: Cost-conscious GPT-6 model defaults (2026-09-23).
-- Run transactionally through MigrationManager. Preserve exact old selections
-- because both mini and nano migrate to Luna. No API keys are copied.
CREATE TABLE IF NOT EXISTS public.openai_model_migration_032_backup (
    settings_id UUID PRIMARY KEY REFERENCES public.user_settings(id) ON DELETE CASCADE,
    old_model VARCHAR(50) NOT NULL,
    new_model VARCHAR(50) NOT NULL,
    migrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.openai_model_migration_032_backup ENABLE ROW LEVEL SECURITY;

INSERT INTO public.openai_model_migration_032_backup (settings_id, old_model, new_model)
SELECT id, openai_model,
    CASE WHEN openai_model = 'gpt-5.5' THEN 'gpt-6-sol' ELSE 'gpt-6-luna' END
FROM public.user_settings
WHERE openai_model IN ('gpt-5.5', 'gpt-5.4-mini', 'gpt-5.4-nano')
ON CONFLICT (settings_id) DO NOTHING;

ALTER TABLE public.user_settings
    ALTER COLUMN openai_model SET DEFAULT 'gpt-6-sol';

UPDATE public.user_settings AS settings
SET openai_model = backup.new_model, updated_at = backup.migrated_at
FROM public.openai_model_migration_032_backup AS backup
WHERE settings.id = backup.settings_id AND settings.openai_model = backup.old_model;

-- Verify the previous active defaults have all been migrated.
DO 'BEGIN
    IF EXISTS (
        SELECT 1 FROM public.user_settings
        WHERE openai_model IN (''gpt-5.5'', ''gpt-5.4-mini'', ''gpt-5.4-nano'')
    ) THEN
        RAISE EXCEPTION ''GPT-6 model migration left legacy selections'';
    END IF;
    RAISE NOTICE ''GPT-6 model migration completed; original selections retained in openai_model_migration_032_backup'';
END';
