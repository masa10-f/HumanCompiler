-- Migration: Update default OpenAI model to GPT-5.5

ALTER TABLE user_settings
    ALTER COLUMN openai_model SET DEFAULT 'gpt-5.5';

UPDATE user_settings
SET openai_model = 'gpt-5.5',
    updated_at = NOW()
WHERE openai_model = 'gpt-5';

UPDATE user_settings
SET openai_model = 'gpt-5.4-mini',
    updated_at = NOW()
WHERE openai_model = 'gpt-5-mini';

UPDATE user_settings
SET openai_model = 'gpt-5.4-nano',
    updated_at = NOW()
WHERE openai_model = 'gpt-5-nano';

UPDATE user_settings
SET openai_model = 'gpt-5.5',
    updated_at = NOW()
WHERE openai_model = 'gpt-4o';

UPDATE user_settings
SET openai_model = 'gpt-5.4-mini',
    updated_at = NOW()
WHERE openai_model = 'gpt-4o-mini';
