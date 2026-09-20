// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";

import { DailyPlanHistory } from "./daily-plan-history";
import { getJSTDateString } from "@/lib/date-utils";
import { DailyPlanNoteEditor } from "./daily-plan-note-editor";
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
import { useProjectOptions } from "@/hooks/use-project-query";
import { dailyPlansApi, quickTasksApi, tasksApi } from "@/lib/api";
import { ApiError } from "@/lib/errors";
import {
  updateDailyPlanTimeRange,
} from "@/lib/daily-plan-command";
import { applyDirectiveTaskSelection } from "@/lib/daily-plan-adapter";
import {
  isPermanentDailyPlanSaveError,
  missingDailyPlanBlockIds,
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
    setLoadError(false);
    setConflict(false);
    setSaveError(null);
    setAutosavePaused(false);
    dailyPlansApi.get(selectedDate)
      .then((response) => {
        if (cancelled) return;
        setDocument(response.document);
        documentRef.current = response.document;
        setRevision(response.revision);
        revisionRef.current = response.revision;
        setSchedule(response.schedule ?? null);
        scheduleInputRef.current = response.schedule?.source_document_revision === response.revision ? schedulingBlocks(response.document) : null;
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

  useEffect(() => {
    void loadTasks().catch(() => toast({
      title: "タスク候補を読み込めませんでした",
      description: "ノートは編集できます。候補を利用するには画面を再読み込みしてください。",
      variant: "destructive",
    }));
  }, [loadTasks, toast]);

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
    if (!dirty || loading || loadError || conflict || autosavePaused) return;
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
    loadError,
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

  const generate = async () => {
    if (documentRef.current.blocks.some((block) => block.type === "schedule_directive" && !block.allowed_windows?.length)) {
      toast({ title: "/scheduleの開始・終了時刻を入力してください", variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      await flushPendingSaves();
      const response = await dailyPlansApi.generate(selectedDate);
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

  const reloadServerVersion = async () => {
    const response = await dailyPlansApi.get(selectedDate);
    setDocument(response.document);
    documentRef.current = response.document;
    setRevision(response.revision);
    revisionRef.current = response.revision;
    setSchedule(response.schedule ?? null);
    scheduleInputRef.current = response.schedule?.source_document_revision === response.revision ? schedulingBlocks(response.document) : null;
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

  const noteUnavailable = loading || loadError;
  const adjacentDate = (offset: number) => {
    const date = new Date(`${selectedDate}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + offset);
    return date.toISOString().slice(0, 10);
  };
  const scheduleInput = schedule?.source_scheduling_blocks ?? scheduleInputRef.current;
  const scheduleStale = Boolean(schedule && (scheduleInput
    ? !sameSchedulingBlocks(scheduleInput, schedulingBlocks(document))
    : (dirty || schedule.source_document_revision !== revision)));
  const blockIds = new Set(document.blocks.map((block) => block.id));
  const orphanAssignments = (schedule?.assignments ?? []).filter(
    (assignment) => !assignment.directive_id || !blockIds.has(assignment.directive_id),
  ).sort((left, right) => left.start_time.localeCompare(right.start_time));

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="daily-notes" />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="order-1 min-w-0 lg:order-2">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{selectedDate === getJSTDateString() ? "今日のノート" : `${selectedDate} のノート`}</h1>
            <p className="text-sm text-gray-500">
              メモも予定も、このノートに。/schedule で予定を追加できます
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
              disabled={noteUnavailable || generating || (saving && conflict)}
            >
              詳細モード
            </Button>
            <Button onClick={generate} disabled={noteUnavailable || generating || conflict}>
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
                <p className="sm:col-span-2">/schedule の候補からタスクを選択できます。</p>
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
            <Button variant="ghost" size="icon" aria-label="前日のノート" disabled={noteUnavailable || generating} onClick={() => void changeSelectedDate(adjacentDate(-1))}><ChevronLeft className="h-4 w-4" /></Button>
            <div className="space-y-1">
              <Label htmlFor="daily-note-date">対象日</Label>
              <Input
                id="daily-note-date"
                type="date"
                value={selectedDate}
                disabled={noteUnavailable || generating || (saving && conflict)}
                onChange={(event) =>
                  void changeSelectedDate(event.target.value)
                }
                className="w-40"
              />
            </div>
            <Button variant="ghost" size="icon" aria-label="翌日のノート" disabled={noteUnavailable || generating} onClick={() => void changeSelectedDate(adjacentDate(1))}><ChevronRight className="h-4 w-4" /></Button>
            <Button variant="outline" disabled={noteUnavailable || generating} onClick={() => void changeSelectedDate(getJSTDateString())}>今日</Button>
            <Button variant="ghost" className="lg:hidden" onClick={() => globalThis.document.getElementById("daily-note-history")?.scrollIntoView({ behavior: "smooth" })}>履歴・検索</Button>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-2 py-5">
            {loading && <div className="flex min-h-64 items-center justify-center gap-2" role="status"><Loader2 className="h-5 w-5 animate-spin" />ノートを読み込み中…</div>}
            {loadError && <Alert variant="destructive"><AlertTitle>ノートを読み込めませんでした</AlertTitle><AlertDescription>内容を取得できるまで編集を停止しています。<Button variant="outline" size="sm" onClick={() => setLoadSignal((value) => value + 1)}>ノートを再読み込み</Button></AlertDescription></Alert>}
            {!noteUnavailable && <>
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
            <DailyPlanNoteEditor
              key={selectedDate}
              document={document}
              taskOptions={taskOptions}
              onChange={(next) => updateDocument(() => next)}
              renderBlock={(block) => {
                if (block.type === "text") return null;
                const assignments = schedule?.assignments.filter((item) => item.directive_id === block.id) ?? [];
                const diagnostic = schedule?.directive_diagnostics?.find((item) => item.directive_id === block.id);
                return <div className="group space-y-1">
                  {block.type === "checklist_item" ? <ChecklistEditor block={block} taskOptions={taskOptions}
                    onChange={(next) => replaceBlock(block.id, next)} onComplete={(task) => openChecklistCompletion(block, task)} /> :
                    <details className="rounded-md">
                      <summary className="cursor-pointer rounded px-2 py-1.5 text-sm hover:bg-muted">
                        <span className="mr-2 font-mono text-muted-foreground">{block.type === "timed_line"
                          ? `${block.start}–${block.end}`
                          : (block.allowed_windows ?? []).map((window) => `${window.start}–${window.end}`).join(", ") || "時間帯を設定"}</span>
                        {block.title || "タスクを自動配置"}
                        {block.type === "schedule_directive" && <span className="ml-2 text-xs text-muted-foreground">/schedule{block.duration_override_minutes ? ` · ${block.duration_override_minutes}分` : ""}</span>}
                      </summary>
                      <div className="py-2">
                        {block.type === "schedule_directive" ? <DirectiveEditor block={block} taskOptions={taskOptions} projects={projects} onChange={(next) => replaceBlock(block.id, next)} /> :
                          <TimedLineEditor block={block} taskOptions={taskOptions} onChange={(next) => replaceBlock(block.id, next)} />}
                        <Button variant="ghost" size="sm" onClick={() => removeBlock(block.id)}>この予定を削除</Button>
                      </div>
                    </details>}
                  {assignments.map((assignment, index) => <GeneratedAssignmentRow key={`${assignment.task_id}-${assignment.start_time}-${index}`}
                    assignment={assignment} onPin={pinAssignment} onComplete={openCompletion} />)}
                  {diagnostic?.reason && <p className="text-xs text-amber-700">{diagnostic.reason}（候補 {diagnostic.eligible_count}件）</p>}
                </div>;
              }}
            />
            {orphanAssignments.length > 0 && (
              <section aria-label="文書外の予定" className="space-y-2 border-t pt-3">
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
            </>}
          </CardContent>
        </Card>
        </div>
        <div id="daily-note-history" className="order-2 min-w-0 scroll-mt-20 lg:order-1">
          <DailyPlanHistory selectedDate={selectedDate} revision={revision}
            disabled={loading || generating || (saving && conflict)} onSelect={changeSelectedDate} />
        </div>
        </div>
      </main>

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
  onChange,
}: {
  block: DailyPlanScheduleDirective;
  taskOptions: TaskOption[];
  projects: Array<{ id: string; title: string }>;
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
    if (start && end && start < end) onChange({ ...block, allowed_windows: [{ start, end }] });
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
                onBlur={() => { if (allowedWindow) setDraftStart(allowedWindow.start); }}
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
                onBlur={() => { if (allowedWindow) setDraftEnd(allowedWindow.end); }}
                className="w-28"
              />
            </div>
            <Select value={block.work_type ?? "light_work"}
              onValueChange={(work_type: WorkType) => onChange({ ...block, work_type })}>
              <SelectTrigger className="w-32" aria-label="時間枠の作業タイプ"><SelectValue /></SelectTrigger>
              <SelectContent>{Object.entries(workTypeLabels).map(([value, label]) =>
                <SelectItem key={value} value={value}>{label}</SelectItem>,
              )}</SelectContent>
            </Select>
          </div>
      </div>
      {!allowedWindow && <p className="mt-2 text-sm text-amber-700">開始・終了時刻を入力してください。この行は時刻を指定するまで生成できません。</p>}
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
      {!editing ? <button type="button" className="font-mono text-muted-foreground" onClick={() => setEditing(true)} aria-label="予定の時刻を編集">{start}–{end}</button> : <>
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
      </>}
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
