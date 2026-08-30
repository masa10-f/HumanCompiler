-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Migration: Add dashboard recent-item indexes
-- Date: 2026-08-30
-- Description: Support recent goal/task lookups by hierarchy and update order.

CREATE INDEX IF NOT EXISTS idx_goals_project_id_updated_at
    ON goals (project_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_goal_id_updated_at
    ON tasks (goal_id, updated_at DESC, id DESC);

COMMENT ON INDEX idx_goals_project_id_updated_at IS
    'Speed up recent goal lookups for dashboard shortcuts';

COMMENT ON INDEX idx_tasks_goal_id_updated_at IS
    'Speed up recent task lookups for dashboard shortcuts';
