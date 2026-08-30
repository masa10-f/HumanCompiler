// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import type { DailyPlanBlock } from "@/types/daily-plan";

export function preserveUnconvertedDailyPlanBlocks(
  blocks: DailyPlanBlock[],
  convertedBlockIds: Iterable<string>,
): DailyPlanBlock[] {
  const converted = new Set(convertedBlockIds);
  return blocks.filter(
    (block) =>
      !converted.has(block.id) &&
      !block.id.startsWith("detailed-fixed:") &&
      !block.id.startsWith("detailed-event:"),
  );
}
