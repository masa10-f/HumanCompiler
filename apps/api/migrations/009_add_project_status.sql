-- Description: Add status column to projects table
-- Migration for adding project status with default value 'pending'

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'projects' AND column_name = 'status'
    ) THEN
        ALTER TABLE projects ADD COLUMN status VARCHAR(20) DEFAULT 'pending' NOT NULL;
    END IF;
END $$;
