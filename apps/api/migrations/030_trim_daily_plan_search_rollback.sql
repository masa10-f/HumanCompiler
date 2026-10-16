-- Restore the 029 search normalization without changing stored notes.
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
        )) AS line
        FROM jsonb_array_elements(COALESCE(document->''blocks'', ''[]''::jsonb))
            WITH ORDINALITY AS blocks(block, ordinal)
    ) AS lines
    WHERE line <> '''';
';

UPDATE public.daily_plan_documents
SET search_text = public.daily_plan_search_text(document_json);
