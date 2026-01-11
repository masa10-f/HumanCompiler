-- Description: Add status column to projects table
-- Migration for adding project status with default value 'pending'

ALTER TABLE projects ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending' NOT NULL;
