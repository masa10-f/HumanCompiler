'use client';

import { useState } from 'react';
import { X, Plus, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { tasksApi } from '@/lib/api';
import { toast } from '@/hooks/use-toast';
import type { Task, TaskDependency } from '@/types/task';

interface TaskDependenciesManagerProps {
  task: Task;
  availableTasks: Task[];
  onDependencyAdded?: () => void;
  onDependencyRemoved?: () => void;
}

export function TaskDependenciesManager({
  task,
  availableTasks,
  onDependencyAdded,
  onDependencyRemoved,
}: TaskDependenciesManagerProps) {
  const [dependencies, setDependencies] = useState<TaskDependency[]>(task.dependencies || []);
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [isAdding, setIsAdding] = useState(false);
  const [isRemoving, setIsRemoving] = useState<string | null>(null);

  // Filter out tasks that cannot be dependencies
  const selectableTasks = availableTasks.filter(t => {
    // Cannot depend on itself
    if (t.id === task.id) return false;
    // Cannot depend on a task that's already a dependency
    if (dependencies.some(d => d.depends_on_task_id === t.id)) return false;
    return true;
  });

  const handleAddDependency = async () => {
    if (!selectedTaskId) return;

    setIsAdding(true);
    try {
      const newDependency = await tasksApi.addDependency(task.id, selectedTaskId);

      // Find the task details for the new dependency
      const dependsOnTask = availableTasks.find(t => t.id === selectedTaskId);
      if (dependsOnTask) {
        newDependency.depends_on_task = dependsOnTask;
      }

      setDependencies([...dependencies, newDependency]);
      setSelectedTaskId('');
      toast({
        title: '依存関係を追加しました',
        description: `「${dependsOnTask?.title}」への依存関係を追加しました。`,
      });
      onDependencyAdded?.();
    } catch (error) {
      toast({
        title: 'エラー',
        description: '依存関係の追加に失敗しました。',
        variant: 'destructive',
      });
    } finally {
      setIsAdding(false);
    }
  };

  const handleRemoveDependency = async (dependencyId: string) => {
    setIsRemoving(dependencyId);
    try {
      await tasksApi.deleteDependency(task.id, dependencyId);
      setDependencies(dependencies.filter(d => d.id !== dependencyId));
      toast({
        title: '依存関係を削除しました',
      });
      onDependencyRemoved?.();
    } catch (error) {
      toast({
        title: 'エラー',
        description: '依存関係の削除に失敗しました。',
        variant: 'destructive',
      });
    } finally {
      setIsRemoving(null);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-sm font-medium">依存タスク</label>
        <p className="text-xs text-muted-foreground mb-2">
          このタスクが依存する（先に完了すべき）タスクを選択します
        </p>

        {dependencies.length === 0 ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              依存関係が設定されていません
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-2">
            {dependencies.map((dep) => (
              <div
                key={dep.id}
                className="flex items-center justify-between p-2 border rounded-md"
              >
                <div className="flex items-center gap-2">
                  <Badge variant="outline">依存先</Badge>
                  <span className="text-sm">
                    {dep.depends_on_task?.title || '不明なタスク'}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleRemoveDependency(dep.id)}
                  disabled={isRemoving === dep.id}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Select
          value={selectedTaskId}
          onValueChange={setSelectedTaskId}
          disabled={isAdding || selectableTasks.length === 0}
        >
          <SelectTrigger className="flex-1">
            <SelectValue placeholder="依存タスクを選択..." />
          </SelectTrigger>
          <SelectContent>
            {selectableTasks.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          size="sm"
          onClick={handleAddDependency}
          disabled={!selectedTaskId || isAdding}
        >
          <Plus className="h-4 w-4 mr-1" />
          追加
        </Button>
      </div>
    </div>
  );
}
