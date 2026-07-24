// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import {
  collectConnectedTaskIds,
  layoutTaskDependencyGraph,
} from "../dependency-graph-layout";
import type {
  TaskDependencyGraphEdge,
  TaskDependencyGraphNode,
} from "@/types/task";

const node = (id: string): TaskDependencyGraphNode => ({
  id,
  title: `Task ${id}`,
  status: "pending",
  project_id: "project-1",
  project_title: "Project",
  goal_id: "goal-1",
  goal_title: "Goal",
  is_ready: true,
  is_blocked: false,
  priority: 3,
  due_date: null,
  is_context: false,
});

const edge = (
  id: string,
  prerequisite: string,
  dependent: string,
): TaskDependencyGraphEdge => ({
  id,
  prerequisite_task_id: prerequisite,
  dependent_task_id: dependent,
  prerequisite_status: "pending",
});

describe("task dependency graph layout", () => {
  it("places prerequisites to the left of their dependents", () => {
    const layout = layoutTaskDependencyGraph(
      [node("prepare"), node("write"), node("publish")],
      [edge("e1", "prepare", "write"), edge("e2", "write", "publish")],
    );
    const positions = new Map(layout.nodes.map((item) => [item.id, item]));

    expect(positions.get("prepare")?.level).toBe(0);
    expect(positions.get("write")?.level).toBe(1);
    expect(positions.get("publish")?.level).toBe(2);
    expect(positions.get("prepare")?.x).toBeLessThan(
      positions.get("publish")?.x ?? 0,
    );
  });

  it("highlights the complete upstream and downstream neighborhood", () => {
    const edges = [
      edge("e1", "prepare", "write"),
      edge("e2", "write", "publish"),
      edge("e3", "unrelated", "other"),
    ];

    expect([...collectConnectedTaskIds("write", edges)].sort()).toEqual([
      "prepare",
      "publish",
      "write",
    ]);
  });

  it("keeps malformed cyclic legacy nodes visible", () => {
    const layout = layoutTaskDependencyGraph(
      [node("a"), node("b")],
      [edge("e1", "a", "b"), edge("e2", "b", "a")],
    );

    expect(layout.nodes).toHaveLength(2);
    expect(layout.nodes.every((item) => item.level > 0)).toBe(true);
  });
});
