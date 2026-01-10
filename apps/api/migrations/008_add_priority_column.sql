-- Description: Add priority column to tasks table
-- Migration for adding priority column with default value 3

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'priority'
    ) THEN
        ALTER TABLE tasks ADD COLUMN priority INTEGER DEFAULT 3;
    END IF;
END $$;
