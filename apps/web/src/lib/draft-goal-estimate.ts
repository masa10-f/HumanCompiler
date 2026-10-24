// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type { DraftGoal, GoalTaskDraftPayload } from '@/types/ai-drafts'

/**
 * Estimate the draft goal will have once applied: the sum of the selected
 * tasks that end up in it. As when the draft is applied, a task goes to the
 * draft goal named by goal_client_id if that goal is selected (and so
 * created), else to an existing goal_id, else to the goal it is nested in.
 */
export const getDraftGoalEstimateHours = (
  draft: GoalTaskDraftPayload,
  goal: DraftGoal,
  selectedGoalIds: Set<string>,
  selectedTaskIds: Set<string>
) =>
  [
    ...draft.tasks.map((task) => ({ task, parentClientId: null as string | null })),
    ...draft.goals.flatMap((parent) =>
      parent.tasks.map((task) => ({ task, parentClientId: parent.client_id }))
    ),
  ]
    .filter(
      ({ task, parentClientId }) =>
        selectedTaskIds.has(task.client_id) &&
        (task.goal_client_id && selectedGoalIds.has(task.goal_client_id)
          ? task.goal_client_id
          : task.goal_id
            ? null
            : parentClientId) === goal.client_id
    )
    .reduce((sum, { task }) => sum + (Number(task.estimate_hours) || 0), 0);
