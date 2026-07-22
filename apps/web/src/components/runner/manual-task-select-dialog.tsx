'use client';

import { useState, useEffect, useMemo, useDeferredValue } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useWorkSessionResumeContext } from '@/hooks/use-work-sessions';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Clock, Search, FolderOpen, AlertCircle } from 'lucide-react';
import { projectsApi, tasksApi } from '@/lib/api';
import { getSelectableProjects } from '@/lib/project-filters';
import type { Project } from '@/types/project';

interface ManualTaskSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isStarting: boolean;
  initialTaskId?: string | null;
  onStart: (
    taskId: string,
    plannedCheckoutAt: string,
    plannedOutcome?: string,
    isManualExecution?: boolean
  ) => Promise<void>;
}

export function ManualTaskSelectDialog({
  open,
  onOpenChange,
  isStarting,
  initialTaskId,
  onStart,
}: ManualTaskSelectDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [plannedOutcome, setPlannedOutcome] = useState('');
  const [chooseAnotherTask, setChooseAnotherTask] = useState(false);
  const isInitialTaskMode = Boolean(initialTaskId) && !chooseAnotherTask;
  const deferredSearch = useDeferredValue(searchQuery.trim());
  const resumeContext = useWorkSessionResumeContext(selectedTaskId || undefined);

  // Fetch all projects
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectsApi.getAll(0, 100),
    enabled: open && !isInitialTaskMode,
  });
  const selectableProjects = useMemo(
    () => getSelectableProjects(projects),
    [projects]
  );

  useEffect(() => {
    if (
      selectedProjectId !== 'all' &&
      !selectableProjects.some((project) => project.id === selectedProjectId)
    ) {
      setSelectedProjectId('all');
    }
  }, [selectableProjects, selectedProjectId]);

  // Fetch cross-project tasks in one server-side query.
  const { data: taskPage, isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'manual-select', selectedProjectId, deferredSearch],
    queryFn: () => tasksApi.getWorkspace({
      limit: 100,
      status: ['pending', 'in_progress'],
      projectId: selectedProjectId === 'all' ? undefined : selectedProjectId,
      projectStatus: selectedProjectId === 'all' ? 'in_progress' : undefined,
      search: deferredSearch || undefined,
      sortBy: 'priority',
    }),
    enabled: open && !isInitialTaskMode,
  });
  const filteredTasks = taskPage?.items ?? [];

  // A workspace or recommendation link may point to a task outside the first
  // page of the manual picker, so load that task directly by ID.
  const {
    data: initialTask,
    isLoading: initialTaskLoading,
    isError: initialTaskError,
  } = useQuery({
    queryKey: ['tasks', 'manual-select', 'initial', initialTaskId],
    queryFn: () => tasksApi.getById(initialTaskId as string),
    enabled: open && isInitialTaskMode,
  });

  useEffect(() => {
    if (open && initialTaskId) {
      setSelectedTaskId(initialTaskId);
      setChooseAnotherTask(false);
    }
  }, [initialTaskId, open]);

  // Calculate planned checkout time
  const calculateCheckoutTime = (): string => {
    const now = new Date();
    const checkoutTime = new Date(now.getTime() + duration * 60 * 1000);
    return checkoutTime.toISOString();
  };

  const handleStart = async () => {
    if (!selectedTaskId) return;
    await onStart(
      selectedTaskId,
      calculateCheckoutTime(),
      plannedOutcome || undefined,
      true // is_manual_execution = true
    );
    handleClose();
  };

  const handleClose = () => {
    setSelectedProjectId('all');
    setSelectedTaskId('');
    setSearchQuery('');
    setDuration(60);
    setPlannedOutcome('');
    setChooseAnotherTask(false);
    onOpenChange(false);
  };

  const selectedTask = isInitialTaskMode
    ? initialTask
    : filteredTasks.find((t) => t.id === selectedTaskId);
  const isLoading = isInitialTaskMode
    ? initialTaskLoading
    : projectsLoading || tasksLoading;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            {isInitialTaskMode ? 'セッション開始' : 'タスクを手動で選択'}
          </DialogTitle>
          <DialogDescription>
            {isInitialTaskMode ? (
              <>選択したタスクの作業時間と今回の目標を確認してください。</>
            ) : (
              <>
                スケジュール外のタスクを選択して作業を開始できます。
                作業完了時にスケジュールへの影響が提案されます。
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {isInitialTaskMode && (
            <div className="space-y-3">
              <Label>開始するタスク</Label>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  読み込み中...
                </div>
              ) : initialTaskError || !initialTask ? (
                <div className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive">
                  選択したタスクを読み込めませんでした。
                </div>
              ) : (
                <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
                  <p className="font-medium">{initialTask.title}</p>
                  {initialTask.description && (
                    <p className="mt-1 text-sm text-muted-foreground line-clamp-3">
                      {initialTask.description}
                    </p>
                  )}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Badge variant="outline" className="text-xs">
                      <Clock className="h-3 w-3 mr-1" />
                      見積もり {initialTask.estimate_hours}h
                    </Badge>
                    <Badge variant="secondary" className="text-xs">
                      {initialTask.status === 'pending' ? '未着手' : '進行中'}
                    </Badge>
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setChooseAnotherTask(true);
                  setSelectedTaskId('');
                }}
              >
                別のタスクを選択
              </Button>
            </div>
          )}

          {selectedTask && resumeContext.data && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                前回の中断（{new Date(resumeContext.data.interrupted_at).toLocaleString('ja-JP')}）: {resumeContext.data.interruption_note}
                {resumeContext.data.remaining_estimate_hours != null &&
                  `（残り ${resumeContext.data.remaining_estimate_hours}h）`}
              </AlertDescription>
            </Alert>
          )}

          {/* Project filter */}
          <div className={isInitialTaskMode ? 'hidden' : 'space-y-2'}>
            <Label>プロジェクト</Label>
            <Select
              value={selectedProjectId}
              onValueChange={(value) => {
                setSelectedProjectId(value);
                setSelectedTaskId('');
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="プロジェクトを選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべてのプロジェクト</SelectItem>
                {selectableProjects.map((project: Project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className={isInitialTaskMode ? 'hidden' : 'space-y-2'}>
            <Label>タスク検索</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="タスク名で検索..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>

          {/* Task selection */}
          <div className={isInitialTaskMode ? 'hidden' : 'space-y-3'}>
            <Label>タスク選択</Label>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">
                読み込み中...
              </div>
            ) : filteredTasks.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground flex flex-col items-center gap-2">
                <AlertCircle className="h-8 w-8" />
                <p>選択可能なタスクがありません</p>
                <p className="text-xs">
                  未完了のタスクがある場合のみ選択できます
                </p>
              </div>
            ) : (
              <RadioGroup
                value={selectedTaskId}
                onValueChange={setSelectedTaskId}
                className="space-y-2 max-h-[240px] overflow-y-auto pr-2"
              >
                {filteredTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start space-x-3 rounded-lg border p-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2"
                    onClick={() => setSelectedTaskId(task.id)}
                  >
                    <RadioGroupItem value={task.id} id={task.id} className="mt-1" />
                    <div className="flex-1 min-w-0">
                      <label
                        htmlFor={task.id}
                        className="font-medium text-sm cursor-pointer block truncate"
                      >
                        {task.title}
                      </label>
                      {task.description && (
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                          {task.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {task.project_title} › {task.goal_title}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          <Clock className="h-3 w-3 mr-1" />
                          {task.estimate_hours}h
                        </Badge>
                        <Badge
                          variant="secondary"
                          className="text-xs"
                        >
                          {task.status === 'pending' ? '未着手' : '進行中'}
                        </Badge>
                        {task.due_date && (
                          <Badge variant="outline" className="text-xs">
                            期限: {new Date(task.due_date).toLocaleDateString('ja-JP')}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            )}
          </div>

          {/* Duration setting */}
          <div className="space-y-3">
            <Label htmlFor="duration">作業時間（分）</Label>
            <div className="flex items-center gap-4">
              <Input
                id="duration"
                type="number"
                min={5}
                max={480}
                step={5}
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                className="w-24"
              />
              <div className="flex gap-2 flex-wrap">
                {[25, 50, 60, 90, 120].map((mins) => (
                  <Button
                    key={mins}
                    type="button"
                    variant={duration === mins ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setDuration(mins)}
                  >
                    {mins}分
                  </Button>
                ))}
              </div>
            </div>
            {selectedTask && (
              <p className="text-xs text-muted-foreground">
                タスクの見積もり: {selectedTask.estimate_hours}時間（
                {selectedTask.estimate_hours * 60}分）
              </p>
            )}
          </div>

          {/* Planned outcome */}
          <div className="space-y-3">
            <Label htmlFor="planned-outcome">今回の目標（任意）</Label>
            <Textarea
              id="planned-outcome"
              placeholder="このセッションで達成したいことを書いてください"
              value={plannedOutcome}
              onChange={(e) => setPlannedOutcome(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>

          {/* Info message */}
          <div className="rounded-lg bg-blue-50 dark:bg-blue-950 p-3 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-medium mb-1">手動実行について</p>
            <p className="text-xs">
              スケジュール外のタスクを実行すると、作業完了時に今日のスケジュールへの影響が計算され、
              リスケジュールの提案が表示されます。
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isStarting}>
            キャンセル
          </Button>
          <Button
            onClick={handleStart}
            disabled={
              !selectedTaskId ||
              isStarting ||
              isLoading ||
              (isInitialTaskMode && (initialTaskError || !initialTask))
            }
          >
            {isStarting ? '開始中...' : 'セッション開始'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
