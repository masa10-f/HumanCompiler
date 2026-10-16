// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

import {
  getStartableAssignments,
  type ScheduleAssignment,
} from "../schedule-candidates";

function assignment(
  taskId: string,
  startTime: string,
  durationHours = 1,
): ScheduleAssignment {
  return {
    task_id: taskId,
    task_title: taskId,
    goal_id: "goal-1",
    project_id: "project-1",
    slot_index: 0,
    start_time: startTime,
    duration_hours: durationHours,
    slot_start: startTime,
    slot_end: startTime,
    slot_kind: "focused_work",
  };
}

describe("getStartableAssignments", () => {
  it("drops Quick Tasks and keeps the first block of a split task", () => {
    const result = getStartableAssignments([
      assignment("quick_11111111-1111-4111-8111-111111111111", "09:00", 0.5),
      assignment("task-a", "09:30", 1.5),
      assignment("task-b", "11:00"),
      assignment("task-a", "12:00", 0.5),
    ]);

    expect(result.map((item) => [item.task_id, item.start_time])).toEqual([
      ["task-a", "09:30"],
      ["task-b", "11:00"],
    ]);
  });

  it("returns an empty list without a schedule", () => {
    expect(getStartableAssignments(undefined)).toEqual([]);
    expect(getStartableAssignments(null)).toEqual([]);
  });
});
