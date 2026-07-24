// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { select } from "d3-selection";
import {
  zoom,
  zoomIdentity,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3-zoom";
import { AlertTriangle, Maximize2, Minus, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  collectConnectedTaskIds,
  layoutTaskDependencyGraph,
  TASK_GRAPH_NODE_HEIGHT,
  TASK_GRAPH_NODE_WIDTH,
} from "@/lib/tasks/dependency-graph-layout";
import type {
  TaskDependencyGraphNode,
  TaskDependencyGraphResponse,
} from "@/types/task";

interface TaskDependencyMapProps {
  graph?: TaskDependencyGraphResponse;
  isLoading: boolean;
  isError: boolean;
  selectedTaskId: string | null;
  onSelectTask: (node: TaskDependencyGraphNode) => void;
}

function compactTitle(title: string) {
  return title.length > 27 ? `${title.slice(0, 26)}…` : title;
}

function stateLabel(node: TaskDependencyGraphNode) {
  if (node.status === "completed") return "完了";
  if (node.status === "cancelled") return "キャンセル";
  if (node.is_blocked) return "ブロック中";
  if (node.is_ready) return "Ready";
  return "未着手";
}

function stateColor(node: TaskDependencyGraphNode) {
  if (node.status === "completed") return "#16a34a";
  if (node.status === "cancelled") return "#94a3b8";
  if (node.is_blocked) return "#f59e0b";
  if (node.is_ready) return "#2563eb";
  return "#64748b";
}

export function TaskDependencyMap({
  graph,
  isLoading,
  isError,
  selectedTaskId,
  onSelectTask,
}: TaskDependencyMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const behaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const layout = useMemo(
    () => layoutTaskDependencyGraph(graph?.nodes ?? [], graph?.edges ?? []),
    [graph],
  );
  const nodeById = useMemo(
    () => new Map(layout.nodes.map((node) => [node.id, node])),
    [layout.nodes],
  );
  const connectedIds = useMemo(
    () => collectConnectedTaskIds(selectedTaskId, graph?.edges ?? []),
    [graph?.edges, selectedTaskId],
  );

  const fitGraph = useCallback(() => {
    const svg = svgRef.current;
    const viewport = viewportRef.current;
    const behavior = behaviorRef.current;
    if (
      !svg ||
      !viewport ||
      !behavior ||
      layout.width === 0 ||
      layout.height === 0
    )
      return;
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const scale = Math.min(
      1.25,
      Math.max(
        0.2,
        Math.min((width - 48) / layout.width, (height - 48) / layout.height),
      ),
    );
    const next = zoomIdentity
      .translate(
        (width - layout.width * scale) / 2,
        (height - layout.height * scale) / 2,
      )
      .scale(scale);
    select(svg).call(behavior.transform, next);
  }, [layout.height, layout.width]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.2, 2.5])
      .on("zoom", (event) => setTransform(event.transform));
    behaviorRef.current = behavior;
    select(svg).call(behavior);
    return () => {
      select(svg).on(".zoom", null);
      behaviorRef.current = null;
    };
  }, []);

  useEffect(() => {
    fitGraph();
  }, [fitGraph]);

  const zoomBy = (factor: number) => {
    const svg = svgRef.current;
    const behavior = behaviorRef.current;
    if (svg && behavior) select(svg).call(behavior.scaleBy, factor);
  };

  if (isLoading) {
    return (
      <div className="flex h-[560px] items-center justify-center text-muted-foreground">
        依存マップを読み込み中...
      </div>
    );
  }
  if (isError) {
    return (
      <div className="flex h-[560px] items-center justify-center text-destructive">
        依存マップを取得できませんでした
      </div>
    );
  }
  if (graph?.exceeds_limit) {
    return (
      <div className="flex h-[560px] flex-col items-center justify-center gap-3 px-6 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <div className="font-medium">表示対象が多すぎます</div>
        <p className="max-w-lg text-sm text-muted-foreground">
          直結タスクを含めて {graph.node_count} 件あります。{graph.limit}{" "}
          件以下になるよう、プロジェクト・ゴール・検索条件で絞り込んでください。
        </p>
      </div>
    );
  }
  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="flex h-[560px] items-center justify-center text-muted-foreground">
        条件に一致するタスクはありません
      </div>
    );
  }

  return (
    <div>
      <div
        ref={viewportRef}
        className="relative h-[560px] overflow-hidden bg-muted/20"
      >
        <div className="absolute right-3 top-3 z-10 flex gap-1 rounded-md border bg-background/95 p-1 shadow-sm">
          <Button
            size="icon"
            variant="ghost"
            aria-label="拡大"
            onClick={() => zoomBy(1.25)}
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="縮小"
            onClick={() => zoomBy(0.8)}
          >
            <Minus className="h-4 w-4" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="全体を表示"
            onClick={fitGraph}
          >
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
        <svg
          ref={svgRef}
          className="h-full w-full touch-none"
          aria-label="タスク依存マップ"
        >
          <defs>
            <marker
              id="task-dependency-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>
          <g transform={transform.toString()}>
            {(graph.edges ?? []).map((edge) => {
              const from = nodeById.get(edge.prerequisite_task_id);
              const to = nodeById.get(edge.dependent_task_id);
              if (!from || !to) return null;
              const active =
                selectedTaskId === null ||
                (connectedIds.has(from.id) && connectedIds.has(to.id));
              const x1 = from.x + TASK_GRAPH_NODE_WIDTH;
              const y1 = from.y + TASK_GRAPH_NODE_HEIGHT / 2;
              const x2 = to.x;
              const y2 = to.y + TASK_GRAPH_NODE_HEIGHT / 2;
              const bend = Math.max(36, (x2 - x1) / 2);
              return (
                <path
                  key={edge.id}
                  d={`M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke={active ? "#64748b" : "#cbd5e1"}
                  strokeWidth={active ? 2 : 1}
                  opacity={active ? 0.9 : 0.3}
                  markerEnd="url(#task-dependency-arrow)"
                  className="text-slate-500"
                />
              );
            })}
            {layout.nodes.map((node) => {
              const selected = node.id === selectedTaskId;
              const dimmed =
                selectedTaskId !== null && !connectedIds.has(node.id);
              return (
                <g
                  key={node.id}
                  transform={`translate(${node.x} ${node.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${node.title}、${stateLabel(node)}`}
                  onClick={() => onSelectTask(node)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ")
                      onSelectTask(node);
                  }}
                  className="cursor-pointer outline-none"
                  opacity={dimmed ? 0.28 : node.is_context ? 0.68 : 1}
                >
                  <rect
                    width={TASK_GRAPH_NODE_WIDTH}
                    height={TASK_GRAPH_NODE_HEIGHT}
                    rx={10}
                    fill="hsl(var(--background))"
                    stroke={
                      selected
                        ? "#2563eb"
                        : node.is_context
                          ? "#94a3b8"
                          : "#cbd5e1"
                    }
                    strokeWidth={selected ? 3 : 1.5}
                    strokeDasharray={node.is_context ? "6 4" : undefined}
                  />
                  <circle cx={16} cy={20} r={5} fill={stateColor(node)} />
                  <text
                    x={28}
                    y={24}
                    fontSize={12}
                    fontWeight={600}
                    fill="currentColor"
                  >
                    {stateLabel(node)}
                  </text>
                  <text
                    x={14}
                    y={52}
                    fontSize={14}
                    fontWeight={600}
                    fill="currentColor"
                  >
                    {compactTitle(node.title)}
                  </text>
                  <text x={14} y={76} fontSize={11} fill="#64748b">
                    {compactTitle(`${node.project_title} › ${node.goal_title}`)}
                  </text>
                  <text x={14} y={94} fontSize={10} fill="#64748b">
                    優先度 {node.priority}
                    {node.is_context ? " · フィルター外" : ""}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
        <span>矢印: 前提タスク → 後続タスク</span>
        <Badge variant="outline" className="border-dashed">
          フィルター外の直結タスク
        </Badge>
        <span>ノードを選択すると上流・下流を強調します</span>
      </div>
    </div>
  );
}
