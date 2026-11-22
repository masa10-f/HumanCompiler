-- Rollback: Make a task's note its body
-- Run this after rolling back to the API that reads tasks.description and
-- tasks.memo. Migration 044 never changed those two columns, so tasks that
-- existed before it show the description and memo they had then.
-- Not restored: the notes keep the description and memo text 044 copied into
-- them (it cannot be told apart from what the user wrote since), and a task
-- created after 044 has its text only in its note.
-- Dropping note_merged_at means a later 044 copies the descriptions and memos
-- again, on top of the copies already in the notes.

ALTER TABLE public.tasks DROP COLUMN IF EXISTS note_merged_at;

ALTER TABLE public.context_notes DROP COLUMN IF EXISTS content_text;
