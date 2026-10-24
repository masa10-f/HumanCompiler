-- Migration: Stop storing goal estimates
-- Date: 2026-10-23
-- Description: The API now computes a goal's estimate on every read as the
-- sum of its task estimates (cancelled tasks excluded) and no longer writes
-- goals.estimate_hours. The column is kept, unused, so that rolling back stays
-- possible; this migration only lets new goals be inserted without a value.
-- 001 creates the column nullable, so this is a no-op there; schemas created
-- by the ORM declare it NOT NULL. No data is changed.
-- Apply before deploying the API that computes goal estimates.

ALTER TABLE public.goals ALTER COLUMN estimate_hours DROP NOT NULL;
