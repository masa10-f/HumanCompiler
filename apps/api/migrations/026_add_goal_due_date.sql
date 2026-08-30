-- Migration: Add goal due date
-- Date: 2026-08-30
-- Description: Adds an optional due date to goals

ALTER TABLE public.goals
    ADD COLUMN IF NOT EXISTS due_date TIMESTAMP WITH TIME ZONE;

COMMENT ON COLUMN public.goals.due_date IS 'Optional due date for the goal';
