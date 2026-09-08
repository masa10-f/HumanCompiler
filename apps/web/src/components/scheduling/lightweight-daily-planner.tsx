// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Placeholder from "@tiptap/extension-placeholder";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Coffee,
  GripVertical,
  HelpCircle,
  Loader2,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useProjectOptions } from "@/hooks/use-project-query";
import { dailyPlansApi, goalsApi, quickTasksApi, tasksApi } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import {
  addDailyPlanClockMinutes,
  dailyPlanTimeRangesOverlap,
  parseBreakLine,
  parseDurationMinutes,
  parseScheduleDirective,
  parseTimedLine,
  updateDailyPlanTimeRange,
} from "@/lib/daily-plan-command";
import { applyDirectiveTaskSelection } from "@/lib/daily-plan-adapter";
import {
  extractDailyPlanMention,
  isPermanentDailyPlanSaveError,
  matchDailyPlanTasks,
  missingDailyPlanBlockIds,
  stripDailyPlanDuration,
} from "@/lib/daily-plan-editor";
import type { Goal } from "@/types/goal";
import type { QuickTask } from "@/types/quick-task";
import type { TaskWorkspaceItem, WorkType } from "@/types/task";
import type {
  DailyPlanAssignment,
  DailyPlanAvailabilityWindow,
  DailyPlanBlock,
  DailyPlanChecklistItem,
  DailyPlanDirectiveFilter,
  DailyPlanDirectiveWindow,
  DailyPlanDocumentV1,
  DailyPlanResponse,
  DailyPlanScheduleDirective,
  DailyPlanTaskRef,
  DailyPlanTimedLine,
} from "@/types/daily-plan";

interface LightweightDailyPlannerProps {
  selectedDate: string;
  onSelectedDateChange: (date: string) => void;
  onSwitchDetailed: (document: DailyPlanDocumentV1, revision: number) => void;
}

interface TaskOption {
  key: string;
  ref: DailyPlanTaskRef;
  title: string;
  workType: WorkType;
  projectId?: string;
  projectTitle?: string;
  goalId?: string;
  goalTitle?: string;
  remainingHours: number;
  isFallback?: boolean;
}

const EMPTY_DOCUMENT: DailyPlanDocumentV1 = {
  schema_version: 1,
  availability_windows: [
    { start: "09:00", end: "18:00", work_type: "light_work" },
  ],
  blocks: [],
};

const workTypeLabels: Record<WorkType, string> = {
  light_work: "軽作業",
  focused_work: "集中作業",
  study: "学習",
};

function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `block-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function refKey(ref: DailyPlanTaskRef): string {
  return `${ref.source}:${ref.id}`;
}

function fallbackTaskOption(ref: DailyPlanTaskRef, title: string): TaskOption {
  return {
    key: refKey(ref),
    ref,
    title,
    workType: "light_work",
    remainingHours: 0.5,
    isFallback: true,
  };
}

function assignmentMinutes(assignment: DailyPlanAssignment): number {
  return Math.max(1, Math.round(assignment.duration_hours * 60));
}

const MAX_AUTOSAVE_RETRIES = 3;

export function LightweightDailyPlanner({
  selectedDate,
  onSelectedDateChange,
  onSwitchDetailed,
}: LightweightDailyPlannerProps) {
  const { toast } = useToast();
  const { data: projects = [] } = useProjectOptions();
  const [document, setDocument] = useState<DailyPlanDocumentV1>(EMPTY_DOCUMENT);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const documentRef = useRef(document);
  const saveInFlightRef = useRef<Promise<DailyPlanResponse> | null>(null);
  const [schedule, setSchedule] = useState<DailyPlanResponse["schedule"]>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [saveSignal, setSaveSignal] = useState(0);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const [ambiguousMention, setAmbiguousMention] = useState<{ input: string; options: TaskOption[] } | null>(null);
  const [conflict, setConflict] = useState(false);
  const [helpOpen, setHelpOpen] = useState(true);
  const [command, setCommand] = useState("");
  const [regularTasks, setRegularTasks] = useState<TaskWorkspaceItem[]>([]);
  const [quickTasks, setQuickTasks] = useState<QuickTask[]>([]);
  const [completionAssignment, setCompletionAssignment] =
    useState<DailyPlanAssignment | null>(null);
  const [completionChecklistBlockId, setCompletionChecklistBlockId] = useState<
    string | null
  >(null);
  const [actualMinutes, setActualMinutes] = useState(30);
  const [taskActionPending, setTaskActionPending] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newTaskInsertKind, setNewTaskInsertKind] = useState<
    "directive" | "checklist"
  >("directive");
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskMinutes, setNewTaskMinutes] = useState(30);
  const [newTaskAllowedWindow, setNewTaskAllowedWindow] = useState<
    DailyPlanDirectiveWindow | undefined
  >();
  const [newTaskWorkType, setNewTaskWorkType] =
    useState<WorkType>("light_work");
  const [newTaskPriority, setNewTaskPriority] = useState("3");
  const [newTaskDestination, setNewTaskDestination] = useState<
    "quick" | "goal"
  >("quick");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskGoalId, setNewTaskGoalId] = useState("");
  const [newTaskGoals, setNewTaskGoals] = useState<Goal[]>([]);
  const [creatingTask, setCreatingTask] = useState(false);

  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    revisionRef.current = revision;
  }, [revision]);

  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  const loadTasks = useCallback(async () => {
    const [workspace, quick] = await Promise.all([
      (async () => {
        const items: TaskWorkspaceItem[] = [];
        let skip = 0;
        while (true) {
          const page = await tasksApi.getWorkspace({ skip, limit: 100, status: ["pending", "in_progress"] });
          items.push(...page.items);
          skip += page.items.length;
          if (!page.items.length || skip >= page.total) return items;
        }
      })(),
      (async () => {
        const items: QuickTask[] = [];
        let skip = 0;
        while (true) {
          const page = await quickTasksApi.getAll(skip, 100);
          items.push(...page);
          skip += page.length;
          if (page.length < 100) return items;
        }
      })(),
    ]);
    setRegularTasks(workspace);
    setQuickTasks(
      quick.filter(
        (item) => item.status !== "completed" && item.status !== "cancelled",
      ),
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setConflict(false);
    setSaveError(null);
    setAutosavePaused(false);
    Promise.all([dailyPlansApi.get(selectedDate), loadTasks()])
      .then(([response]) => {
        if (cancelled) return;
        setDocument(response.document);
        documentRef.current = response.document;
        setRevision(response.revision);
        revisionRef.current = response.revision;
        setSchedule(response.schedule ?? null);
        setDirty(false);
        dirtyRef.current = false;
        setSaveRetry(0);
      })
      .catch((error) => {
        if (cancelled) return;
        toast({
          title: "日次文書の読み込みに失敗しました",
          description: error instanceof Error ? error.message : "不明なエラー",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadTasks, selectedDate, toast]);

  const taskOptions = useMemo<TaskOption[]>(
    () => [
      ...regularTasks.map((task) => ({
        key: `task:${task.id}`,
        ref: { source: "task" as const, id: task.id },
        title: task.title,
        workType: task.work_type ?? "light_work",
        projectId: task.project_id,
        projectTitle: task.project_title,
        goalId: task.goal_id,
        goalTitle: task.goal_title,
        remainingHours: task.remaining_estimate_hours,
      })),
      ...quickTasks.map((task) => ({
        key: `quick_task:${task.id}`,
        ref: { source: "quick_task" as const, id: task.id },
        title: task.title,
        workType: task.work_type,
        remainingHours: task.estimate_hours,
      })),
    ],
    [quickTasks, regularTasks],
  );

  const updateDocument = useCallback(
    (updater: (current: DailyPlanDocumentV1) => DailyPlanDocumentV1) => {
      setDocument((current) => {
        const next = updater(current);
        documentRef.current = next;
        return next;
      });
      setDirty(true);
      dirtyRef.current = true;
      setSaveRetry(0);
      setAutosavePaused(false);
      setSaveError(null);
    },
    [],
  );

  const saveNow = useCallback((): Promise<DailyPlanResponse> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;

    const operation = async (): Promise<DailyPlanResponse> => {
      if (!dirtyRef.current) {
        return dailyPlansApi.get(selectedDate);
      }
      setSaving(true);
      try {
        const snapshot = documentRef.current;
        const response = await dailyPlansApi.update(
          selectedDate,
          revisionRef.current,
          snapshot,
        );
        setRevision(response.revision);
        revisionRef.current = response.revision;
        setSaveRetry(0);
        setSaveError(null);
        setAutosavePaused(false);
        if (documentRef.current === snapshot) {
          setDirty(false);
          dirtyRef.current = false;
        } else {
          // Re-arm the debounce after the in-flight request settles. This avoids
          // one PUT per network round-trip during continuous typing.
          setSaveSignal((current) => current + 1);
        }
        setConflict(false);
        return response;
      } catch (error) {
        if (error instanceof ApiError && error.statusCode === 409) {
          setConflict(true);
        } else {
          setSaveError(error instanceof Error ? error : new Error("保存に失敗しました"));
          if (isPermanentDailyPlanSaveError(error)) setAutosavePaused(true);
        }
        throw error;
      } finally {
        setSaving(false);
      }
    };

    const promise = operation().finally(() => {
      saveInFlightRef.current = null;
    });
    saveInFlightRef.current = promise;
    return promise;
  }, [selectedDate]);

  const flushPendingSaves =
    useCallback(async (): Promise<DailyPlanResponse> => {
      let response = await saveNow();
      for (let attempt = 0; dirtyRef.current && attempt < 5; attempt += 1) {
        response = await saveNow();
      }
      if (dirtyRef.current) {
        throw new Error(
          "編集中の変更を保存できませんでした。入力を止めて再度お試しください。",
        );
      }
      return response;
    }, [saveNow]);

  useEffect(() => {
    if (!dirty || loading || conflict || autosavePaused) return;
    const timer = window.setTimeout(() => {
      void saveNow().catch((error) => {
        if (!(error instanceof ApiError && error.statusCode === 409)) {
          if (isPermanentDailyPlanSaveError(error) || saveRetry >= MAX_AUTOSAVE_RETRIES) {
            setAutosavePaused(true);
          } else {
            setSaveRetry((current) => current + 1);
          }
          if (saveRetry === 0) toast({
            title: "自動保存に失敗しました", description: "内容はこの画面に残っています。保存エラーの表示を確認してください。",
            variant: "destructive",
          });
        }
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [
    conflict,
    autosavePaused,
    dirty,
    document,
    loading,
    saveNow,
    saveRetry,
    saveSignal,
    toast,
  ]);

  const replaceBlock = useCallback(
    (id: string, next: DailyPlanBlock) => {
      updateDocument((current) => ({
        ...current,
        blocks: current.blocks.map((block) => (block.id === id ? next : block)),
      }));
    },
    [updateDocument],
  );

  const removeBlock = useCallback(
    (id: string) => {
      updateDocument((current) => ({
        ...current,
        blocks: current.blocks.filter((block) => block.id !== id),
      }));
    },
    [updateDocument],
  );

  const detachMissingTask = (blockId: string) => {
    updateDocument((current) => ({
      ...current,
      blocks: current.blocks.map((block) => {
        if (block.id !== blockId) return block;
        if (block.type === "schedule_directive") {
          // Do not turn a missing specific task into an unrestricted filter.
          // Keep its intent as a note until the user chooses a replacement.
          return { id: block.id, type: "text" as const, text: [
            "/schedule", block.title ?? "参照を解除したタスク",
            block.duration_override_minutes ? `(${block.duration_override_minutes}m)` : "",
            ...(block.allowed_windows ?? []).map((window) => `${window.start}-${window.end}`),
          ].filter(Boolean).join(" ") };
        }
        if (block.type === "timed_line" || block.type === "checklist_item") {
          return { ...block, task_ref: undefined };
        }
        return block;
      }),
    }));
  };

  const moveBlock = useCallback(
    (index: number, direction: -1 | 1) => {
      updateDocument((current) => {
        const target = index + direction;
        if (target < 0 || target >= current.blocks.length) return current;
        const blocks = [...current.blocks];
        const currentBlock = blocks[index];
        const targetBlock = blocks[target];
        if (!currentBlock || !targetBlock) return current;
        blocks[index] = targetBlock;
        blocks[target] = currentBlock;
        return { ...current, blocks };
      });
    },
    [updateDocument],
  );

  const submitCommand = (input = command, selectedTask?: TaskOption) => {
    const value = input.trim();
    if (!value) return;
    const mention = extractDailyPlanMention(value);
    const matches = matchDailyPlanTasks(value, taskOptions);
    if (!selectedTask && matches.length > 1) {
      setAmbiguousMention({ input: value, options: matches });
      return;
    }
    const mentioned = selectedTask ?? matches[0];
    if (
      mention &&
      !mentioned &&
      (value.startsWith("/schedule") || /^-?\s*\[\s?\]/.test(value))
    ) {
      const directive = value.startsWith("/schedule")
        ? parseScheduleDirective(value)
        : null;
      setNewTaskTitle(mention);
      setNewTaskMinutes(
        directive?.durationMinutes ?? parseDurationMinutes(value) ?? 30,
      );
      setNewTaskAllowedWindow(directive?.allowedWindow);
      setNewTaskInsertKind(
        /^-?\s*\[\s?\]/.test(value) ? "checklist" : "directive",
      );
      setCreateOpen(true);
      return;
    }
    let block: DailyPlanBlock;
    if (value.startsWith("/schedule")) {
      const directive = parseScheduleDirective(value);
      block = {
        id: createId(),
        type: "schedule_directive",
        mode: mentioned ? "task" : "filter",
        title: mentioned?.title,
        task_ref: mentioned?.ref,
        duration_override_minutes: directive?.durationMinutes,
        allowed_windows: directive?.allowedWindow
          ? [directive.allowedWindow]
          : [],
        filter: mentioned
          ? undefined
          : { work_types: [], project_ids: [], goal_ids: [] },
      };
    } else {
      const breakLine = parseBreakLine(value);
      const timed = breakLine ?? parseTimedLine(value);
      if (timed) {
        block = {
          id: createId(),
          type: "timed_line",
          start: timed.start,
          end: timed.end,
          title: breakLine ? timed.title : (mentioned?.title ?? timed.title),
          task_ref: breakLine ? undefined : mentioned?.ref,
          pinned: true,
          kind: breakLine ? "break" : "event",
        };
      } else if (/^-?\s*\[\s?\]/.test(value)) {
        const title = stripDailyPlanDuration(value.replace(/^-?\s*\[\s?\]\s*/, ""));
        if (!title) return;
        block = {
          id: createId(),
          type: "checklist_item",
          title: mentioned?.title ?? title,
          checked: false,
          task_ref: mentioned?.ref,
          duration_override_minutes: parseDurationMinutes(value),
        };
      } else {
        block = { id: createId(), type: "text", text: value };
      }
    }
    updateDocument((current) => ({
      ...current,
      blocks: [...current.blocks, block],
    }));
    setCommand("");
  };

  const generate = async () => {
    setGenerating(true);
    try {
      await flushPendingSaves();
      const response = await dailyPlansApi.generate(selectedDate);
      setSchedule(response.schedule ?? null);
      if (response.schedule?.success) {
        toast({
          title: "予定を自動生成しました",
          description: `${response.schedule.assignments.length}件を保存しました`,
        });
      } else {
        const unscheduledCount =
          response.schedule?.unscheduled_tasks?.length ?? 0;
        toast({
          title: "予定を生成できませんでした",
          description: `${response.schedule?.optimization_status ?? "SOLVER_ERROR"}（未配置 ${unscheduledCount}件）`,
          variant: "destructive",
        });
      }
    } catch (error) {
      if (missingDailyPlanBlockIds(error).length) {
        setSaveError(error instanceof Error ? error : new Error("参照タスクが見つかりません"));
      }
      toast({
        title: "自動生成に失敗しました",
        description: error instanceof Error ? error.message : "不明なエラー",
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
    }
  };

  const switchToDetailed = async () => {
    try {
      const response = await flushPendingSaves();
      onSwitchDetailed(response.document, response.revision);
    } catch (error) {
      toast({
        title: "詳細モードへ切り替えられませんでした",
        description:
          error instanceof Error ? error.message : "保存状態を確認してください",
        variant: "destructive",
      });
    }
  };

  const changeSelectedDate = async (nextDate: string) => {
    if (!nextDate || nextDate === selectedDate) return;
    try {
      if (dirtyRef.current || saveInFlightRef.current)
        await flushPendingSaves();
      onSelectedDateChange(nextDate);
    } catch (error) {
      toast({
        title: "日付を変更できませんでした",
        description:
          error instanceof Error
            ? error.message
            : "先に現在の文書を保存してください",
        variant: "destructive",
      });
    }
  };

  const pinAssignment = (
    assignment: DailyPlanAssignment,
    start = assignment.start_time,
    end = assignment.slot_end,
  ) => {
    if (assignment.is_fixed) return;
    const pinned: DailyPlanTimedLine = {
      id: createId(),
      type: "timed_line",
      start,
      end,
      title: assignment.task_title,
      task_ref: {
        source: assignment.source ??
          (assignment.task_id.startsWith("quick_") ? "quick_task" : "task"),
        id: assignment.task_id.replace(/^quick_/, ""),
      },
      pinned: true,
    };
    updateDocument((current) => ({
      ...current,
      blocks: current.blocks.some(
        (block) =>
          block.type === "timed_line" &&
          block.start === start &&
          block.end === end &&
          block.task_ref?.source === pinned.task_ref?.source &&
          block.task_ref?.id === pinned.task_ref?.id,
      )
        ? current.blocks
        : [...current.blocks, pinned],
    }));
    // The editable fixed line replaces this generated row immediately, even
    // before regeneration. This also prevents repeated clicks from pinning it.
    setSchedule((current) => current
      ? {
          ...current,
          assignments: current.assignments.filter((item) => item !== assignment),
        }
      : current,
    );
    toast({
      title: "固定行へ追加しました",
      description: "再生成時も時刻を維持します",
    });
  };

  const openCompletion = (assignment: DailyPlanAssignment) => {
    setCompletionChecklistBlockId(null);
    setCompletionAssignment(assignment);
    setActualMinutes(assignmentMinutes(assignment));
  };

  const openChecklistCompletion = (
    block: DailyPlanChecklistItem,
    task: TaskOption,
  ) => {
    const plannedMinutes =
      block.duration_override_minutes ??
      Math.max(1, Math.round(task.remainingHours * 60));
    setCompletionChecklistBlockId(block.id);
    setCompletionAssignment({
      task_id:
        task.ref.source === "quick_task" ? `quick_${task.ref.id}` : task.ref.id,
      task_title: task.title,
      goal_id: task.goalId ?? "",
      project_id: task.projectId ?? "",
      slot_index: 0,
      start_time: "00:00",
      duration_hours: plannedMinutes / 60,
      slot_start: "00:00",
      slot_end: "00:00",
      slot_kind: task.workType,
      is_fixed: true,
      source: task.ref.source,
    });
    setActualMinutes(plannedMinutes);
  };

  const applyTaskAction = async (action: "continue" | "complete") => {
    if (!completionAssignment) return;
    const source =
      completionAssignment.source ??
      (completionAssignment.task_id.startsWith("quick_")
        ? "quick_task"
        : "task");
    setTaskActionPending(true);
    try {
      await dailyPlansApi.applyTaskAction(selectedDate, {
        task_ref: {
          source,
          id: completionAssignment.task_id.replace(/^quick_/, ""),
        },
        action,
        actual_minutes: source === "task" ? actualMinutes : undefined,
      });
      if (completionChecklistBlockId && action === "complete") {
        updateDocument((current) => ({
          ...current,
          blocks: current.blocks.map((block) =>
            block.id === completionChecklistBlockId &&
            block.type === "checklist_item"
              ? { ...block, checked: true }
              : block,
          ),
        }));
      }
      setCompletionAssignment(null);
      setCompletionChecklistBlockId(null);
      await loadTasks();
      toast({
        title:
          action === "complete"
            ? "タスクを完了しました"
            : "実働時間を記録しました",
      });
    } catch (error) {
      toast({
        title: "タスクの更新に失敗しました",
        description: error instanceof Error ? error.message : "不明なエラー",
        variant: "destructive",
      });
    } finally {
      setTaskActionPending(false);
    }
  };

  useEffect(() => {
    if (newTaskDestination === "quick" || !newTaskProjectId) {
      setNewTaskGoals([]);
      setNewTaskGoalId("");
      return;
    }
    goalsApi
      .getByProject(newTaskProjectId, 0, 100)
      .then(setNewTaskGoals)
      .catch(() => {
        setNewTaskGoals([]);
      });
  }, [newTaskDestination, newTaskProjectId]);

  const createTask = async () => {
    if (!newTaskTitle.trim()) return;
    if (newTaskDestination === "goal" && !newTaskGoalId) {
      toast({ title: "ゴールを選択してください", variant: "destructive" });
      return;
    }
    setCreatingTask(true);
    try {
      let ref: DailyPlanTaskRef;
      let title: string;
      const estimateHours = Math.round((newTaskMinutes / 60) * 100) / 100;
      if (newTaskDestination === "quick") {
        const created = await quickTasksApi.create({
          title: newTaskTitle.trim(),
          estimate_hours: estimateHours,
          work_type: newTaskWorkType,
          priority: Number(newTaskPriority),
        });
        ref = { source: "quick_task", id: created.id };
        title = created.title;
      } else {
        const created = await tasksApi.create({
          title: newTaskTitle.trim(),
          estimate_hours: estimateHours,
          work_type: newTaskWorkType,
          priority: Number(newTaskPriority),
          goal_id: newTaskGoalId,
        });
        ref = { source: "task", id: created.id };
        title = created.title;
      }
      const insertedBlock: DailyPlanBlock =
        newTaskInsertKind === "checklist"
          ? {
              id: createId(),
              type: "checklist_item",
              title,
              checked: false,
              task_ref: ref,
              duration_override_minutes: newTaskMinutes,
            }
          : {
              id: createId(),
              type: "schedule_directive",
              mode: "task",
              title,
              task_ref: ref,
              duration_override_minutes: newTaskMinutes,
              allowed_windows: newTaskAllowedWindow
                ? [newTaskAllowedWindow]
                : [],
            };
      updateDocument((current) => ({
        ...current,
        blocks: [...current.blocks, insertedBlock],
      }));
      await loadTasks();
      setCreateOpen(false);
      setNewTaskTitle("");
      setCommand("");
      setNewTaskInsertKind("directive");
      setNewTaskAllowedWindow(undefined);
      setNewTaskDestination("quick");
      setNewTaskProjectId("");
      setNewTaskGoalId("");
      toast({ title: "タスクを追加しました" });
    } catch (error) {
      toast({
        title: "タスク作成に失敗しました",
        description: error instanceof Error ? error.message : "不明なエラー",
        variant: "destructive",
      });
    } finally {
      setCreatingTask(false);
    }
  };

  const reloadServerVersion = async () => {
    const response = await dailyPlansApi.get(selectedDate);
    setDocument(response.document);
    documentRef.current = response.document;
    setRevision(response.revision);
    revisionRef.current = response.revision;
    setSchedule(response.schedule ?? null);
    setDirty(false);
    dirtyRef.current = false;
    setSaveRetry(0);
    setConflict(false);
    setSaveError(null);
    setAutosavePaused(false);
  };

  const overwriteServerVersion = async () => {
    setSaving(true);
    try {
      const latest = await dailyPlansApi.get(selectedDate);
      const snapshot = documentRef.current;
      const response = await dailyPlansApi.update(
        selectedDate,
        latest.revision,
        snapshot,
      );
      setRevision(response.revision);
      revisionRef.current = response.revision;
      if (documentRef.current === snapshot) {
        setDirty(false);
        dirtyRef.current = false;
      } else {
        setSaveSignal((current) => current + 1);
      }
      setSaveRetry(0);
      setConflict(false);
      setSaveError(null);
      setAutosavePaused(false);
      setSchedule(response.schedule ?? null);
      toast({ title: "この画面の内容で保存しました" });
    } catch (error) {
      toast({
        title: "上書き保存に失敗しました",
        description: error instanceof Error ? error.message : "不明なエラー",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
        <AppHeader currentPage="scheduling-daily" />
        <div className="flex min-h-[70vh] items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-blue-600" />
        </div>
      </div>
    );
  }

  const scheduleStale = Boolean(schedule &&
    (dirty || schedule.source_document_revision !== revision));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="scheduling-daily" />
      <main className="container mx-auto max-w-5xl px-4 py-6">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">日次プラン</h1>
            <p className="text-sm text-gray-500">
              時刻付きの行と /schedule を同じページに書けます
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="gap-1">
              {saving ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              {saving ? "保存中" : dirty ? "未保存" : "保存済み"}
            </Badge>
            <Button
              variant="outline"
              onClick={switchToDetailed}
              disabled={generating || (saving && conflict)}
            >
              詳細モード
            </Button>
            <Button onClick={generate} disabled={generating || conflict}>
              {generating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="mr-2 h-4 w-4" />
              )}
              自動スケジュール
            </Button>
          </div>
        </div>

        <Card className="mb-4 border-blue-100 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
          <CardContent className="py-3">
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-between px-1"
              aria-expanded={helpOpen}
              onClick={() => setHelpOpen((current) => !current)}
            >
              <span className="flex items-center gap-2 font-medium">
                <HelpCircle className="h-4 w-4" />
                このページの入力方法
              </span>
              {helpOpen ? (
                <ChevronUp className="h-4 w-4" />
              ) : (
                <ChevronDown className="h-4 w-4" />
              )}
            </Button>
            {helpOpen && (
              <div className="mt-3 grid gap-2 text-sm text-gray-600 dark:text-gray-300 sm:grid-cols-2">
                <HelpExample code="1100-1200 会議" label="固定予定" />
                <HelpExample code="/break 12:00-13:00 昼休み" label="休憩" />
                <HelpExample
                  code="/schedule @論文読み (2h)"
                  label="特定タスクを2時間配置"
                />
                <HelpExample
                  code="/schedule 13:00-17:00 (90m)"
                  label="条件型を時間帯内へ90分配置"
                />
                <HelpExample
                  code="[ ] @メール返信 (30m)"
                  label="チェックリスト"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {scheduleStale && (
          <Alert className="mb-4">
            <AlertDescription>再生成が必要です。表示中の予定・診断は以前の文書に対する結果です。</AlertDescription>
          </Alert>
        )}

        {saveError && !conflict && (
          <Alert variant="destructive" className="mb-4">
            <AlertTitle>保存・参照エラー</AlertTitle>
            <AlertDescription>
              <p>{saveError.message}。内容はこの画面に残っています。修正後に再試行してください。</p>
              {missingDailyPlanBlockIds(saveError).map((blockId) => {
                const block = document.blocks.find((item) => item.id === blockId);
                if (!block || block.type === "text") return null;
                return <div key={blockId} className="my-2">
                  <span>参照先が見つかりません: {block.title ?? blockId}。制御行の参照解除はメモへ変換します。</span>
                  <Button size="sm" variant="outline" disabled={saving}
                    onClick={() => detachMissingTask(blockId)}>
                    {block.title ?? blockId} の参照を解除
                  </Button>
                </div>;
              })}
              <Button size="sm" variant="outline" disabled={saving}
                onClick={() => { void saveNow().catch(() => {}); }}>
                保存を再試行
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {conflict && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>別の画面で内容が更新されています</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              サーバー側の最新版か、この画面のローカル版を選んでください。
              <span className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={reloadServerVersion}
                  disabled={saving}
                >
                  最新版を読み込む
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={overwriteServerVersion}
                  disabled={saving}
                >
                  ローカル版で上書き
                </Button>
              </span>
            </AlertDescription>
          </Alert>
        )}

        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-end gap-3 py-4">
            <div className="space-y-1">
              <Label>対象日</Label>
              <Input
                type="date"
                value={selectedDate}
                disabled={generating || (saving && conflict)}
                onChange={(event) =>
                  void changeSelectedDate(event.target.value)
                }
                className="w-40"
              />
            </div>
            {document.availability_windows.map((window, index) => (
              <div
                key={index}
                className="flex flex-wrap items-end gap-2 rounded-md border p-2"
              >
                <div>
                  <Label className="text-xs">利用開始</Label>
                  <Input
                    type="time"
                    value={window.start}
                    onChange={(event) => {
                      const next = updateDailyPlanTimeRange(
                        window,
                        "start",
                        event.target.value,
                      );
                      if (!next) return;
                      updateDocument((current) => ({
                        ...current,
                        availability_windows: (() => {
                          const windows = current.availability_windows.map(
                            (item, itemIndex) =>
                              itemIndex === index ? { ...item, ...next } : item,
                          );
                          return dailyPlanTimeRangesOverlap(windows)
                            ? current.availability_windows
                            : windows;
                        })(),
                      }));
                    }}
                    className="w-28"
                  />
                </div>
                <div>
                  <Label className="text-xs">利用終了</Label>
                  <Input
                    type="time"
                    value={window.end}
                    onChange={(event) => {
                      const next = updateDailyPlanTimeRange(
                        window,
                        "end",
                        event.target.value,
                      );
                      if (!next) return;
                      updateDocument((current) => ({
                        ...current,
                        availability_windows: (() => {
                          const windows = current.availability_windows.map(
                            (item, itemIndex) =>
                              itemIndex === index ? { ...item, ...next } : item,
                          );
                          return dailyPlanTimeRangesOverlap(windows)
                            ? current.availability_windows
                            : windows;
                        })(),
                      }));
                    }}
                    className="w-28"
                  />
                </div>
                <Select
                  value={window.work_type}
                  onValueChange={(value: WorkType) =>
                    updateDocument((current) => ({
                      ...current,
                      availability_windows: current.availability_windows.map(
                        (item, itemIndex) =>
                          itemIndex === index
                            ? { ...item, work_type: value }
                            : item,
                      ),
                    }))
                  }
                >
                  <SelectTrigger className="w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(workTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {document.availability_windows.length > 1 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() =>
                      updateDocument((current) => ({
                        ...current,
                        availability_windows:
                          current.availability_windows.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                      }))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                updateDocument((current) => {
                  const last = [...current.availability_windows]
                    .sort((left, right) => left.end.localeCompare(right.end))
                    .at(-1);
                  const start = last?.end ?? "09:00";
                  const end = addDailyPlanClockMinutes(start, 60);
                  if (!end) return current;
                  return {
                    ...current,
                    availability_windows: [
                      ...current.availability_windows,
                      { start, end, work_type: "light_work" },
                    ],
                  };
                })
              }
            >
              <Plus className="mr-1 h-4 w-4" />
              作業可能時間を追加
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 py-5">
            {document.blocks.length === 0 && (
              <div className="py-10 text-center text-gray-400">
                <Clock3 className="mx-auto mb-2 h-10 w-10 opacity-40" />
                <p>まだ行がありません</p>
                <p className="text-sm">
                  例: 1100-1200 会議 / /schedule @論文読み (1h)
                </p>
              </div>
            )}
            {schedule?.unused_minutes !== undefined && (
              <p className="text-right text-sm text-gray-500">
                当日の未使用時間: {schedule.unused_minutes}分
              </p>
            )}
            {Boolean(schedule?.violations?.length) && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>固定予定をすべて配置できませんでした</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {schedule?.violations?.map((violation, index) => (
                      <li
                        key={`${violation.code}-${violation.task_id ?? index}`}
                      >
                        {violation.message}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {document.blocks.map((block, index) => {
              const assignments =
                schedule?.assignments.filter(
                  (item) => item.directive_id === block.id,
                ) ?? [];
              const diagnostic = schedule?.directive_diagnostics?.find(
                (item) => item.directive_id === block.id,
              );
              return (
                <div
                  key={block.id}
                  className="group flex items-start gap-2 rounded-lg border border-transparent px-2 py-2 hover:border-gray-200 hover:bg-gray-50 dark:hover:border-gray-700 dark:hover:bg-gray-800/50"
                >
                  <GripVertical className="mt-2 h-4 w-4 shrink-0 text-gray-300" />
                  <div className="min-w-0 flex-1">
                    {block.type === "timed_line" && (
                      <TimedLineEditor
                        block={block}
                        taskOptions={taskOptions}
                        onChange={(next) => replaceBlock(block.id, next)}
                      />
                    )}
                    {block.type === "schedule_directive" && (
                      <DirectiveEditor
                        block={block}
                        taskOptions={taskOptions}
                        projects={projects}
                        availabilityWindows={document.availability_windows}
                        onChange={(next) => replaceBlock(block.id, next)}
                      />
                    )}
                    {block.type === "checklist_item" && (
                      <ChecklistEditor
                        block={block}
                        taskOptions={taskOptions}
                        onChange={(next) => replaceBlock(block.id, next)}
                        onComplete={(task) =>
                          openChecklistCompletion(block, task)
                        }
                      />
                    )}
                    {block.type === "text" && (
                      <Input
                        value={block.text}
                        onChange={(event) =>
                          replaceBlock(block.id, {
                            ...block,
                            text: event.target.value,
                          })
                        }
                        className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      />
                    )}
                    {assignments.length > 0 && (
                      <div className="mt-2 space-y-1 border-l-2 border-blue-200 pl-3">
                        {assignments.map((assignment, assignmentIndex) => (
                          <GeneratedAssignmentRow
                            key={`${assignment.task_id}-${assignment.start_time}-${assignmentIndex}`}
                            assignment={assignment}
                            onPin={pinAssignment}
                            onComplete={openCompletion}
                          />
                        ))}
                      </div>
                    )}
                    {diagnostic?.reason && (
                      <p className="mt-2 text-sm text-amber-700">
                        {diagnostic.reason}（候補 {diagnostic.eligible_count}
                        件）
                      </p>
                    )}
                  </div>
                  <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => moveBlock(index, -1)}
                    >
                      <ChevronUp className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={index === document.blocks.length - 1}
                      onClick={() => moveBlock(index, 1)}
                    >
                      <ChevronDown className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeBlock(block.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              );
            })}
            <div className="mt-3 flex gap-2 border-t pt-4">
              <DailyPlanCommandComposer
                value={command}
                onChange={setCommand}
                onSubmit={submitCommand}
              />
              <Button variant="outline" onClick={() => submitCommand()}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setNewTaskInsertKind("directive");
                  setNewTaskAllowedWindow(undefined);
                  setCreateOpen(true);
                }}
              >
                新規タスク
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>

      <Dialog open={Boolean(ambiguousMention)} onOpenChange={(open) => {
        if (!open) setAmbiguousMention(null);
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>紐づけるタスクを選択</DialogTitle>
            <DialogDescription>複数のタスクが一致しました。自動では選択しません。</DialogDescription>
          </DialogHeader>
          <div className="max-h-80 space-y-2 overflow-auto">
            {ambiguousMention?.options.map((option) => <Button key={option.key}
              variant="outline" className="w-full justify-start" onClick={() => {
                submitCommand(ambiguousMention.input, option);
                setAmbiguousMention(null);
              }}>
              {option.title} · {option.projectTitle ?? "Quick"} · {option.goalTitle ?? option.ref.id.slice(-8)}
            </Button>)}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(completionAssignment)}
        onOpenChange={(open) => {
          if (!open) {
            setCompletionAssignment(null);
            setCompletionChecklistBlockId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{completionAssignment?.task_title}</DialogTitle>
            <DialogDescription>
              実働時間を記録し、タスクを継続または完了にします。
            </DialogDescription>
          </DialogHeader>
          {completionAssignment?.source !== "quick_task" &&
            !completionAssignment?.task_id.startsWith("quick_") && (
              <div className="space-y-2">
                <Label>実働時間（分）</Label>
                <Input
                  type="number"
                  min={1}
                  value={actualMinutes}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setActualMinutes(
                      Number.isFinite(parsed) && parsed > 0
                        ? Math.min(parsed, 1440)
                        : 1,
                    );
                  }}
                />
              </div>
            )}
          <DialogFooter>
            {completionAssignment?.source !== "quick_task" &&
              !completionAssignment?.task_id.startsWith("quick_") && (
                <Button
                  variant="outline"
                  disabled={taskActionPending}
                  onClick={() => applyTaskAction("continue")}
                >
                  記録して継続
                </Button>
              )}
            <Button
              disabled={taskActionPending}
              onClick={() => applyTaskAction("complete")}
            >
              {taskActionPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              完了
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新しいタスク</DialogTitle>
            <DialogDescription>
              Quick
              Taskとして保存するか、保存先ゴールを指定して通常タスクを作成します。
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1">
              <Label>タイトル</Label>
              <Input
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                autoFocus
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label>見積り（分）</Label>
                <Input
                  type="number"
                  min={1}
                  value={newTaskMinutes}
                  onChange={(event) => {
                    const parsed = Number.parseInt(event.target.value, 10);
                    setNewTaskMinutes(
                      Number.isFinite(parsed) && parsed > 0
                        ? Math.min(parsed, 1440)
                        : 1,
                    );
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label>種類</Label>
                <Select
                  value={newTaskWorkType}
                  onValueChange={(value: WorkType) => setNewTaskWorkType(value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(workTypeLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>優先度</Label>
                <Select
                  value={newTaskPriority}
                  onValueChange={setNewTaskPriority}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["1", "2", "3", "4", "5"].map((value) => (
                      <SelectItem key={value} value={value}>
                        {value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>作成先</Label>
              <Select
                value={newTaskDestination}
                onValueChange={(value: "quick" | "goal") => {
                  setNewTaskDestination(value);
                  setNewTaskProjectId("");
                  setNewTaskGoalId("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">Quick Task</SelectItem>
                  <SelectItem value="goal">ゴールに紐づく通常タスク</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {newTaskDestination === "goal" && (
              <div className="space-y-1">
                <Label>プロジェクト（ゴールの絞り込み）</Label>
                <Select
                  value={newTaskProjectId}
                  onValueChange={(value) => {
                    setNewTaskProjectId(value);
                    setNewTaskGoalId("");
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="プロジェクトを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {newTaskDestination === "goal" && newTaskProjectId && (
              <div className="space-y-1">
                <Label>保存先ゴール</Label>
                <Select value={newTaskGoalId} onValueChange={setNewTaskGoalId}>
                  <SelectTrigger>
                    <SelectValue placeholder="ゴールを選択" />
                  </SelectTrigger>
                  <SelectContent>
                    {newTaskGoals.map((goal) => (
                      <SelectItem key={goal.id} value={goal.id}>
                        {goal.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              キャンセル
            </Button>
            <Button
              onClick={createTask}
              disabled={
                creatingTask ||
                !newTaskTitle.trim() ||
                (newTaskDestination === "goal" && !newTaskGoalId)
              }
            >
              {creatingTask && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              作成して追加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function HelpExample({ code, label }: { code: string; label: string }) {
  return (
    <div className="rounded-md border border-blue-100 bg-white/80 p-2 dark:border-blue-900 dark:bg-gray-950/60">
      <span className="block text-xs text-gray-500">{label}</span>
      <code className="mt-1 block break-all font-mono text-xs text-gray-800 dark:text-gray-100">
        {code}
      </code>
    </div>
  );
}

function TaskSelect({
  value,
  options,
  fallbackTitle,
  onChange,
}: {
  value?: DailyPlanTaskRef | null;
  options: TaskOption[];
  fallbackTitle?: string;
  onChange: (task: TaskOption | undefined) => void;
}) {
  const selectedKey = value ? refKey(value) : undefined;
  const fallback =
    value && !options.some((option) => option.key === selectedKey)
      ? fallbackTaskOption(value, fallbackTitle || "参照タスク")
      : undefined;
  const selectableOptions = fallback ? [fallback, ...options] : options;

  return (
    <Select
      value={selectedKey ?? "none"}
      onValueChange={(key) =>
        onChange(selectableOptions.find((option) => option.key === key))
      }
    >
      <SelectTrigger className="min-w-[220px] flex-1">
        <SelectValue placeholder="タスクを選択" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">タスクに紐づけない</SelectItem>
        {selectableOptions.map((option) => (
          <SelectItem key={option.key} value={option.key}>
            {option.title}
            {option.isFallback
              ? " · 候補外"
              : option.projectTitle
                ? ` · ${option.projectTitle}`
                : " · Quick"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ValidatedTitleInput({
  value,
  ariaLabel,
  className,
  onChange,
}: {
  value: string;
  ariaLabel: string;
  className?: string;
  onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Input
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => {
        const next = event.target.value;
        setDraft(next);
        if (next.trim()) onChange(next);
      }}
      onBlur={() => {
        if (!draft.trim()) setDraft(value);
      }}
      className={className}
    />
  );
}

function TimedLineEditor({
  block,
  taskOptions,
  onChange,
}: {
  block: DailyPlanTimedLine;
  taskOptions: TaskOption[];
  onChange: (block: DailyPlanTimedLine) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        type="time"
        value={block.start}
        onChange={(event) => {
          const next = updateDailyPlanTimeRange(
            block,
            "start",
            event.target.value,
          );
          if (next) onChange({ ...block, ...next });
        }}
        className="w-28 font-mono"
      />
      <span>–</span>
      <Input
        type="time"
        value={block.end}
        onChange={(event) => {
          const next = updateDailyPlanTimeRange(
            block,
            "end",
            event.target.value,
          );
          if (next) onChange({ ...block, ...next });
        }}
        className="w-28 font-mono"
      />
      <ValidatedTitleInput
        ariaLabel="予定名"
        value={block.title}
        onChange={(title) => onChange({ ...block, title })}
        className="min-w-[220px] flex-1"
      />
      {block.kind === "break" ? (
        <Badge className="gap-1 bg-amber-600">
          <Coffee className="h-3 w-3" />
          休憩
        </Badge>
      ) : (
        <>
          <TaskSelect
            value={block.task_ref}
            options={taskOptions}
            fallbackTitle={block.title ?? undefined}
            onChange={(task) =>
              onChange({
                ...block,
                task_ref: task?.ref,
                title: task?.title ?? block.title,
              })
            }
          />
          <Badge variant="outline">固定</Badge>
        </>
      )}
    </div>
  );
}

function DirectiveEditor({
  block,
  taskOptions,
  projects,
  availabilityWindows,
  onChange,
}: {
  block: DailyPlanScheduleDirective;
  taskOptions: TaskOption[];
  projects: Array<{ id: string; title: string }>;
  availabilityWindows: DailyPlanAvailabilityWindow[];
  onChange: (block: DailyPlanScheduleDirective) => void;
}) {
  const filter: DailyPlanDirectiveFilter = block.filter ?? {
    work_types: [],
    project_ids: [],
    goal_ids: [],
  };
  const goals = Array.from(
    new Map(
      taskOptions
        .filter(
          (task) =>
            !filter.project_ids.length ||
            (task.projectId && filter.project_ids.includes(task.projectId)),
        )
        .filter((task) => task.goalId)
        .map((task) => [
          task.goalId!,
          { id: task.goalId!, title: task.goalTitle ?? task.goalId! },
        ]),
    ).values(),
  );
  const allowedWindow = block.allowed_windows?.[0];
  const toggle = <T extends string>(values: T[], value: T): T[] =>
    values.includes(value)
      ? values.filter((item) => item !== value)
      : [...values, value];

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="mb-2 flex items-center gap-2">
        <Badge className="bg-blue-600">/schedule</Badge>
        <Select
          value={block.mode}
          onValueChange={(mode: "task" | "filter") =>
            onChange({
              ...block,
              mode,
              task_ref:
                mode === "task"
                  ? (block.task_ref ?? taskOptions[0]?.ref)
                  : undefined,
              title:
                mode === "task"
                  ? (block.title ?? taskOptions[0]?.title)
                  : block.title,
              filter: mode === "filter" ? filter : undefined,
            })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              value="task"
              disabled={!block.task_ref && taskOptions.length === 0}
            >
              特定タスク
            </SelectItem>
            <SelectItem value="filter">条件から選択</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {block.mode === "task" ? (
        <div className="flex flex-wrap gap-2">
          <TaskSelect
            value={block.task_ref}
            options={taskOptions}
            fallbackTitle={block.title ?? undefined}
            onChange={(task) =>
              onChange(applyDirectiveTaskSelection(block, task))
            }
          />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-3">
          <FilterToggleGroup
            label="種類（OR）"
            options={Object.entries(workTypeLabels).map(([value, label]) => ({
              value: value as WorkType,
              label,
            }))}
            selected={filter.work_types}
            onToggle={(value) =>
              onChange({
                ...block,
                filter: {
                  ...filter,
                  work_types: toggle(filter.work_types, value),
                },
              })
            }
          />
          <FilterToggleGroup
            label="プロジェクト（OR）"
            options={projects.map((project) => ({
              value: project.id,
              label: project.title,
            }))}
            selected={filter.project_ids}
            onToggle={(value) =>
              onChange({
                ...block,
                filter: {
                  ...filter,
                  project_ids: toggle(filter.project_ids, value),
                  goal_ids: [],
                },
              })
            }
          />
          <FilterToggleGroup
            label="ゴール（OR）"
            options={goals.map((goal) => ({
              value: goal.id,
              label: goal.title,
            }))}
            selected={filter.goal_ids}
            onToggle={(value) =>
              onChange({
                ...block,
                filter: { ...filter, goal_ids: toggle(filter.goal_ids, value) },
              })
            }
          />
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-blue-100 pt-3 dark:border-blue-900">
        <div className="space-y-1">
          <Label className="text-xs">割当量（分）</Label>
          <Input
            aria-label="割当量（分）"
            type="number"
            min={1}
            max={1440}
            placeholder={block.mode === "task" ? "残り見積り" : "上限なし"}
            value={block.duration_override_minutes ?? ""}
            onChange={(event) => {
              const parsed = Number.parseInt(event.target.value, 10);
              onChange({
                ...block,
                duration_override_minutes:
                  Number.isFinite(parsed) && parsed > 0
                    ? Math.min(parsed, 1440)
                    : undefined,
              });
            }}
            className="w-32"
          />
        </div>
        {allowedWindow ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">配置可能開始</Label>
              <Input
                aria-label="配置可能開始"
                type="time"
                value={allowedWindow.start}
                onChange={(event) => {
                  const next = updateDailyPlanTimeRange(
                    allowedWindow,
                    "start",
                    event.target.value,
                  );
                  if (next) onChange({ ...block, allowed_windows: [next] });
                }}
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">配置可能終了</Label>
              <Input
                aria-label="配置可能終了"
                type="time"
                value={allowedWindow.end}
                onChange={(event) => {
                  const next = updateDailyPlanTimeRange(
                    allowedWindow,
                    "end",
                    event.target.value,
                  );
                  if (next) onChange({ ...block, allowed_windows: [next] });
                }}
                className="w-28"
              />
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onChange({ ...block, allowed_windows: [] })}
            >
              時間帯を解除
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              const fallback = availabilityWindows[0] ?? {
                start: "09:00",
                end: "18:00",
              };
              onChange({
                ...block,
                allowed_windows: [{ start: fallback.start, end: fallback.end }],
              });
            }}
          >
            配置可能時間帯を指定
          </Button>
        )}
      </div>
    </div>
  );
}

function FilterToggleGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-gray-500">{label}</Label>
      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto rounded-md border bg-white p-2 dark:bg-gray-950">
        {options.length === 0 && (
          <span className="text-xs text-gray-400">候補なし</span>
        )}
        {options.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={selected.includes(option.value) ? "default" : "outline"}
            className="h-7 px-2 text-xs"
            onClick={() => onToggle(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function GeneratedAssignmentRow({
  assignment,
  onPin,
  onComplete,
}: {
  assignment: DailyPlanAssignment;
  onPin: (
    assignment: DailyPlanAssignment,
    start?: string,
    end?: string,
  ) => void;
  onComplete: (assignment: DailyPlanAssignment) => void;
}) {
  const [start, setStart] = useState(assignment.start_time);
  const [end, setEnd] = useState(assignment.slot_end);
  useEffect(() => {
    setStart(assignment.start_time);
    setEnd(assignment.slot_end);
  }, [assignment.slot_end, assignment.start_time]);
  const canPin = Boolean(
    updateDailyPlanTimeRange({ start, end }, "start", start) &&
      updateDailyPlanTimeRange({ start, end }, "end", end),
  );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-blue-50 px-3 py-2 text-sm dark:bg-blue-950/30">
      <Input
        aria-label="生成予定の開始時刻"
        disabled={assignment.is_fixed}
        type="time"
        value={start}
        onChange={(event) => setStart(event.target.value)}
        className="h-8 w-28 font-mono"
      />
      <span>–</span>
      <Input
        aria-label="生成予定の終了時刻"
        disabled={assignment.is_fixed}
        type="time"
        value={end}
        onChange={(event) => setEnd(event.target.value)}
        className="h-8 w-28 font-mono"
      />
      <span className="font-medium">{assignment.task_title}</span>
      <Badge variant="outline">{assignment.is_fixed ? "固定済み" : "自動"}</Badge>
      <div className="ml-auto flex gap-1">
        <Button
          size="sm"
          variant="ghost"
          disabled={!canPin || assignment.is_fixed}
          onClick={() => onPin(assignment, start, end)}
        >
          固定
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onComplete(assignment)}
        >
          <Check className="mr-1 h-3 w-3" />
          実績
        </Button>
      </div>
    </div>
  );
}

function DailyPlanCommandComposer({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false,
        bulletList: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        orderedList: false,
      }),
      Placeholder.configure({
        placeholder: "行を入力…  /schedule、1100-1200 会議、[] タスク",
      }),
    ],
    content: { type: "doc", content: [{ type: "paragraph" }] },
    immediatelyRender: false,
    editorProps: {
      attributes: {
        "aria-label": "日次プランの行入力",
        class:
          "min-h-10 w-full px-3 py-2 text-sm outline-none [&_.is-editor-empty:first-child:before]:pointer-events-none [&_.is-editor-empty:first-child:before]:float-left [&_.is-editor-empty:first-child:before]:h-0 [&_.is-editor-empty:first-child:before]:text-muted-foreground [&_.is-editor-empty:first-child:before]:content-[attr(data-placeholder)]",
        role: "textbox",
      },
    },
    onUpdate: ({ editor: currentEditor }) => onChange(currentEditor.getText()),
  });

  useEffect(() => {
    if (!editor || editor.getText() === value) return;
    editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: value ? [{ type: "text", text: value }] : undefined,
        },
      ],
    });
  }, [editor, value]);

  return (
    <div
      className="min-w-0 flex-1 rounded-md border border-input bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          onSubmit(editor?.getText() ?? value);
        }
      }}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

function ChecklistEditor({
  block,
  taskOptions,
  onChange,
  onComplete,
}: {
  block: DailyPlanChecklistItem;
  taskOptions: TaskOption[];
  onChange: (block: DailyPlanChecklistItem) => void;
  onComplete: (task: TaskOption) => void;
}) {
  const linkedTask = block.task_ref
    ? (taskOptions.find((option) => option.key === refKey(block.task_ref!)) ??
      fallbackTaskOption(block.task_ref, block.title))
    : undefined;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Checkbox
        checked={block.checked}
        onCheckedChange={(checked) => {
          if (checked === true && linkedTask) {
            onComplete(linkedTask);
            return;
          }
          onChange({ ...block, checked: checked === true });
        }}
      />
      <ValidatedTitleInput
        ariaLabel="チェック項目名"
        value={block.title}
        onChange={(title) => onChange({ ...block, title })}
        className={`min-w-[220px] flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0 ${block.checked ? "text-gray-400 line-through" : ""}`}
      />
      <TaskSelect
        value={block.task_ref}
        options={taskOptions}
        fallbackTitle={block.title}
        onChange={(task) =>
          onChange({
            ...block,
            task_ref: task?.ref,
            title: task?.title ?? block.title,
          })
        }
      />
    </div>
  );
}
