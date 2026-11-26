-- Migration: Move what agents appended to project and goal notes into their logs
-- Date: 2026-11-26
-- Description: Splits the note of every project and goal at the first text an
-- agent appended: what comes before stays the overview, and the rest becomes
-- the item's log (migration 047 added the two sections).
-- Agents used to append their dated summaries to the end of the one note an
-- item had, under a heading "エージェントからの追記（date、name）". From 047 on
-- they append to the log; this moves what they appended before.
--
-- 1. For each project or goal whose overview holds such a heading and whose
--    log is still empty, the log gets everything from the first heading on,
--    and the overview keeps what comes before it (nothing, if the note starts
--    with the heading). No text is deleted or changed; content_text is split
--    at the same place. Both notes get a new updated_at. The web creates an
--    empty log row when a log is first opened; such a row is filled, and an
--    item without one gets a new row.
-- 2. An image shown only in the log is attached to the log.
--
-- Left alone: task notes (a task's note is its body, and for a task an agent
-- created the text under the heading is that body), Markdown notes (the web
-- editor saves HTML and agents append HTML), items whose log already has
-- content, and a note that has the words of the heading in its own text
-- above the first heading (the place to split its text is then not certain).
-- Text the user wrote below an agent heading moves with it; move it back in
-- the editor if it belongs in the overview.
--
-- Apply after the API that reads context_notes.section is deployed: the API
-- deployed before 047 does not tell an item's two notes apart. Requires 047
-- and 044 (content_text).
-- Safe to apply twice: an item whose log has content is not split again.
-- There is no rollback of its own: the 047 rollback puts every log back at
-- the end of its overview.
-- The DO bodies are single-quoted (not $$) because the migration manager
-- splits statements on semicolons outside quotes.

DO '
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(''public.context_notes'')
          AND attname = ''section''
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION ''public.context_notes has no section column. Apply 047_add_note_sections.sql before 048_move_agent_appends_to_logs.sql.'';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = to_regclass(''public.context_notes'')
          AND attname = ''content_text''
          AND NOT attisdropped
    ) THEN
        RAISE EXCEPTION ''public.context_notes has no content_text column. Apply 044_merge_task_text_into_notes.sql before 048_move_agent_appends_to_logs.sql.'';
    END IF;
END
';

-- 1. html_pos is where the first agent heading starts in content, and
-- text_pos where its line starts in content_text (one block per line). A note
-- is split only when both are found, so the two always split at the same
-- heading. words_before is where the words of the heading appear in content
-- before that heading, as the user's own text: the first line of
-- content_text that starts with them would then not be the heading's, so
-- such a note is not split. log_id is the item's log row when it has an
-- empty one: '' as the web creates it, or the empty paragraph the editor
-- saves.
WITH split AS (
    SELECT
        n.id,
        n.user_id,
        n.project_id,
        n.goal_id,
        n.content,
        n.content_text,
        l.id AS log_id,
        strpos(n.content, '<p><strong>エージェントからの追記（') AS html_pos,
        strpos(
            left(
                n.content,
                GREATEST(strpos(n.content, '<p><strong>エージェントからの追記（') - 1, 0)
            ),
            'エージェントからの追記（'
        ) AS words_before,
        CASE
            WHEN left(n.content_text, 12) = 'エージェントからの追記（' THEN 1
            WHEN strpos(n.content_text, chr(10) || 'エージェントからの追記（') > 0
                THEN strpos(n.content_text, chr(10) || 'エージェントからの追記（') + 1
            ELSE 0
        END AS text_pos
    FROM public.context_notes AS n
    LEFT JOIN public.context_notes AS l
      ON l.section = 'log'
     AND (l.project_id = n.project_id OR l.goal_id = n.goal_id)
    WHERE n.section = 'overview'
      AND n.task_id IS NULL
      AND n.content_type = 'html'
      AND (l.id IS NULL OR l.content IN ('', '<p></p>'))
),
created AS (
    INSERT INTO public.context_notes
        (id, user_id, project_id, goal_id, section, content, content_type, content_text)
    SELECT gen_random_uuid(), user_id, project_id, goal_id, 'log',
           substr(content, html_pos), 'html', substr(content_text, text_pos)
    FROM split
    WHERE html_pos > 0 AND text_pos > 0 AND words_before = 0 AND log_id IS NULL
    RETURNING id
),
filled AS (
    UPDATE public.context_notes AS l
    SET content = substr(split.content, split.html_pos),
        content_type = 'html',
        content_text = substr(split.content_text, split.text_pos),
        updated_at = NOW()
    FROM split
    WHERE l.id = split.log_id
      AND split.html_pos > 0
      AND split.text_pos > 0
      AND split.words_before = 0
    RETURNING l.id
)
UPDATE public.context_notes AS n
SET content = left(split.content, split.html_pos - 1),
    content_text = CASE
        WHEN split.text_pos > 1 THEN left(split.content_text, split.text_pos - 2)
        ELSE ''
    END,
    updated_at = NOW()
FROM split
WHERE n.id = split.id
  AND split.html_pos > 0
  AND split.text_pos > 0
  AND split.words_before = 0;

-- 2. The note that shows an image holds it. Only images the overview no
-- longer refers to move; ids are compared in lower case, as the API writes
-- them either way.
DO '
BEGIN
    IF to_regclass(''public.note_attachments'') IS NOT NULL THEN
        UPDATE public.note_attachments AS a
        SET note_id = l.id
        FROM public.context_notes AS o
        JOIN public.context_notes AS l
          ON l.section = ''log''
         AND (l.project_id = o.project_id OR l.goal_id = o.goal_id)
        WHERE o.section = ''overview''
          AND a.note_id = o.id
          AND strpos(lower(l.content), lower(a.id::text)) > 0
          AND strpos(lower(o.content), lower(a.id::text)) = 0;
    END IF;
END
';
