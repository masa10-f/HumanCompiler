-- Restore exact pre-migration selections without overwriting subsequent edits.
ALTER TABLE public.user_settings
    ALTER COLUMN openai_model SET DEFAULT 'gpt-5.5';

UPDATE public.user_settings AS settings
SET openai_model = backup.old_model, updated_at = NOW()
FROM public.openai_model_migration_032_backup AS backup
WHERE settings.id = backup.settings_id
    AND settings.openai_model = backup.new_model
    AND settings.updated_at = backup.migrated_at;

DROP TABLE IF EXISTS public.openai_model_migration_032_backup;
