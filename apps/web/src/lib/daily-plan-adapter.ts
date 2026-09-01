// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type {
  DailyPlanBlock,
  DailyPlanScheduleDirective,
  DailyPlanTaskRef,
} from "@/types/daily-plan";

export function preserveUnconvertedDailyPlanBlocks(
  blocks: DailyPlanBlock[],
  replacedBlockIds: Iterable<string>,
): DailyPlanBlock[] {
  const replaced = new Set(replacedBlockIds);
  return blocks.filter(
    (block) =>
      !replaced.has(block.id) &&
      !block.id.startsWith("detailed-fixed:") &&
      !block.id.startsWith("detailed-event:"),
  );
}

export function applyDirectiveTaskSelection(
  block: DailyPlanScheduleDirective,
  task?: { ref: DailyPlanTaskRef; title: string },
): DailyPlanScheduleDirective {
  if (task) {
    return {
      ...block,
      mode: "task",
      task_ref: task.ref,
      title: task.title,
      filter: undefined,
    };
  }
  return {
    ...block,
    mode: "filter",
    task_ref: undefined,
    filter: block.filter ?? {
      work_types: [],
      project_ids: [],
      goal_ids: [],
    },
  };
}
