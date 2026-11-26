-- Rollback: Give every project, goal and task an overview and a log
-- Run this after rolling back to the API that keeps one note per item.
-- No text is lost: each log is put back at the end of its item's overview
-- (the way agent appends were stored before 047), and then the log rows are
-- deleted. An item that has only a log gets an overview to hold it. A
-- Markdown overview that takes a log becomes HTML paragraphs of the same
-- text, as in migration 044. Images shown in a log stay attached, to the
-- overview. Tasks whose overview took a log get a new updated_at, because
-- the opening of their note may have changed.
-- Not restored: which part of a note was the log. Applying 047 and 048 again
-- moves only what follows the first agent heading.
-- The DO bodies are single-quoted (not $$) because the migration manager
-- splits statements on semicolons outside quotes. Regular expressions use no
-- non-capturing group, which reads as a bind parameter there.

DO '
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(''public.context_notes'')
          AND attname = ''section''
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION ''public.context_notes has no section column: 047_add_note_sections.sql is not applied, so there is nothing to roll back.'';
    END IF;
END
';

-- 1. An overview for every item that has only a log.
INSERT INTO public.context_notes
    (id, user_id, project_id, goal_id, task_id, section, content, content_type)
SELECT gen_random_uuid(), l.user_id, l.project_id, l.goal_id, l.task_id,
       'overview', '', 'html'
FROM public.context_notes AS l
WHERE l.section = 'log'
  AND l.content <> ''
  AND NOT EXISTS (
      SELECT 1 FROM public.context_notes AS o
      WHERE o.section = 'overview'
        AND (o.project_id = l.project_id
             OR o.goal_id = l.goal_id
             OR o.task_id = l.task_id)
  );

-- 2. Tasks whose note text changes in step 3.
UPDATE public.tasks AS t
SET updated_at = NOW()
FROM public.context_notes AS l
WHERE l.section = 'log'
  AND l.content <> ''
  AND l.task_id = t.id;

-- 3. Each log goes to the end of its item's overview.
UPDATE public.context_notes AS o
SET content = CASE
        WHEN o.content_type = 'html' THEN o.content
        WHEN o.content ~ '\S' THEN
            '<p>' || regexp_replace(
                regexp_replace(
                    replace(replace(replace(o.content, '&', '&amp;'), '<', '&lt;'), '>', '&gt;'),
                    '^\s+|\s+$', '', 'g'
                ),
                '\s*\n\s*', '</p><p>', 'g'
            ) || '</p>'
        ELSE ''
    END || l.content,
    content_type = 'html',
    content_text = concat_ws(
        chr(10), NULLIF(o.content_text, ''), NULLIF(l.content_text, '')
    )
FROM public.context_notes AS l
WHERE o.section = 'overview'
  AND l.section = 'log'
  AND l.content <> ''
  AND (o.project_id = l.project_id
       OR o.goal_id = l.goal_id
       OR o.task_id = l.task_id);

-- 4. Images held by a log are held by the overview from now on. Without this
-- their note_id would become NULL in step 5 and the cleanup job would delete
-- the files.
DO '
BEGIN
    IF to_regclass(''public.note_attachments'') IS NOT NULL THEN
        UPDATE public.note_attachments AS a
        SET note_id = o.id
        FROM public.context_notes AS l
        JOIN public.context_notes AS o
          ON o.section = ''overview''
         AND (o.project_id = l.project_id
              OR o.goal_id = l.goal_id
              OR o.task_id = l.task_id)
        WHERE l.section = ''log''
          AND a.note_id = l.id;
    END IF;
END
';

-- 5. The logs are in the overviews now.
DELETE FROM public.context_notes WHERE section = 'log';

-- 6. One note per item again.
ALTER TABLE public.context_notes DROP CONSTRAINT IF EXISTS unique_project_note;
ALTER TABLE public.context_notes
    ADD CONSTRAINT unique_project_note UNIQUE (project_id);
ALTER TABLE public.context_notes DROP CONSTRAINT IF EXISTS unique_goal_note;
ALTER TABLE public.context_notes
    ADD CONSTRAINT unique_goal_note UNIQUE (goal_id);
ALTER TABLE public.context_notes DROP CONSTRAINT IF EXISTS unique_task_note;
ALTER TABLE public.context_notes
    ADD CONSTRAINT unique_task_note UNIQUE (task_id);

ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS unique_project_note_section;
ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS unique_goal_note_section;
ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS unique_task_note_section;
ALTER TABLE public.context_notes
    DROP CONSTRAINT IF EXISTS context_notes_section_check;

ALTER TABLE public.context_notes DROP COLUMN IF EXISTS section;
