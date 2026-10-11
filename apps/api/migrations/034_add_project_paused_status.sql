-- Migration: Add paused project status
-- Date: 2026-10-10
-- Description: Allow projects to be paused (status = paused).
-- The documented schema stores projects.status as VARCHAR(20) without a CHECK
-- constraint (see 009), which accepts the new value as it is. Databases whose
-- tables were created by the ORM store the column as a native enum type, and
-- hand-built schemas may carry a CHECK constraint listing the allowed values;
-- both reject paused ("invalid input value for enum" / "violates check
-- constraint"). This migration brings such schemas in line with 009:
--   * a native enum column becomes VARCHAR(20) DEFAULT 'pending' NOT NULL. The
--     stored text is unchanged and the enum type is dropped once nothing uses
--     it. Unlike ALTER TYPE ... ADD VALUE this needs no ownership of the type,
--     works on every PostgreSQL version, and the value is usable right away,
--     even inside the same transaction.
--   * a CHECK constraint on status that rejects paused is recreated under the
--     same name with paused included.
-- Row Level Security on projects stays as enable_rls_security.sql set it: the
-- migration re-enables it and recreates the owner-only policy only when the
-- table has no policy at all, so it never leaves projects unprotected.
-- Apply before deploying the API that offers the status.

DO '
DECLARE
    status_attnum int2;
    enum_type regtype;
    status_check record;
    allows_paused boolean;
BEGIN
    SELECT a.attnum INTO status_attnum
    FROM pg_attribute AS a
    WHERE a.attrelid = ''public.projects''::regclass
      AND a.attname = ''status''
      AND NOT a.attisdropped;

    IF status_attnum IS NULL THEN
        RAISE EXCEPTION ''public.projects.status is missing. Apply 009_add_project_status.sql before 034_add_project_paused_status.sql.'';
    END IF;

    -- 1. Native enum column (ORM-created schema) -> VARCHAR(20), as in 009.
    SELECT a.atttypid::regtype INTO enum_type
    FROM pg_attribute AS a
    JOIN pg_type AS t ON t.oid = a.atttypid
    WHERE a.attrelid = ''public.projects''::regclass
      AND a.attnum = status_attnum
      AND t.typtype = ''e'';

    IF enum_type IS NOT NULL THEN
        ALTER TABLE public.projects ALTER COLUMN status DROP DEFAULT;
        ALTER TABLE public.projects
            ALTER COLUMN status TYPE VARCHAR(20) USING status::text;
        UPDATE public.projects SET status = ''pending'' WHERE status IS NULL;
        ALTER TABLE public.projects
            ALTER COLUMN status SET DEFAULT ''pending'',
            ALTER COLUMN status SET NOT NULL;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_attribute AS a
            WHERE a.atttypid = enum_type::oid
              AND a.attnum > 0
              AND NOT a.attisdropped
        ) THEN
            BEGIN
                EXECUTE format(''DROP TYPE %s'', enum_type);
            EXCEPTION WHEN dependent_objects_still_exist THEN
                RAISE NOTICE ''Enum type % is still referenced elsewhere and was kept'', enum_type;
            END;
        END IF;
    END IF;

    -- 2. CHECK constraints on status alone that reject paused (hand-built schemas).
    FOR status_check IN
        SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
        FROM pg_constraint AS c
        WHERE c.conrelid = ''public.projects''::regclass
          AND c.contype = ''c''
          AND c.conkey = ARRAY[status_attnum]
    LOOP
        -- pg_get_constraintdef returns "CHECK (<expression>)"; evaluate the
        -- expression against a one-row stand-in for projects holding paused.
        EXECUTE format(
            ''SELECT %s FROM (SELECT %L::varchar(20) AS status) AS projects'',
            substring(status_check.definition FROM 7),
            ''paused''
        ) INTO allows_paused;

        IF NOT coalesce(allows_paused, false) THEN
            EXECUTE format(
                ''ALTER TABLE public.projects DROP CONSTRAINT %I'',
                status_check.conname
            );
            EXECUTE format(
                ''ALTER TABLE public.projects ADD CONSTRAINT %I CHECK (status IN (%L, %L, %L, %L, %L))'',
                status_check.conname,
                ''pending'', ''in_progress'', ''paused'', ''completed'', ''cancelled''
            );
        END IF;
    END LOOP;

    -- 3. Keep projects protected: RLS on, owner-only policy present.
    ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = ''public'' AND tablename = ''projects''
    ) THEN
        CREATE POLICY projects_own_data ON public.projects
            FOR ALL
            TO authenticated
            USING (auth.uid()::text = owner_id::text)
            WITH CHECK (auth.uid()::text = owner_id::text);
    END IF;
END;
';
