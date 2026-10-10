-- Migration: Add paused project status
-- Date: 2026-10-10
-- Description: Allow projects to be paused (status = paused).
-- projects.status is VARCHAR(20) without a CHECK constraint (see 009), so the
-- new value needs no schema change there. Older, manually created schemas may
-- store the column as a native enum type instead; extend that type so the API
-- can save the new value. Apply before deploying the API that offers it.

DO '
DECLARE
    status_type regtype;
BEGIN
    SELECT a.atttypid::regtype INTO status_type
    FROM pg_attribute AS a
    JOIN pg_type AS t ON t.oid = a.atttypid
    WHERE a.attrelid = ''public.projects''::regclass
      AND a.attname = ''status''
      AND NOT a.attisdropped
      AND t.typtype = ''e'';

    IF status_type IS NOT NULL THEN
        EXECUTE format(''ALTER TYPE %s ADD VALUE IF NOT EXISTS %L'', status_type, ''paused'');
    END IF;
END;
';
