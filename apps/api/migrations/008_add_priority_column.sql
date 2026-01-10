-- Description: Add priority column to tasks table
-- Migration for adding priority column with default value 3

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 3;
