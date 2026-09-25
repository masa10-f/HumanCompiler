// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import {
  dailyPlanSaveMessage,
  validateDailyPlanNote,
} from "@/lib/daily-plan-validation";
import { createDailyPlanId } from "@/lib/daily-plan-id";
import {
  forwardRef,
  useImperativeHandle,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Coffee,
  HelpCircle,
  Loader2,
  Save,
  Sparkles,
  StickyNote,
} from "lucide-react";

import { DailyPlanHistory } from "./daily-plan-history";
import { getJSTDateString } from "@/lib/date-utils";
import {
  DailyPlanNoteEditor,
  type NoteGoalOption,
} from "./daily-plan-note-editor";
import { schedulingBlocks, sameSchedulingBlocks } from "@/lib/daily-plan-note";
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
import { useScheduleGoals } from "@/hooks/use-schedule-goals";
import { useProjectOptions } from "@/hooks/use-project-query";
import { dailyPlansApi, quickTasksApi, tasksApi } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import { updateDailyPlanTimeRange } from "@/lib/daily-plan-command";
import { loadSchedulerSolverConfig } from "@/lib/scheduler-config";
import {
  applyDirectiveTaskSelection,
  isPermanentDailyPlanSaveError,
  missingDailyPlanBlockIds,
  searchDailyPlanTasks,
} from "@/lib/daily-plan-editor";
import type { QuickTask } from "@/types/quick-task";
import type { TaskWorkspaceItem, WorkType } from "@/types/task";
import type {
  DailyPlanAssignment,
  DailyPlanBlock,
  DailyPlanChecklistItem,
  DailyPlanDirectiveFilter,
  DailyPlanDocumentV1,
  DailyPlanResponse,
  DailyPlanScheduleDirective,
  DailyPlanTaskRef,
  DailyPlanTimedLine,
} from "@/types/daily-plan";

export interface DailyPlanWorkspaceHandle {
  beforeLeave: (options?: { retryPausedSave?: boolean }) => Promise<void>;
}

interface DailyPlanWorkspaceProps {
  embedded?: boolean;
  selectedDate: string;
  onSelectedDateChange?: (date: string) => void;
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
  blocks: [],
};

const workTypeLabels: Record<WorkType, string> = {
  light_work: "軽作業",
  focused_work: "集中作業",
  study: "学習",
};

function refKey(ref: DailyPlanTaskRef): string {
  return `${ref.source}:${ref.id}`;
}

function assignmentTaskRef(assignment: DailyPlanAssignment): DailyPlanTaskRef {
  return {
    source:
      assignment.source ??
      (assignment.task_id.startsWith("quick_") ? "quick_task" : "task"),
    id: assignment.task_id.replace(/^quick_/, ""),
  };
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

export const DailyPlanWorkspace = forwardRef<
  DailyPlanWorkspaceHandle,
  DailyPlanWorkspaceProps
>(function DailyPlanWorkspace(
  { selectedDate, onSelectedDateChange, embedded = false },
  ref,
) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: projects = [] } = useProjectOptions();
  const [document, setDocument] = useState<DailyPlanDocumentV1>(EMPTY_DOCUMENT);
  const [revision, setRevision] = useState(0);
  const revisionRef = useRef(0);
  const documentRef = useRef(document);
  const saveInFlightRef = useRef<Promise<DailyPlanResponse> | null>(null);
  const [schedule, setSchedule] = useState<DailyPlanResponse["schedule"]>(null);
  const scheduleInputRef = useRef<DailyPlanBlock[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [loadSignal, setLoadSignal] = useState(0);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [saveSignal, setSaveSignal] = useState(0);
  const [saveError, setSaveError] = useState<Error | null>(null);
  const [autosavePaused, setAutosavePaused] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [regularTasks, setRegularTasks] = useState<TaskWorkspaceItem[]>([]);
  const [quickTasks, setQuickTasks] = useState<QuickTask[]>([]);
  const [completionAssignment, setCompletionAssignment] =
    useState<DailyPlanAssignment | null>(null);
  const [completionChecklistBlockId, setCompletionChecklistBlockId] = useState<
    string | null
  >(null);
  const [actualMinutes, setActualMinutes] = useState(30);
  const [comment, setComment] = useState("");
  const commentTooLong = comment.length > 500;
  const taskActionInFlight = useRef(false);
  const [taskActionPending, setTaskActionPending] = useState(false);
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
          const page = await tasksApi.getWorkspace({
            skip,
            limit: 100,
            status: ["pending", "in_progress"],
          });
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
    setLoadError(false);
    setConflict(false);
    setSaveError(null);
    setAutosavePaused(false);
    dailyPlansApi
      .get(selectedDate)
      .then((response) => {
        if (cancelled) return;
        setDocument(response.document);
        documentRef.current = response.document;
        setRevision(response.revision);
        revisionRef.current = response.revision;
        setSchedule(response.schedule ?? null);
        scheduleInputRef.current =
          response.schedule?.source_document_revision === response.revision
            ? schedulingBlocks(response.document)
            : null;
        setDirty(false);
        dirtyRef.current = false;
        setSaveRetry(0);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(true);
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
  }, [loadSignal, selectedDate, toast]);

  const [suggestionsUsed, setSuggestionsUsed] = useState(false);
  const [blockEditorUsed, setBlockEditorUsed] = useState(false);
  const openSuggestions = useCallback(() => setSuggestionsUsed(true), []);
  // Linked lines need their task's title to name the 実績 dialog.
  const needsTasks =
    !embedded ||
    suggestionsUsed ||
    blockEditorUsed ||
    document.blocks.some(
      (block) =>
        (block.type === "checklist_item" || block.type === "timed_line") &&
        Boolean(block.task_ref),
    );
  useEffect(() => {
    if (!needsTasks) return;
    void loadTasks().catch(() =>
      toast({
        title: "タスク候補を読み込めませんでした",
        description:
          "ノートは編集できます。候補を利用するには画面を再読み込みしてください。",
        variant: "destructive",
      }),
    );
  }, [needsTasks, loadTasks, toast]);

  const needsGoals =
    suggestionsUsed ||
    document.blocks.some(
      (block) => block.type === "schedule_directive" && block.mode === "filter",
    );
  const goalQuery = useScheduleGoals(
    projects.map((project) => project.id),
    needsGoals,
  );
  const goalOptions: NoteGoalOption[] = goalQuery.goals.map((goal) => ({
    id: goal.id,
    title: goal.title,
    projectId: goal.project_id,
    projectTitle: projects.find((project) => project.id === goal.project_id)
      ?.title,
  }));

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

  const refreshSavedNote = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: [...queryKeys.dashboard.all, "daily-notes"],
    });
  }, [queryClient]);

  const saveNow = useCallback((): Promise<DailyPlanResponse> => {
    if (saveInFlightRef.current) return saveInFlightRef.current;

    const operation = async (): Promise<DailyPlanResponse> => {
      if (!dirtyRef.current) {
        return dailyPlansApi.get(selectedDate);
      }
      setSaving(true);
      try {
        const snapshot = documentRef.current;
        validateDailyPlanNote(snapshot);
        const response = await dailyPlansApi.update(
          selectedDate,
          revisionRef.current,
          snapshot,
        );
        refreshSavedNote();
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
          setSaveError(
            error instanceof Error ? error : new Error("保存に失敗しました"),
          );
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
  }, [selectedDate, refreshSavedNote]);

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

  useImperativeHandle(
    ref,
    () => ({
      beforeLeave: async ({ retryPausedSave = false } = {}) => {
        if (generating || taskActionInFlight.current || completionAssignment)
          throw new Error(
            "予定の生成や実績の入力を終えてから再試行してください。",
          );
        if (conflict)
          throw new Error("保存の競合を解決してから再試行してください。");
        if (autosavePaused && !retryPausedSave && !saveInFlightRef.current)
          throw new Error(
            `${saveError ? dailyPlanSaveMessage(saveError, documentRef.current) : "ノートを保存できませんでした"}。内容を修正するか「保存を再試行」してください。`,
          );
        if (dirtyRef.current || saveInFlightRef.current)
          await flushPendingSaves();
      },
    }),
    [
      generating,
      completionAssignment,
      conflict,
      autosavePaused,
      saveError,
      flushPendingSaves,
    ],
  );

  useEffect(() => {
    if (!dirty || loading || loadError || conflict || autosavePaused) return;
    const timer = window.setTimeout(() => {
      void saveNow().catch((error) => {
        if (!(error instanceof ApiError && error.statusCode === 409)) {
          if (
            isPermanentDailyPlanSaveError(error) ||
            saveRetry >= MAX_AUTOSAVE_RETRIES
          ) {
            setAutosavePaused(true);
          } else {
            setSaveRetry((current) => current + 1);
          }
          if (saveRetry === 0)
            toast({
              title: "自動保存に失敗しました",
              description: dailyPlanSaveMessage(error, documentRef.current),
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
    loadError,
    saveNow,
    saveRetry,
    saveSignal,
    toast,
  ]);

  useEffect(() => {
    if (!dirty && !saving) return;
    // Browsers cannot wait for an asynchronous save while closing/reloading.
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !saveInFlightRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [dirty, saving]);

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
          return {
            id: block.id,
            type: "text" as const,
            text: [
              "/schedule",
              block.title ?? "参照を解除したタスク",
              block.duration_override_minutes
                ? `(${block.duration_override_minutes}m)`
                : "",
              ...(block.allowed_windows ?? []).map(
                (window) => `${window.start}-${window.end}`,
              ),
            ]
              .filter(Boolean)
              .join(" "),
          };
        }
        if (block.type === "timed_line" || block.type === "checklist_item") {
          return { ...block, task_ref: undefined };
        }
        return block;
      }),
    }));
  };

  const generate = async () => {
    if (
      documentRef.current.blocks.some(
        (block) =>
          block.type === "schedule_directive" && !block.allowed_windows?.length,
      )
    ) {
      toast({
        title: "/scheduleの開始・終了時刻を入力してください",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    try {
      await flushPendingSaves();
      const response = await dailyPlansApi.generate(
        selectedDate,
        loadSchedulerSolverConfig(),
      );
      scheduleInputRef.current = schedulingBlocks(response.document);
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
        setSaveError(
          error instanceof Error
            ? error
            : new Error("参照タスクが見つかりません"),
        );
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

  const changeSelectedDate = async (nextDate: string) => {
    if (
      !nextDate ||
      nextDate === selectedDate ||
      taskActionInFlight.current ||
      completionAssignment
    )
      return;
    try {
      if (dirtyRef.current || saveInFlightRef.current)
        await flushPendingSaves();
      onSelectedDateChange?.(nextDate);
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
      id: createDailyPlanId(),
      type: "timed_line",
      start,
      end,
      title: assignment.task_title,
      task_ref: assignmentTaskRef(assignment),
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
    setSchedule((current) =>
      current
        ? {
            ...current,
            assignments: current.assignments.filter(
              (item) => item !== assignment,
            ),
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
    setComment("");
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
    setComment("");
  };

  const openTimedCompletion = (block: DailyPlanTimedLine) => {
    if (!block.task_ref) return;
    const minutes = (clock: string) => {
      const [hours, mins] = clock.split(":").map(Number);
      return hours! * 60 + mins!;
    };
    openCompletion({
      task_id: block.task_ref.id,
      source: block.task_ref.source,
      // The line title can differ from the task. The dialog shows the task's
      // title once it is loaded, so never label the task with the line name.
      task_title: `「${block.title}」に紐づけたタスク`,
      goal_id: "",
      project_id: "",
      slot_index: 0,
      start_time: block.start,
      slot_start: block.start,
      slot_end: block.end,
      duration_hours: (minutes(block.end) - minutes(block.start)) / 60,
      slot_kind: "light_work",
      is_fixed: true,
      directive_id: block.id,
    });
  };

  const applyTaskAction = async (action: "continue" | "complete") => {
    if (!completionAssignment || taskActionInFlight.current || commentTooLong)
      return;
    taskActionInFlight.current = true;
    const taskRef = assignmentTaskRef(completionAssignment);
    const source = taskRef.source;
    setTaskActionPending(true);
    try {
      await dailyPlansApi.applyTaskAction(selectedDate, {
        task_ref: taskRef,
        action,
        actual_minutes: source === "task" ? actualMinutes : undefined,
        ...(source === "task" && comment ? { comment } : {}),
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
      // The write has succeeded. A refresh failure must not invite a duplicate log.
      void loadTasks().catch(() =>
        toast({
          title: "実績は保存済みですが、タスク候補を更新できませんでした",
          variant: "destructive",
        }),
      );
      for (const queryKey of [
        queryKeys.logs.all,
        queryKeys.tasks.all,
        queryKeys.progress.all,
        queryKeys.dashboard.all,
      ]) {
        void queryClient.invalidateQueries({ queryKey });
      }
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
      taskActionInFlight.current = false;
      setTaskActionPending(false);
    }
  };

  const reloadServerVersion = async () => {
    const response = await dailyPlansApi.get(selectedDate);
    setDocument(response.document);
    documentRef.current = response.document;
    setRevision(response.revision);
    revisionRef.current = response.revision;
    setSchedule(response.schedule ?? null);
    scheduleInputRef.current =
      response.schedule?.source_document_revision === response.revision
        ? schedulingBlocks(response.document)
        : null;
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
      refreshSavedNote();
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

  const noteUnavailable = loading || loadError;
  const adjacentDate = (offset: number) => {
    const date = new Date(`${selectedDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const scheduleInput =
    schedule?.source_scheduling_blocks ?? scheduleInputRef.current;
  const scheduleStale = Boolean(
    schedule &&
      (scheduleInput
        ? !sameSchedulingBlocks(scheduleInput, schedulingBlocks(document))
        : dirty || schedule.source_document_revision !== revision),
  );
  const blockIds = new Set(document.blocks.map((block) => block.id));
  // Tasks can finish loading after the dialog opens; name the task being
  // recorded as soon as it is known.
  const completionTitle = completionAssignment
    ? (taskOptions.find(
        (option) =>
          option.key === refKey(assignmentTaskRef(completionAssignment)),
      )?.title ?? completionAssignment.task_title)
    : undefined;
  const orphanAssignments = (schedule?.assignments ?? [])
    .filter(
      (assignment) =>
        !assignment.directive_id || !blockIds.has(assignment.directive_id),
    )
    .sort((left, right) => left.start_time.localeCompare(right.start_time));

  const Content = embedded ? "div" : "main";
  return (
    <div
      className={
        embedded ? "min-w-0" : "min-h-screen bg-gray-50 dark:bg-gray-900"
      }
    >
      {!embedded && <AppHeader currentPage="scheduling-daily" />}
      <Content className={embedded ? "" : "mx-auto max-w-7xl px-4 py-6"}>
        <div
          className={
            embedded
              ? ""
              : "grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]"
          }
        >
          <div className="order-1 min-w-0 lg:order-2">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              {!embedded && (
                <div>
                  <h1 className="text-2xl font-bold">
                    {selectedDate === getJSTDateString()
                      ? "今日のノート"
                      : `${selectedDate} のノート`}
                  </h1>
                  <p className="text-sm text-gray-500">
                    メモも予定も、このノートに。/schedule で予定を追加できます
                  </p>
                </div>
              )}
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
                  onClick={generate}
                  disabled={noteUnavailable || generating || conflict}
                >
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
                    {embedded ? "ノートの入力方法" : "このページの入力方法"}
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
                    <HelpExample
                      code="/break 12:00-13:00 昼休み"
                      label="休憩"
                    />
                    <HelpExample
                      code="/schedule 09:00-11:00 @論文読み"
                      label="指定した時間枠へ特定タスクを配置"
                    />
                    <HelpExample
                      code="/schedule 13:00-17:00 (90m)"
                      label="条件型を時間帯内へ90分配置"
                    />
                    <HelpExample
                      code="[ ] メール返信"
                      label="ノート内のチェックリスト"
                    />
                    <p className="sm:col-span-2">
                      /schedule の候補からタスクを選択できます。
                    </p>
                    <p className="sm:col-span-2">
                      重複する時間は一度だけ数え、短い時間枠の作業タイプを優先します。
                      同じ長さなら開始が早い枠、開始・終了とも同じなら集中作業・軽作業・学習の順に優先します。
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {!noteUnavailable && scheduleStale && (
              <Alert className="mb-4">
                <AlertDescription>
                  再生成が必要です。表示中の予定・診断は以前の文書に対する結果です。
                </AlertDescription>
              </Alert>
            )}

            {saveError && !conflict && (
              <Alert variant="destructive" className="mb-4">
                <AlertTitle>保存・参照エラー</AlertTitle>
                <AlertDescription>
                  <p className="whitespace-pre-wrap">
                    {dailyPlanSaveMessage(saveError, document)}
                    。内容はこの画面に残っています。修正後に再試行してください。
                  </p>
                  {missingDailyPlanBlockIds(saveError).map((blockId) => {
                    const block = document.blocks.find(
                      (item) => item.id === blockId,
                    );
                    if (!block || block.type === "text") return null;
                    return (
                      <div key={blockId} className="my-2">
                        <span>
                          参照先が見つかりません: {block.title ?? blockId}
                          。制御行の参照解除はメモへ変換します。
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={saving}
                          onClick={() => detachMissingTask(blockId)}
                        >
                          {block.title ?? blockId} の参照を解除
                        </Button>
                      </div>
                    );
                  })}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={saving}
                    onClick={() => {
                      void saveNow().catch(() => {});
                    }}
                  >
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

            {!embedded && (
              <Card className="mb-4">
                <CardContent className="flex flex-wrap items-end gap-3 py-4">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="前日のノート"
                    disabled={noteUnavailable || generating}
                    onClick={() => void changeSelectedDate(adjacentDate(-1))}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <div className="space-y-1">
                    <Label htmlFor="daily-note-date">対象日</Label>
                    <Input
                      id="daily-note-date"
                      type="date"
                      value={selectedDate}
                      disabled={
                        noteUnavailable || generating || (saving && conflict)
                      }
                      onChange={(event) =>
                        void changeSelectedDate(event.target.value)
                      }
                      className="w-40"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="翌日のノート"
                    disabled={noteUnavailable || generating}
                    onClick={() => void changeSelectedDate(adjacentDate(1))}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    disabled={noteUnavailable || generating}
                    onClick={() => void changeSelectedDate(getJSTDateString())}
                  >
                    今日
                  </Button>
                  <Button
                    variant="ghost"
                    className="lg:hidden"
                    onClick={() =>
                      globalThis.document
                        .getElementById("daily-note-history")
                        ?.scrollIntoView({ behavior: "smooth" })
                    }
                  >
                    履歴・検索
                  </Button>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardContent className="space-y-2 py-5">
                {loading && (
                  <div
                    className="flex min-h-64 items-center justify-center gap-2"
                    role="status"
                  >
                    <Loader2 className="h-5 w-5 animate-spin" />
                    ノートを読み込み中…
                  </div>
                )}
                {loadError && (
                  <Alert variant="destructive">
                    <AlertTitle>ノートを読み込めませんでした</AlertTitle>
                    <AlertDescription>
                      内容を取得できるまで編集を停止しています。
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setLoadSignal((value) => value + 1)}
                      >
                        ノートを再読み込み
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {!noteUnavailable && (
                  <>
                    {schedule?.unused_minutes !== undefined && (
                      <p className="text-right text-sm text-gray-500">
                        当日の未使用時間: {schedule.unused_minutes}分
                      </p>
                    )}
                    {Boolean(schedule?.violations?.length) && (
                      <Alert variant="destructive">
                        <AlertTriangle className="h-4 w-4" />
                        <AlertTitle>
                          固定予定をすべて配置できませんでした
                        </AlertTitle>
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
                    <DailyPlanNoteEditor
                      key={selectedDate}
                      document={document}
                      taskOptions={taskOptions}
                      projectOptions={projects}
                      goalOptions={goalOptions}
                      goalsLoading={goalQuery.loading}
                      goalsError={goalQuery.error}
                      onRetryGoals={goalQuery.retry}
                      onSuggestionsOpen={openSuggestions}
                      onChange={(next) => updateDocument(() => next)}
                      renderBlock={(block) => {
                        if (block.type === "text") return null;
                        const assignments =
                          schedule?.assignments.filter(
                            (item) => item.directive_id === block.id,
                          ) ?? [];
                        const diagnostic =
                          schedule?.directive_diagnostics?.find(
                            (item) => item.directive_id === block.id,
                          );
                        return (
                          <div className="group space-y-1">
                            {block.type === "checklist_item" ? (
                              <ChecklistEditor
                                block={block}
                                taskOptions={taskOptions}
                                onChange={(next) =>
                                  replaceBlock(block.id, next)
                                }
                                onComplete={(task) =>
                                  openChecklistCompletion(block, task)
                                }
                              />
                            ) : (
                              <div className="flex flex-wrap items-start gap-2">
                                {block.type === "timed_line" && (
                                  <div className="flex items-center gap-2 py-1.5">
                                    <Checkbox
                                      aria-label={`${block.title}を終了済みにする`}
                                      checked={block.completed ?? false}
                                      onCheckedChange={(checked) =>
                                        replaceBlock(block.id, {
                                          ...block,
                                          completed: checked === true,
                                        })
                                      }
                                    />
                                    {block.completed && (
                                      <Badge variant="secondary">
                                        終了済み
                                      </Badge>
                                    )}
                                    {block.task_ref?.source === "task" && (
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        onClick={() =>
                                          openTimedCompletion(block)
                                        }
                                      >
                                        実績
                                      </Button>
                                    )}
                                  </div>
                                )}
                                <details
                                  className="min-w-0 flex-1 rounded-md"
                                  onToggle={(event) => {
                                    if (event.currentTarget.open)
                                      setBlockEditorUsed(true);
                                  }}
                                >
                                  <summary className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-muted">
                                    <span className="mr-2 font-mono text-muted-foreground">
                                      {block.type === "timed_line"
                                        ? `${block.start}–${block.end}`
                                        : (block.allowed_windows ?? [])
                                            .map(
                                              (window) =>
                                                `${window.start}–${window.end}`,
                                            )
                                            .join(", ") || "時間帯を設定"}
                                    </span>
                                    {block.title || "タスクを自動配置"}
                                    {block.type === "schedule_directive" && (
                                      <span className="ml-2 text-xs text-muted-foreground">
                                        /schedule
                                        {block.duration_override_minutes
                                          ? ` · ${block.duration_override_minutes}分`
                                          : ""}
                                      </span>
                                    )}
                                    {block.note?.trim() && (
                                      <span
                                        role="img"
                                        aria-label="メモあり"
                                        title="メモあり"
                                        className="ml-2 inline-flex align-middle text-muted-foreground"
                                      >
                                        <StickyNote
                                          aria-hidden="true"
                                          className="h-3.5 w-3.5"
                                        />
                                      </span>
                                    )}
                                  </summary>
                                  <div className="py-2">
                                    {block.type === "schedule_directive" ? (
                                      <DirectiveEditor
                                        block={block}
                                        taskOptions={taskOptions}
                                        projects={projects}
                                        goalOptions={goalOptions}
                                        onChange={(next) =>
                                          replaceBlock(block.id, next)
                                        }
                                      />
                                    ) : (
                                      <TimedLineEditor
                                        block={block}
                                        taskOptions={taskOptions}
                                        onChange={(next) =>
                                          replaceBlock(block.id, next)
                                        }
                                      />
                                    )}
                                    <LineNoteEditor
                                      value={block.note ?? ""}
                                      onChange={(note) =>
                                        replaceBlock(block.id, {
                                          ...block,
                                          note: note || undefined,
                                        })
                                      }
                                    />
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => removeBlock(block.id)}
                                    >
                                      この予定を削除
                                    </Button>
                                  </div>
                                </details>
                              </div>
                            )}
                            {assignments.map((assignment, index) => (
                              <GeneratedAssignmentRow
                                key={`${assignment.task_id}-${assignment.start_time}-${index}`}
                                assignment={assignment}
                                onPin={pinAssignment}
                                onComplete={openCompletion}
                              />
                            ))}
                            {diagnostic?.reason && (
                              <p className="text-xs text-amber-700">
                                {diagnostic.reason}（候補{" "}
                                {diagnostic.eligible_count}件）
                              </p>
                            )}
                          </div>
                        );
                      }}
                    />
                    {orphanAssignments.length > 0 && (
                      <section
                        aria-label="文書外の予定"
                        className="space-y-2 border-t pt-3"
                      >
                        <h2 className="text-sm font-medium">文書外の予定</h2>
                        <p className="text-xs text-gray-500">
                          元の行がない予定です。過去の予定や固定予定は再生成しても保持されます。
                        </p>
                        {orphanAssignments.map((assignment, index) => (
                          <GeneratedAssignmentRow
                            key={`${assignment.task_id}-${assignment.start_time}-${index}`}
                            assignment={assignment}
                            onPin={pinAssignment}
                            onComplete={openCompletion}
                          />
                        ))}
                      </section>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
          {!embedded && (
            <div
              id="daily-note-history"
              className="order-2 min-w-0 scroll-mt-20 lg:order-1"
            >
              <DailyPlanHistory
                selectedDate={selectedDate}
                revision={revision}
                disabled={loading || generating || (saving && conflict)}
                onSelect={changeSelectedDate}
              />
            </div>
          )}
        </div>
      </Content>

      <Dialog
        open={Boolean(completionAssignment)}
        onOpenChange={(open) => {
          if (!open && !taskActionInFlight.current) {
            setCompletionAssignment(null);
            setCompletionChecklistBlockId(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{completionTitle}</DialogTitle>
            <DialogDescription>
              実働時間を記録し、タスクを継続または完了にします。
            </DialogDescription>
          </DialogHeader>
          {completionAssignment?.source !== "quick_task" &&
            !completionAssignment?.task_id.startsWith("quick_") && (
              <div className="space-y-2">
                <Label htmlFor="daily-actual-minutes">実働時間（分）</Label>
                <Input
                  id="daily-actual-minutes"
                  type="number"
                  min={1}
                  max={1440}
                  disabled={taskActionPending}
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
                <Label htmlFor="daily-log-comment">コメント（任意）</Label>
                <Textarea
                  id="daily-log-comment"
                  value={comment}
                  maxLength={500}
                  aria-invalid={commentTooLong}
                  aria-describedby={
                    commentTooLong ? "daily-log-comment-error" : undefined
                  }
                  disabled={taskActionPending}
                  placeholder="作業内容や感想を記録…"
                  onChange={(event) => setComment(event.target.value)}
                />
                {commentTooLong && (
                  <p
                    id="daily-log-comment-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    コメントは500文字以内で入力してください（{comment.length}
                    /500）。
                  </p>
                )}
              </div>
            )}
          <DialogFooter>
            {completionAssignment?.source !== "quick_task" &&
              !completionAssignment?.task_id.startsWith("quick_") && (
                <Button
                  variant="outline"
                  disabled={taskActionPending || commentTooLong}
                  onClick={() => applyTaskAction("continue")}
                >
                  記録して継続
                </Button>
              )}
            <Button
              disabled={taskActionPending || commentTooLong}
              onClick={() => applyTaskAction("complete")}
            >
              {taskActionPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              {completionAssignment?.source === "quick_task" ||
              completionAssignment?.task_id.startsWith("quick_")
                ? "完了"
                : "記録して完了"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

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
            {taskOptionLabel(option)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const UNLINK_KEY = "none";

function taskOptionLabel(option: TaskOption): string {
  return `${option.title}${
    option.isFallback
      ? " · 候補外"
      : option.projectTitle
        ? ` · ${option.projectTitle}`
        : " · Quick"
  }`;
}

// Links a task by typing: words narrow candidates by task, goal and project title.
function TaskSearchSelect({
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
  const listId = useId();
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // null follows the default row, so a refresh never moves the highlight
  // onto a different task.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const selectedKey = value ? refKey(value) : undefined;
  const selected = value
    ? (options.find((option) => option.key === selectedKey) ??
      fallbackTaskOption(value, fallbackTitle || "参照タスク"))
    : undefined;
  // Keep a linked task that is no longer loaded (e.g. completed) choosable,
  // so opening the list never defaults to unlinking it.
  const selectable = selected?.isFallback ? [selected, ...options] : options;
  const matches = query.trim()
    ? searchDailyPlanTasks(selectable, query)
    : selectable;
  // Index 0 unlinks; candidates follow.
  const items: Array<TaskOption | undefined> = [undefined, ...matches];
  const itemKeys = items.map((task) => task?.key ?? UNLINK_KEY);
  // The default row is the first match while searching, else the current link.
  const defaultIndex = query.trim()
    ? Math.min(1, items.length - 1)
    : Math.max(0, itemKeys.indexOf(selectedKey ?? UNLINK_KEY));
  // Candidates can change while open (e.g. after a task is completed); a
  // highlighted task that disappears falls back to the default row.
  const activeIndex = activeKey === null ? -1 : itemKeys.indexOf(activeKey);
  const current = activeIndex >= 0 ? activeIndex : defaultIndex;
  const choose = (task: TaskOption | undefined) => {
    // Re-picking the current link must not rewrite the title or autosave.
    if (task?.key !== selectedKey) onChange(task);
    setQuery("");
    setOpen(false);
  };
  useEffect(() => {
    if (open)
      document
        .getElementById(`${listId}-${current}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [current, listId, open]);

  return (
    <div className="relative min-w-[220px] flex-1">
      <Input
        role="combobox"
        aria-label="紐づけるタスク"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? `${listId}-${current}` : undefined}
        placeholder={
          selected ? taskOptionLabel(selected) : "タスクを検索して紐づけ"
        }
        value={focused ? query : selected ? taskOptionLabel(selected) : ""}
        onFocus={() => {
          setFocused(true);
          setQuery("");
          setOpen(true);
          setActiveKey(null);
        }}
        onBlur={() => {
          setFocused(false);
          setOpen(false);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveKey(null);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            else
              setActiveKey(
                itemKeys[
                  event.key === "ArrowDown"
                    ? Math.min(current + 1, items.length - 1)
                    : Math.max(current - 1, 0)
                ]!,
              );
          } else if (event.key === "Enter" && open) {
            event.preventDefault();
            // A search with no match must not fall through to unlinking.
            if (!query.trim() || matches.length) choose(items[current]);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            setQuery("");
            setOpen(false);
          }
        }}
      />
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label="紐づけるタスクの候補"
          className="absolute left-0 right-0 z-50 mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          // Keep focus in the input so a click is not lost to its blur.
          onMouseDown={(event) => event.preventDefault()}
        >
          {items.map((task, index) => (
            <div
              key={task?.key ?? "none"}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === current}
              className={`cursor-pointer rounded px-2 py-1.5 text-sm ${
                index === current
                  ? "bg-secondary text-secondary-foreground"
                  : ""
              }`}
              onMouseEnter={() => setActiveKey(itemKeys[index]!)}
              onClick={() => choose(task)}
            >
              {task ? (
                <>
                  <span className="block">{task.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {task.isFallback
                      ? "候補外"
                      : (task.projectTitle ?? "Quick Task")}
                    {task.goalTitle ? ` / ${task.goalTitle}` : ""}
                  </span>
                </>
              ) : (
                "タスクに紐づけない"
              )}
            </div>
          ))}
          {!matches.length && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              一致するタスクがありません
            </p>
          )}
        </div>
      )}
    </div>
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

function LineNoteEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <div className="mt-3 space-y-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        メモ
      </Label>
      <Textarea
        id={id}
        value={draft}
        rows={3}
        // No native maxLength: it counts UTF-16 units, while the memo limit counts
        // characters. validateDailyPlanNote enforces it before saving.
        placeholder="作業中のメモ（ノート一覧で検索できます）"
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value);
        }}
      />
    </div>
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
          <TaskSearchSelect
            value={block.task_ref}
            options={taskOptions}
            fallbackTitle={block.title ?? undefined}
            // The line keeps its own name; the note reads better that way.
            onChange={(task) => onChange({ ...block, task_ref: task?.ref })}
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
  goalOptions,
  onChange,
}: {
  block: DailyPlanScheduleDirective;
  taskOptions: TaskOption[];
  projects: Array<{ id: string; title: string }>;
  goalOptions: NoteGoalOption[];
  onChange: (block: DailyPlanScheduleDirective) => void;
}) {
  const filter: DailyPlanDirectiveFilter = block.filter ?? {
    work_types: [],
    project_ids: [],
    goal_ids: [],
  };
  const goals = Array.from(
    new Map([
      ...taskOptions
        .filter((task) => task.goalId)
        .map(
          (task) =>
            [
              task.goalId!,
              {
                id: task.goalId!,
                title: task.goalTitle ?? task.goalId!,
                projectId: task.projectId,
              },
            ] as const,
        ),
      ...goalOptions.map((goal) => [goal.id, goal] as const),
    ]).values(),
  ).filter(
    (goal) =>
      !filter.project_ids.length ||
      (goal.projectId && filter.project_ids.includes(goal.projectId)),
  );
  const allowedWindow = block.allowed_windows?.[0];
  const [draftStart, setDraftStart] = useState(allowedWindow?.start ?? "");
  const [draftEnd, setDraftEnd] = useState(allowedWindow?.end ?? "");
  useEffect(() => {
    setDraftStart(allowedWindow?.start ?? "");
    setDraftEnd(allowedWindow?.end ?? "");
  }, [allowedWindow?.start, allowedWindow?.end]);
  const updateWindow = (field: "start" | "end", value: string) => {
    if (field === "start") setDraftStart(value);
    else setDraftEnd(value);
    const start = field === "start" ? value : draftStart;
    const end = field === "end" ? value : draftEnd;
    if (start && end && start < end)
      onChange({ ...block, allowed_windows: [{ start, end }] });
  };
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
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">開始時刻（必須）</Label>
            <Input
              aria-label="配置可能開始"
              type="time"
              value={draftStart}
              onChange={(event) => updateWindow("start", event.target.value)}
              onBlur={() => {
                if (allowedWindow) setDraftStart(allowedWindow.start);
              }}
              className="w-28"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">終了時刻（必須）</Label>
            <Input
              aria-label="配置可能終了"
              type="time"
              value={draftEnd}
              onChange={(event) => updateWindow("end", event.target.value)}
              onBlur={() => {
                if (allowedWindow) setDraftEnd(allowedWindow.end);
              }}
              className="w-28"
            />
          </div>
          <Select
            value={block.work_type ?? "light_work"}
            onValueChange={(work_type: WorkType) =>
              onChange({ ...block, work_type })
            }
          >
            <SelectTrigger className="w-32" aria-label="時間枠の作業タイプ">
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
      </div>
      {!allowedWindow && (
        <p className="mt-2 text-sm text-amber-700">
          開始・終了時刻を入力してください。この行は時刻を指定するまで生成できません。
        </p>
      )}
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
  const [editing, setEditing] = useState(false);
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
      {!editing ? (
        <button
          type="button"
          className="font-mono text-muted-foreground"
          onClick={() => setEditing(true)}
          aria-label="予定の時刻を編集"
        >
          {start}–{end}
        </button>
      ) : (
        <>
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
        </>
      )}
      <span className="font-medium">{assignment.task_title}</span>
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
        aria-label={block.title}
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
    </div>
  );
}
