// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import type {
  TaskDependencyGraphEdge,
  TaskDependencyGraphNode,
} from "@/types/task";

export const TASK_GRAPH_NODE_WIDTH = 224;
export const TASK_GRAPH_NODE_HEIGHT = 104;
const HORIZONTAL_GAP = 96;
const VERTICAL_GAP = 32;
const PADDING = 40;

export interface PositionedTaskGraphNode extends TaskDependencyGraphNode {
  x: number;
  y: number;
  level: number;
}

export interface TaskGraphLayout {
  nodes: PositionedTaskGraphNode[];
  width: number;
  height: number;
}

export function layoutTaskDependencyGraph(
  nodes: TaskDependencyGraphNode[],
  edges: TaskDependencyGraphEdge[],
): TaskGraphLayout {
  if (nodes.length === 0) return { nodes: [], width: 0, height: 0 };

  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const levels = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (
      !nodeIds.has(edge.prerequisite_task_id) ||
      !nodeIds.has(edge.dependent_task_id)
    ) {
      continue;
    }
    incoming.set(
      edge.dependent_task_id,
      (incoming.get(edge.dependent_task_id) ?? 0) + 1,
    );
    outgoing.get(edge.prerequisite_task_id)?.push(edge.dependent_task_id);
  }

  const queue = nodes
    .filter((node) => incoming.get(node.id) === 0)
    .map((node) => node.id)
    .sort();
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift() as string;
    visited.add(current);
    for (const dependent of outgoing.get(current) ?? []) {
      levels.set(
        dependent,
        Math.max(levels.get(dependent) ?? 0, (levels.get(current) ?? 0) + 1),
      );
      const remaining = (incoming.get(dependent) ?? 1) - 1;
      incoming.set(dependent, remaining);
      if (remaining === 0) queue.push(dependent);
    }
  }

  // The API prevents cycles, but keep malformed legacy data visible and inspectable.
  const fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const node of nodes) {
    if (!visited.has(node.id)) levels.set(node.id, fallbackLevel);
  }

  const groups = new Map<number, TaskDependencyGraphNode[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    groups.set(level, [...(groups.get(level) ?? []), node]);
  }

  const positioned: PositionedTaskGraphNode[] = [];
  let maxRows = 1;
  for (const [level, levelNodes] of [...groups.entries()].sort(
    ([a], [b]) => a - b,
  )) {
    levelNodes.sort(
      (a, b) =>
        Number(a.is_context) - Number(b.is_context) ||
        a.project_title.localeCompare(b.project_title, "ja") ||
        a.title.localeCompare(b.title, "ja"),
    );
    maxRows = Math.max(maxRows, levelNodes.length);
    levelNodes.forEach((node, index) => {
      positioned.push({
        ...node,
        level,
        x: PADDING + level * (TASK_GRAPH_NODE_WIDTH + HORIZONTAL_GAP),
        y: PADDING + index * (TASK_GRAPH_NODE_HEIGHT + VERTICAL_GAP),
      });
    });
  }

  const maxLevel = Math.max(...positioned.map((node) => node.level));
  return {
    nodes: positioned,
    width:
      PADDING * 2 +
      (maxLevel + 1) * TASK_GRAPH_NODE_WIDTH +
      maxLevel * HORIZONTAL_GAP,
    height:
      PADDING * 2 +
      maxRows * TASK_GRAPH_NODE_HEIGHT +
      (maxRows - 1) * VERTICAL_GAP,
  };
}

export function collectConnectedTaskIds(
  selectedId: string | null,
  edges: TaskDependencyGraphEdge[],
): Set<string> {
  if (!selectedId) return new Set();

  const connected = new Set([selectedId]);
  const walk = (direction: "upstream" | "downstream") => {
    const queue = [selectedId];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const edge of edges) {
        const next =
          direction === "upstream"
            ? edge.dependent_task_id === current
              ? edge.prerequisite_task_id
              : null
            : edge.prerequisite_task_id === current
              ? edge.dependent_task_id
              : null;
        if (next && !connected.has(next)) {
          connected.add(next);
          queue.push(next);
        }
      }
    }
  };
  walk("upstream");
  walk("downstream");
  return connected;
}
