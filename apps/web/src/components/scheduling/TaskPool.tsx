'use client';

import { useState, useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ListTodo, Search, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DraggableTask } from './DraggableTask';
import type { TaskInfo } from '@/types/ai-planning';

interface TaskPoolProps {
  tasks: TaskInfo[];
  assignedTaskIds: Set<string>;
  isLoading?: boolean;
}

export function TaskPool({ tasks, assignedTaskIds, isLoading }: TaskPoolProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [kindFilter, setKindFilter] = useState<string>('all');

  const { isOver, setNodeRef } = useDroppable({
    id: 'task-pool',
    data: {
      type: 'pool',
    },
  });

  // Filter out assigned tasks and apply search/filter
  const availableTasks = useMemo(() => {
    return tasks.filter(task => {
      // Exclude assigned tasks
      if (assignedTaskIds.has(task.id)) return false;

      // Apply search filter
      if (searchQuery && !task.title.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false;
      }

      // Apply kind filter
      if (kindFilter !== 'all' && task.kind !== kindFilter) {
        return false;
      }

      return true;
    });
  }, [tasks, assignedTaskIds, searchQuery, kindFilter]);

  // Group tasks by kind for better organization
  const groupedTasks = useMemo(() => {
    const groups: Record<string, TaskInfo[]> = {
      focused_work: [],
      study: [],
      light_work: [],
    };

    availableTasks.forEach(task => {
      const targetGroup = groups[task.kind];
      if (targetGroup) {
        targetGroup.push(task);
      } else {
        groups.light_work!.push(task);
      }
    });

    return groups;
  }, [availableTasks]);

  const kindLabels: Record<string, string> = {
    focused_work: '集中作業',
    study: '学習',
    light_work: '軽作業',
  };

  const kindColors: Record<string, string> = {
    focused_work: 'bg-purple-100 text-purple-800',
    study: 'bg-blue-100 text-blue-800',
    light_work: 'bg-green-100 text-green-800',
  };

  const totalHours = availableTasks.reduce((sum, task) => sum + task.estimate_hours, 0);

  return (
    <Card
      ref={setNodeRef}
      className={cn(
        'h-full transition-all duration-200',
        isOver && 'ring-2 ring-blue-400 ring-opacity-50'
      )}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ListTodo className="h-5 w-5 text-blue-600" />
              タスクプール
            </CardTitle>
            <CardDescription className="mt-1">
              ドラッグしてスロットに配置
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold text-gray-900">
              {availableTasks.length}
            </div>
            <div className="text-xs text-gray-500">
              計 {totalHours.toFixed(1)}h
            </div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="flex gap-2 mt-4">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
            <Input
              placeholder="タスクを検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9"
            />
          </div>
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger className="w-[120px] h-9">
              <Filter className="h-4 w-4 mr-1" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">すべて</SelectItem>
              <SelectItem value="focused_work">集中作業</SelectItem>
              <SelectItem value="study">学習</SelectItem>
              <SelectItem value="light_work">軽作業</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>

      <CardContent className="pt-0 overflow-y-auto max-h-[calc(100vh-400px)]">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-gray-500">
            <div className="animate-spin rounded-full h-6 w-6 border-2 border-blue-500 border-t-transparent mr-2" />
            読み込み中...
          </div>
        ) : availableTasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {tasks.length === 0 ? (
              <p>タスクがありません</p>
            ) : assignedTaskIds.size === tasks.length ? (
              <p>すべてのタスクが割り当て済みです</p>
            ) : (
              <p>条件に一致するタスクがありません</p>
            )}
          </div>
        ) : kindFilter === 'all' ? (
          // Grouped view
          <div className="space-y-4">
            {Object.entries(groupedTasks).map(([kind, kindTasks]) => {
              if (kindTasks.length === 0) return null;
              return (
                <div key={kind}>
                  <div className="flex items-center gap-2 mb-2">
                    <Badge className={cn('text-xs', kindColors[kind])}>
                      {kindLabels[kind]}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {kindTasks.length}件
                    </span>
                  </div>
                  <div className="space-y-2">
                    {kindTasks.map(task => (
                      <DraggableTask key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          // Flat view when filtered
          <div className="space-y-2">
            {availableTasks.map(task => (
              <DraggableTask key={task.id} task={task} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
