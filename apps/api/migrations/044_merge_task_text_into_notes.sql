-- Migration: Make a task's note its body
-- Date: 2026-11-22
-- Description: Copies every task's description and memo into the task's
-- note and adds context_notes.content_text, the note's visible text.
-- A task no longer has a description or a memo: its note is its body. The
-- API stops reading and writing tasks.description and tasks.memo; lists show
-- the opening of the note and search matches content_text, which the API
-- rebuilds on every note write.
--
-- 1. context_notes.content_text (TEXT NOT NULL DEFAULT '') is added.
-- 2. For each task with a description or memo that was not merged before, the
--    text is put at the top of its note, escaped, one paragraph per line: the
--    description first, then the memo under a bold "メモ" line, then what the
--    note already held. The note becomes HTML: a note that was Markdown (the
--    column default; the web editor saves HTML) keeps its text as escaped
--    paragraphs, so text such as <TODO> is not read as a tag afterwards.
--    A task without a note gets one, owned by the project's owner. tasks.note_merged_at records the merge, so applying the
--    migration again copies nothing twice.
-- 3. content_text is filled for every note that has content and no text yet.
--    The updated_at trigger is off for this step, so notes whose content did
--    not change keep their updated_at; merged notes get a new one.
--
-- Nothing is deleted: tasks.description and tasks.memo keep their values, so
-- the rollback restores the previous API's view. A later migration drops them.
-- Additive for the API deployed before it, which ignores the new columns.
-- Text written to a description or memo through that API after this ran is
-- copied only for tasks not merged yet: apply this right before deploying the
-- API that reads notes, and do not edit task descriptions or memos in between.
-- Safe to apply twice: a manual application is not recorded in
-- schema_migrations, so the migration manager runs it again at startup.
-- DO bodies are single-quoted (not $$) because the migration manager splits
-- statements on semicolons outside quotes. Regular expressions use capturing
-- groups, because a non-capturing group reads as a bind parameter there.
-- The text rules match note_text.py (note_plain_text, plain_text_to_note_html).

DO '
BEGIN
    IF to_regclass(''public.context_notes'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.context_notes is missing. Apply earlier migrations before 044_merge_task_text_into_notes.sql.'';
    END IF;
    IF to_regclass(''public.tasks'') IS NULL THEN
        RAISE EXCEPTION ''Required table public.tasks is missing. Apply earlier migrations before 044_merge_task_text_into_notes.sql.'';
    END IF;
END
';

ALTER TABLE public.context_notes
    ADD COLUMN IF NOT EXISTS content_text TEXT NOT NULL DEFAULT '';

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS note_merged_at TIMESTAMPTZ;

COMMENT ON COLUMN public.context_notes.content_text IS
    'Visible text of content, one block per line; written by the API for search and list excerpts';
COMMENT ON COLUMN public.tasks.note_merged_at IS
    'When migration 044 copied description and memo into the task note; NULL if there was nothing to copy';

-- 2a. A note for each task that has text to copy and no note yet.
INSERT INTO public.context_notes (id, user_id, task_id, content, content_type)
SELECT gen_random_uuid(), p.owner_id, t.id, '', 'html'
FROM public.tasks AS t
JOIN public.goals AS g ON g.id = t.goal_id
JOIN public.projects AS p ON p.id = g.project_id
WHERE t.note_merged_at IS NULL
  AND (COALESCE(t.description, '') ~ '\S' OR COALESCE(t.memo, '') ~ '\S')
  AND NOT EXISTS (
      SELECT 1 FROM public.context_notes AS n WHERE n.task_id = t.id
  );

-- 2b. Description, then memo, then the existing note (a Markdown note as
-- escaped paragraphs). content_text is cleared so that step 3 rebuilds it.
WITH merged AS (
    SELECT
        t.id AS task_id,
        CASE
            WHEN COALESCE(t.description, '') ~ '\S' THEN
                '<p>' || regexp_replace(
                    regexp_replace(
                        replace(replace(replace(t.description, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                        '^\s+|\s+$', '', 'g'
                    ),
                    '\s*\n\s*', '</p><p>', 'g'
                ) || '</p>'
            ELSE ''
        END
        || CASE
            WHEN COALESCE(t.memo, '') ~ '\S' THEN
                '<p><strong>メモ</strong></p><p>' || regexp_replace(
                    regexp_replace(
                        replace(replace(replace(t.memo, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                        '^\s+|\s+$', '', 'g'
                    ),
                    '\s*\n\s*', '</p><p>', 'g'
                ) || '</p>'
            ELSE ''
        END AS block
    FROM public.tasks AS t
    WHERE t.note_merged_at IS NULL
      AND (COALESCE(t.description, '') ~ '\S' OR COALESCE(t.memo, '') ~ '\S')
)
UPDATE public.context_notes AS n
SET content = merged.block || CASE
        WHEN n.content_type = 'html' THEN n.content
        WHEN n.content ~ '\S' THEN
            '<p>' || regexp_replace(
                regexp_replace(
                    replace(replace(replace(n.content, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                    '^\s+|\s+$', '', 'g'
                ),
                '\s*\n\s*', '</p><p>', 'g'
            ) || '</p>'
        ELSE ''
    END,
    content_type = 'html',
    content_text = ''
FROM merged
WHERE n.task_id = merged.task_id;

-- 2c. Record the merge.
UPDATE public.tasks
SET note_merged_at = NOW()
WHERE note_merged_at IS NULL
  AND (COALESCE(description, '') ~ '\S' OR COALESCE(memo, '') ~ '\S');

-- 3. Visible text of every note that has none yet, without touching
-- updated_at (the trigger exists on schemas that applied 035).
DO '
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = ''public.context_notes''::regclass
          AND tgname = ''update_context_notes_updated_at''
          AND NOT tgisinternal
    ) THEN
        ALTER TABLE public.context_notes DISABLE TRIGGER update_context_notes_updated_at;
    END IF;
END
';

UPDATE public.context_notes
SET content_text = btrim(
    regexp_replace(
        regexp_replace(
            CASE
                WHEN content_type = 'html' THEN
                    replace(replace(replace(replace(replace(replace(
                        regexp_replace(
                            regexp_replace(
                                regexp_replace(
                                    content,
                                    '<br\s*/?>|</(p|h[1-6]|li|tr|pre|blockquote|div|table|ul|ol)\s*>',
                                    chr(10), 'gi'
                                ),
                                '</(td|th)\s*>', ' ', 'gi'
                            ),
                            '<[^>]*>', '', 'g'
                        ),
                        '&nbsp;', ' '), '&lt;', '<'), '&gt;', '>'),
                        '&quot;', chr(34)), '&#39;', chr(39)), '&amp;', '&')
                ELSE content
            END,
            '[ \t\r' || chr(160) || chr(12288) || ']+', ' ', 'g'
        ),
        ' ?\n[ \n]*', chr(10), 'g'
    ),
    ' ' || chr(10)
)
WHERE content_text = ''
  AND content <> '';

DO '
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgrelid = ''public.context_notes''::regclass
          AND tgname = ''update_context_notes_updated_at''
          AND NOT tgisinternal
    ) THEN
        ALTER TABLE public.context_notes ENABLE TRIGGER update_context_notes_updated_at;
    END IF;
END
';
