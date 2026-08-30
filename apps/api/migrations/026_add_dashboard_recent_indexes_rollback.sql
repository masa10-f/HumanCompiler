-- SPDX-License-Identifier: AGPL-3.0-or-later
-- Rollback: Add dashboard recent-item indexes

DROP INDEX IF EXISTS idx_tasks_goal_id_updated_at;
DROP INDEX IF EXISTS idx_goals_project_id_updated_at;
