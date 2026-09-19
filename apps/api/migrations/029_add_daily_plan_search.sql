-- Description: Add searchable daily notebook history with backfill
-- Apply with MigrationManager (transactional) before deploying the new API.
-- The trigger also keeps older writers consistent during a rolling deployment.
ALTER TABLE public.daily_plan_documents
    ADD COLUMN search_text text NOT NULL DEFAULT '';

CREATE FUNCTION public.daily_plan_search_text(document jsonb)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS '
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

CREATE FUNCTION public.refresh_daily_plan_search_text()
RETURNS trigger LANGUAGE plpgsql AS '
BEGIN
    NEW.search_text := public.daily_plan_search_text(NEW.document_json);
    RETURN NEW;
END;
';

CREATE TRIGGER daily_plan_search_text_on_write
    BEFORE INSERT OR UPDATE OF document_json ON public.daily_plan_documents
    FOR EACH ROW EXECUTE FUNCTION public.refresh_daily_plan_search_text();

-- The existing UNIQUE(user_id, date) index supports owner/date filtering and
-- keyset pagination. Substring search deliberately also supports Japanese text.

UPDATE public.daily_plan_documents
SET search_text = public.daily_plan_search_text(document_json);
