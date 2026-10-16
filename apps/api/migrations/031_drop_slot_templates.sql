-- Migration: Drop slot templates
-- Date: 2026-09-23
-- Description: Removes the day-of-week slot template presets. The daily plan
-- note defines its own scheduling windows, so no feature reads this table.
-- Stored templates are deleted; back up the table first to keep them.

DROP TABLE IF EXISTS public.slot_templates;
