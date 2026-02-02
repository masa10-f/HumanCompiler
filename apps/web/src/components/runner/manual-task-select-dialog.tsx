'use client';

import { useState, useEffect, useMemo } from 'react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Clock, Search, FolderOpen, AlertCircle } from 'lucide-react';
import { projectsApi, tasksApi } from '@/lib/api';
import type { Project } from '@/types/project';

interface ManualTaskSelectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isStarting: boolean;
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
  onStart,
}: ManualTaskSelectDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('all');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [duration, setDuration] = useState<number>(60);
  const [plannedOutcome, setPlannedOutcome] = useState('');

  // Fetch all projects
  const { data: projects = [], isLoading: projectsLoading } = useQuery({
    queryKey: ['projects', 'all'],
    queryFn: () => projectsApi.getAll(0, 100),
    enabled: open,
  });

  // Fetch tasks for selected project (or all projects)
  const { data: tasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['tasks', 'manual-select', selectedProjectId, projects.map(p => p.id).join(',')],
    queryFn: async () => {
      if (selectedProjectId === 'all') {
        // Fetch tasks from all projects in parallel using Promise.all
        const taskPromises = projects.map((project) =>
          tasksApi.getByProject(project.id, 0, 100)
        );
        const taskResults = await Promise.all(taskPromises);
        return taskResults.flat();
      } else {
        return tasksApi.getByProject(selectedProjectId, 0, 100);
      }
    },
    enabled: open && (selectedProjectId !== 'all' || projects.length > 0),
  });

  // Filter to only show actionable tasks (pending or in_progress)
  const actionableTasks = useMemo(() => {
    return tasks.filter(
      (task) => task.status === 'pending' || task.status === 'in_progress'
    );
  }, [tasks]);

  // Filter tasks by search query
  const filteredTasks = useMemo(() => {
    if (!searchQuery.trim()) return actionableTasks;
    const query = searchQuery.toLowerCase();
    return actionableTasks.filter(
      (task) =>
        task.title.toLowerCase().includes(query) ||
        (task.description?.toLowerCase().includes(query) ?? false)
    );
  }, [actionableTasks, searchQuery]);

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
    onOpenChange(false);
  };

  // Reset task selection when project changes
  useEffect(() => {
    setSelectedTaskId('');
  }, [selectedProjectId]);

  const selectedTask = filteredTasks.find((t) => t.id === selectedTaskId);
  const isLoading = projectsLoading || tasksLoading;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FolderOpen className="h-5 w-5" />
            タスクを手動で選択
          </DialogTitle>
          <DialogDescription>
            スケジュール外のタスクを選択して作業を開始できます。
            作業完了時にスケジュールへの影響が提案されます。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Project filter */}
          <div className="space-y-2">
            <Label>プロジェクト</Label>
            <Select
              value={selectedProjectId}
              onValueChange={setSelectedProjectId}
            >
              <SelectTrigger>
                <SelectValue placeholder="プロジェクトを選択" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">すべてのプロジェクト</SelectItem>
                {projects.map((project: Project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Search */}
          <div className="space-y-2">
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
          <div className="space-y-3">
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
            disabled={!selectedTaskId || isStarting}
          >
            {isStarting ? '開始中...' : 'セッション開始'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
