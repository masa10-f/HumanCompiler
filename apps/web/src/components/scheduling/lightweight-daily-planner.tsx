// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { DailyPlanWorkspace } from "./daily-plan-workspace";
import type { DailyPlanDocumentV1 } from "@/types/daily-plan";

export function LightweightDailyPlanner(props: {
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  onSwitchDetailed: (document: DailyPlanDocumentV1, revision: number) => void;
}) {
  return <DailyPlanWorkspace {...props} />;
}
