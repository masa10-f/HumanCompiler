-- Restore the 030 search normalization (without schedule line notes).
-- Stored notes, including line memos, are unchanged.
CREATE OR REPLACE FUNCTION public.daily_plan_search_text(document jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = pg_catalog, public AS '
    SELECT COALESCE(string_agg(line, E''\n'' ORDER BY ordinal), '''')
    FROM (
        SELECT ordinal, btrim(concat_ws('' '',
            NULLIF(block->>''text'', ''''), NULLIF(block->>''title'', ''''),
            NULLIF(block->>''start'', ''''), NULLIF(block->>''end'', ''''),
            CASE WHEN block->>''type'' = ''schedule_directive'' THEN ''/schedule'' END,
            (SELECT string_agg((w->>''start'') || ''-'' || (w->>''end''), '' '' ORDER BY n)
             FROM jsonb_array_elements(COALESCE(block->''allowed_windows'', ''[]''::jsonb))
                 WITH ORDINALITY AS windows(w, n))
        ), E''\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000'') AS line
        FROM jsonb_array_elements(COALESCE(document->''blocks'', ''[]''::jsonb))
            WITH ORDINALITY AS blocks(block, ordinal)
    ) AS lines
    WHERE line <> '''';
';

UPDATE public.daily_plan_documents
SET search_text = public.daily_plan_search_text(document_json);
