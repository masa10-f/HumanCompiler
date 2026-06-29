'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, CheckCircle2, Loader2, Send, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useApplyGoalTaskDraft, useStartGoalTaskDraftJob } from '@/hooks/use-ai-drafts';
import { toast } from '@/hooks/use-toast';
import { aiPlanningApi } from '@/lib/api';
import type {
  DraftGoal,
  DraftTask,
  GoalTaskDraftMode,
  GoalTaskDraftPayload,
  GoalTaskDraftRequest,
} from '@/types/ai-drafts';
import type { WorkType } from '@/types/task';

interface GoalTaskAssistantDialogProps {
  projectId: string;
  mode: GoalTaskDraftMode;
  goalId?: string;
  taskId?: string;
  title: string;
  defaultMessage: string;
  children: React.ReactNode;
  onApplied?: () => void;
}

const workTypeOptions: Array<{ value: WorkType; label: string }> = [
  { value: 'light_work', label: '軽作業' },
  { value: 'study', label: '学習' },
  { value: 'focused_work', label: '集中作業' },
];

const priorityOptions = [
  { value: 1, label: '最高' },
  { value: 2, label: '高' },
  { value: 3, label: '中' },
  { value: 4, label: '低' },
  { value: 5, label: '最低' },
];

const emptyDraft: GoalTaskDraftPayload = {
  assistant_message: '',
  goals: [],
  tasks: [],
  dependencies: [],
  warnings: [],
};

const AI_DRAFT_POLL_INTERVAL_MS = 2000;
const AI_DRAFT_MAX_WAIT_MS = 10 * 60 * 1000;

const getNestedTaskIds = (goal: DraftGoal) => goal.tasks.map((task) => task.client_id);

const getAllTaskIds = (draft: GoalTaskDraftPayload | null) => {
  if (!draft) return [];
  return [
    ...draft.tasks.map((task) => task.client_id),
    ...draft.goals.flatMap((goal) => getNestedTaskIds(goal)),
  ];
};

const toDateInputValue = (value?: string | null) => {
  if (!value) return '';
  return value.slice(0, 10);
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function GoalTaskAssistantDialog({
  projectId,
  mode,
  goalId,
  taskId,
  title,
  defaultMessage,
  children,
  onApplied,
}: GoalTaskAssistantDialogProps) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(defaultMessage);
  const [draft, setDraft] = useState<GoalTaskDraftPayload | null>(null);
  const [selectedGoalIds, setSelectedGoalIds] = useState<Set<string>>(new Set());
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [cancelOriginalTask, setCancelOriginalTask] = useState(false);
  const [isPollingDraft, setIsPollingDraft] = useState(false);
  const generationRunRef = useRef(0);

  const startDraftJobMutation = useStartGoalTaskDraftJob();
  const applyMutation = useApplyGoalTaskDraft();

  const isGeneratingDraft = startDraftJobMutation.isPending || isPollingDraft;

  useEffect(() => {
    if (open && !message.trim()) {
      setMessage(defaultMessage);
    }
  }, [defaultMessage, message, open]);

  useEffect(() => {
    if (!open) {
      generationRunRef.current += 1;
      setIsPollingDraft(false);
    }
  }, [open]);

  const selectedCounts = useMemo(() => {
    return {
      goals: selectedGoalIds.size,
      tasks: selectedTaskIds.size,
    };
  }, [selectedGoalIds, selectedTaskIds]);

  const hasDraftItems = Boolean(
    draft && (draft.goals.length > 0 || draft.tasks.length > 0)
  );
  const emptyDraftMessage =
    draft && !hasDraftItems
      ? draft.assistant_message ||
        draft.warnings[0] ||
        'AIからゴールまたはタスクの提案が返りませんでした。入力内容を少し具体化して再実行してください。'
      : null;

  const selectAll = (nextDraft: GoalTaskDraftPayload) => {
    setSelectedGoalIds(new Set(nextDraft.goals.map((goal) => goal.client_id)));
    setSelectedTaskIds(new Set(getAllTaskIds(nextDraft)));
  };

  const handleGenerate = async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) return;

    const runId = generationRunRef.current + 1;
    generationRunRef.current = runId;
    setIsPollingDraft(false);
    setDraft({
      ...emptyDraft,
      assistant_message: 'AI提案の生成を開始しています。',
    });

    try {
      const request: GoalTaskDraftRequest = {
        project_id: projectId,
        mode,
        goal_id: goalId,
        task_id: taskId,
        user_message: trimmedMessage,
        current_draft: draft,
        conversation: draft?.assistant_message
          ? [
              { role: 'user', content: trimmedMessage },
              { role: 'assistant', content: draft.assistant_message },
            ]
          : [],
      };
      const job = await startDraftJobMutation.mutateAsync(request);

      if (!job.success || !job.response_id) {
        toast({
          title: 'AI提案を生成できませんでした',
          description: job.message || job.warnings[0],
          variant: 'destructive',
        });
        setDraft({
          ...emptyDraft,
          assistant_message: job.message,
          warnings: job.warnings,
        });
        return;
      }

      setIsPollingDraft(true);
      const startedAt = Date.now();
      while (Date.now() - startedAt < AI_DRAFT_MAX_WAIT_MS) {
        if (generationRunRef.current !== runId) return;

        const status = await aiPlanningApi.getGoalTaskDraftJob(job.response_id);
        if (generationRunRef.current !== runId) return;

        if (status.status === 'queued' || status.status === 'in_progress') {
          setDraft({
            ...emptyDraft,
            assistant_message: status.message || 'AI提案を生成中です。',
          });
          await sleep(AI_DRAFT_POLL_INTERVAL_MS);
          continue;
        }

        if (status.success && status.status === 'completed' && status.draft) {
          const response = status.draft;
          const nextDraft: GoalTaskDraftPayload = {
            assistant_message: response.assistant_message,
            goals: response.goals,
            tasks: response.tasks,
            dependencies: response.dependencies,
            warnings: response.warnings,
          };
          setDraft(nextDraft);
          selectAll(nextDraft);
          return;
        }

        toast({
          title: 'AI提案を生成できませんでした',
          description: status.message || status.warnings[0],
          variant: 'destructive',
        });
        setDraft({
          ...emptyDraft,
          assistant_message: status.message,
          warnings: status.warnings,
        });
        return;
      }

      const timeoutMessage =
        'AI提案の生成が10分以内に完了しませんでした。入力を短くするか、もう一度生成してください。';
      toast({
        title: 'AI提案を生成できませんでした',
        description: timeoutMessage,
        variant: 'destructive',
      });
      setDraft({
        ...emptyDraft,
        assistant_message: timeoutMessage,
        warnings: [timeoutMessage],
      });
    } catch (error) {
      const description = error instanceof Error ? error.message : 'AI提案の生成に失敗しました。';
      toast({
        title: 'AI提案を生成できませんでした',
        description,
        variant: 'destructive',
      });
    } finally {
      if (generationRunRef.current === runId) {
        setIsPollingDraft(false);
      }
    }
  };

  const handleApply = async () => {
    if (!draft) return;
    try {
      const response = await applyMutation.mutateAsync({
        project_id: projectId,
        mode,
        goal_id: goalId,
        task_id: taskId,
        goals: draft.goals,
        tasks: draft.tasks,
        dependencies: draft.dependencies,
        selected_goal_client_ids: Array.from(selectedGoalIds),
        selected_task_client_ids: Array.from(selectedTaskIds),
        original_task_action: cancelOriginalTask ? 'cancel' : 'keep',
      });

      toast({
        title: 'AI提案を適用しました',
        description: `${response.created_goals.length}件のゴール、${response.created_tasks.length}件のタスクを作成しました。`,
      });
      if (response.warnings.length > 0) {
        toast({
          title: '一部の提案をスキップしました',
          description: response.warnings.join('\n'),
        });
      }
      setOpen(false);
      onApplied?.();
    } catch (error) {
      const description = error instanceof Error ? error.message : 'AI提案の適用に失敗しました。';
      toast({
        title: 'AI提案を適用できませんでした',
        description,
        variant: 'destructive',
      });
    }
  };

  const updateGoal = <K extends keyof DraftGoal>(
    goalClientId: string,
    field: K,
    value: DraftGoal[K]
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            goals: current.goals.map((goal) =>
              goal.client_id === goalClientId ? { ...goal, [field]: value } : goal
            ),
          }
        : current
    );
  };

  const updateTask = <K extends keyof DraftTask>(
    taskClientId: string,
    field: K,
    value: DraftTask[K]
  ) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            tasks: current.tasks.map((task) =>
              task.client_id === taskClientId ? { ...task, [field]: value } : task
            ),
            goals: current.goals.map((goal) => ({
              ...goal,
              tasks: goal.tasks.map((task) =>
                task.client_id === taskClientId ? { ...task, [field]: value } : task
              ),
            })),
          }
        : current
    );
  };

  const toggleGoal = (goal: DraftGoal, checked: boolean) => {
    setSelectedGoalIds((current) => {
      const next = new Set(current);
      if (checked) next.add(goal.client_id);
      else next.delete(goal.client_id);
      return next;
    });

    const taskIds = getNestedTaskIds(goal);
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      taskIds.forEach((id) => {
        if (checked) next.add(id);
        else next.delete(id);
      });
      return next;
    });
  };

  const toggleTask = (taskClientId: string, checked: boolean) => {
    setSelectedTaskIds((current) => {
      const next = new Set(current);
      if (checked) next.add(taskClientId);
      else next.delete(taskClientId);
      return next;
    });
  };

  const resetDraft = () => {
    generationRunRef.current += 1;
    setIsPollingDraft(false);
    setDraft(null);
    setSelectedGoalIds(new Set());
    setSelectedTaskIds(new Set());
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[92vh] max-w-[1120px] overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            {title}
          </DialogTitle>
          <DialogDescription className="sr-only">
            AI draft creation dialog
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[calc(92vh-76px)] grid-cols-1 overflow-hidden lg:grid-cols-[340px_1fr]">
          <div className="flex min-h-[280px] flex-col border-b p-4 lg:border-b-0 lg:border-r">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <Bot className="h-4 w-4" />
              AI入力
            </div>
            <Textarea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={8}
              className="resize-none"
            />
            {draft?.assistant_message && (
              <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
                {draft.assistant_message}
              </div>
            )}
            {draft?.warnings && draft.warnings.length > 0 && (
              <div className="mt-3 space-y-1 text-sm text-amber-700">
                {draft.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>
            )}
            {mode === 'split_task' && (
              <label className="mt-4 flex items-center gap-2 text-sm">
                <Checkbox
                  checked={cancelOriginalTask}
                  onCheckedChange={(checked) => setCancelOriginalTask(checked === true)}
                />
                元タスクをキャンセルにする
              </label>
            )}
            <div className="mt-auto flex gap-2 pt-4">
              <Button
                type="button"
                onClick={handleGenerate}
                disabled={isGeneratingDraft || !message.trim()}
                className="flex-1"
              >
                {isGeneratingDraft ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Send className="mr-2 h-4 w-4" />
                )}
                生成
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={resetDraft}
                disabled={!draft || isGeneratingDraft}
              >
                クリア
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto p-4">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">ゴール {selectedCounts.goals}</Badge>
                <Badge variant="secondary">タスク {selectedCounts.tasks}</Badge>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => draft && selectAll(draft)}
                  disabled={!hasDraftItems}
                >
                  全選択
                </Button>
                <Button
                  type="button"
                  onClick={handleApply}
                  disabled={
                    !hasDraftItems ||
                    isGeneratingDraft ||
                    applyMutation.isPending ||
                    selectedCounts.tasks === 0
                  }
                >
                  {applyMutation.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                  )}
                  適用
                </Button>
              </div>
            </div>

            {!draft ? (
              <div className="flex min-h-[360px] items-center justify-center rounded-md border border-dashed text-sm text-muted-foreground">
                AI提案はここに表示されます
              </div>
            ) : (
              <div className="space-y-6">
                {emptyDraftMessage && (
                  <div className="flex min-h-[240px] items-center justify-center rounded-md border border-dashed px-6 text-center text-sm text-muted-foreground">
                    {emptyDraftMessage}
                  </div>
                )}
                {draft.goals.length > 0 && (
                  <section className="space-y-3">
                    <h3 className="text-sm font-semibold">ゴール案</h3>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10" />
                            <TableHead>タイトル</TableHead>
                            <TableHead className="w-28">見積</TableHead>
                            <TableHead>説明</TableHead>
                            <TableHead className="min-w-[260px]">理由</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {draft.goals.map((goal) => (
                            <TableRow key={goal.client_id}>
                              <TableCell>
                                <Checkbox
                                  checked={selectedGoalIds.has(goal.client_id)}
                                  onCheckedChange={(checked) => toggleGoal(goal, checked === true)}
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={goal.title}
                                  onChange={(event) =>
                                    updateGoal(goal.client_id, 'title', event.target.value)
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  type="number"
                                  min="0.1"
                                  step="0.1"
                                  value={goal.estimate_hours}
                                  onChange={(event) =>
                                    updateGoal(
                                      goal.client_id,
                                      'estimate_hours',
                                      Number.parseFloat(event.target.value) || 0.1
                                    )
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Textarea
                                  value={goal.description || ''}
                                  rows={2}
                                  onChange={(event) =>
                                    updateGoal(goal.client_id, 'description', event.target.value)
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Textarea
                                  value={goal.rationale || ''}
                                  rows={2}
                                  onChange={(event) =>
                                    updateGoal(goal.client_id, 'rationale', event.target.value)
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                )}

                {draft.goals.map((goal) =>
                  goal.tasks.length > 0 ? (
                    <TaskDraftTable
                      key={`${goal.client_id}-tasks`}
                      title={`${goal.title} のタスク案`}
                      tasks={goal.tasks}
                      selectedTaskIds={selectedTaskIds}
                      onToggleTask={toggleTask}
                      onUpdateTask={updateTask}
                    />
                  ) : null
                )}

                {draft.tasks.length > 0 && (
                  <TaskDraftTable
                    title="タスク案"
                    tasks={draft.tasks}
                    selectedTaskIds={selectedTaskIds}
                    onToggleTask={toggleTask}
                    onUpdateTask={updateTask}
                  />
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TaskDraftTable({
  title,
  tasks,
  selectedTaskIds,
  onToggleTask,
  onUpdateTask,
}: {
  title: string;
  tasks: DraftTask[];
  selectedTaskIds: Set<string>;
  onToggleTask: (taskClientId: string, checked: boolean) => void;
  onUpdateTask: <K extends keyof DraftTask>(
    taskClientId: string,
    field: K,
    value: DraftTask[K]
  ) => void;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10" />
              <TableHead className="min-w-[220px]">タイトル</TableHead>
              <TableHead className="w-24">見積</TableHead>
              <TableHead className="w-36">作業種別</TableHead>
              <TableHead className="w-28">優先度</TableHead>
              <TableHead className="w-36">締切</TableHead>
              <TableHead className="min-w-[260px]">説明</TableHead>
              <TableHead className="min-w-[280px]">理由</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((task) => (
              <TableRow key={task.client_id}>
                <TableCell>
                  <Checkbox
                    checked={selectedTaskIds.has(task.client_id)}
                    onCheckedChange={(checked) => onToggleTask(task.client_id, checked === true)}
                  />
                </TableCell>
                <TableCell>
                  <Input
                    value={task.title}
                    onChange={(event) =>
                      onUpdateTask(task.client_id, 'title', event.target.value)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={task.estimate_hours}
                    onChange={(event) =>
                      onUpdateTask(
                        task.client_id,
                        'estimate_hours',
                        Number.parseFloat(event.target.value) || 0.1
                      )
                    }
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={task.work_type}
                    onValueChange={(value) =>
                      onUpdateTask(task.client_id, 'work_type', value as WorkType)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {workTypeOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select
                    value={String(task.priority)}
                    onValueChange={(value) =>
                      onUpdateTask(task.client_id, 'priority', Number.parseInt(value, 10))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {priorityOptions.map((option) => (
                        <SelectItem key={option.value} value={String(option.value)}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    type="date"
                    value={toDateInputValue(task.due_date)}
                    onChange={(event) =>
                      onUpdateTask(task.client_id, 'due_date', event.target.value || null)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Textarea
                    value={task.description || ''}
                    rows={2}
                    onChange={(event) =>
                      onUpdateTask(task.client_id, 'description', event.target.value)
                    }
                  />
                </TableCell>
                <TableCell>
                  <Textarea
                    value={task.rationale || ''}
                    rows={2}
                    onChange={(event) =>
                      onUpdateTask(task.client_id, 'rationale', event.target.value)
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
