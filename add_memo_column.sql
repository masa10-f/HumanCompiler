-- Add memo column to tasks table
-- Execute this in Supabase SQL Editor

BEGIN;

-- Check if memo column exists, if not add it
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'memo'
    ) THEN
        ALTER TABLE tasks ADD COLUMN memo VARCHAR(2000);
        RAISE NOTICE 'Added memo column to tasks table';
    ELSE
        RAISE NOTICE 'memo column already exists in tasks table';
    END IF;
END $$;

-- Verify the column was added
SELECT column_name, data_type, character_maximum_length
FROM information_schema.columns
WHERE table_name = 'tasks' AND column_name = 'memo';

COMMIT;
