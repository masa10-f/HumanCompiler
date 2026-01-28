'use client';

import { useDroppable } from '@dnd-kit/core';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DraggableTask } from './DraggableTask';
import type { TimeSlot, TaskInfo } from '@/types/ai-planning';
import type { Project } from '@/types/project';

interface SlotTask {
  task: TaskInfo;
  isFixed: boolean;
  duration_hours?: number;
}

interface DroppableSlotProps {
  slot: TimeSlot;
  slotIndex: number;
  assignedTasks: SlotTask[];
  projects: Project[];
  onSlotChange: (index: number, field: keyof TimeSlot, value: string | number | undefined) => void;
  onRemoveSlot: (index: number) => void;
  onRemoveTask: (taskId: string) => void;
  onTaskDurationChange?: (taskId: string, durationHours: number | undefined) => void;
}

export function DroppableSlot({
  slot,
  slotIndex,
  assignedTasks,
  projects,
  onSlotChange,
  onRemoveSlot,
  onRemoveTask,
  onTaskDurationChange,
}: DroppableSlotProps) {
  const { isOver, setNodeRef, active } = useDroppable({
    id: `slot-${slotIndex}`,
    data: {
      type: 'slot',
      slotIndex,
    },
  });

  const startTime = new Date(`2000-01-01T${slot.start}`);
  const endTime = new Date(`2000-01-01T${slot.end}`);
  const duration = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);

  const assignedHours = assignedTasks.reduce(
    (sum, t) => sum + (t.duration_hours ?? t.task.estimate_hours),
    0
  );
  const remainingHours = duration - assignedHours;

  const kindColors: Record<string, { bg: string; border: string; text: string }> = {
    study: { bg: 'bg-blue-50', border: 'border-blue-300', text: 'text-blue-700' },
    focused_work: { bg: 'bg-purple-50', border: 'border-purple-300', text: 'text-purple-700' },
    light_work: { bg: 'bg-green-50', border: 'border-green-300', text: 'text-green-700' },
  };

  const kindLabels: Record<string, string> = {
    study: '学習',
    focused_work: '集中作業',
    light_work: '軽作業',
  };

  const colors = kindColors[slot.kind] || { bg: 'bg-gray-50', border: 'border-gray-300', text: 'text-gray-700' };

  // Check if the dragged task can be dropped here (kind matching)
  const canDrop = active?.data?.current?.task?.kind === slot.kind ||
                  !active?.data?.current?.task?.kind ||
                  remainingHours >= (active?.data?.current?.task?.estimate_hours ?? 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl border-2 transition-all duration-200 overflow-hidden',
        colors.border,
        isOver && canDrop && 'ring-4 ring-blue-400 ring-opacity-50 border-blue-500 scale-[1.01]',
        isOver && !canDrop && 'ring-4 ring-red-400 ring-opacity-50 border-red-400',
      )}
    >
      {/* Slot Header */}
      <div className={cn('px-4 py-3', colors.bg)}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className={cn('font-semibold text-lg', colors.text)}>
              スロット {slotIndex + 1}
            </span>
            <Badge variant="outline" className={cn('text-xs', colors.text)}>
              {kindLabels[slot.kind]}
            </Badge>
          </div>
          <Button
            onClick={() => onRemoveSlot(slotIndex)}
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-gray-400 hover:text-red-500"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        {/* Slot Configuration */}
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">開始</Label>
            <Input
              type="time"
              value={slot.start}
              onChange={(e) => onSlotChange(slotIndex, 'start', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">終了</Label>
            <Input
              type="time"
              value={slot.end}
              onChange={(e) => onSlotChange(slotIndex, 'end', e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-gray-500">種別</Label>
            <Select
              value={slot.kind}
              onValueChange={(value) => onSlotChange(slotIndex, 'kind', value)}
            >
              <SelectTrigger className="h-8 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="study">学習</SelectItem>
                <SelectItem value="focused_work">集中作業</SelectItem>
                <SelectItem value="light_work">軽作業</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Optional project filter */}
        <div className="mt-2">
          <Label className="text-xs text-gray-500">プロジェクト限定（任意）</Label>
          <Select
            value={slot.assigned_project_id || 'none'}
            onValueChange={(value) =>
              onSlotChange(slotIndex, 'assigned_project_id', value === 'none' ? undefined : value)
            }
          >
            <SelectTrigger className="h-8 text-sm mt-1">
              <SelectValue placeholder="未指定" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">未指定</SelectItem>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>
                  {project.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Capacity indicator */}
        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="flex items-center gap-1 text-gray-600">
            <Clock className="h-4 w-4" />
            <span>{duration.toFixed(1)}時間</span>
          </div>
          <div className={cn(
            'font-medium',
            remainingHours < 0 ? 'text-red-600' :
            remainingHours === 0 ? 'text-amber-600' : 'text-green-600'
          )}>
            残り: {remainingHours.toFixed(1)}h
          </div>
        </div>
      </div>

      {/* Drop Zone */}
      <div
        className={cn(
          'min-h-[80px] p-3 bg-white transition-colors',
          isOver && canDrop && 'bg-blue-50',
          isOver && !canDrop && 'bg-red-50',
        )}
      >
        {assignedTasks.length > 0 ? (
          <div className="space-y-2">
            {assignedTasks.map(({ task, isFixed, duration_hours }) => (
              <div key={task.id} className="space-y-1">
                <DraggableTask
                  task={task}
                  isAssigned
                  isFixed={isFixed}
                  onRemove={() => onRemoveTask(task.id)}
                />
                {/* Duration editor for manual assignments */}
                {!isFixed && onTaskDurationChange && (
                  <div className="flex items-center gap-2 pl-2 ml-5">
                    <Label className="text-xs text-gray-500 whitespace-nowrap">時間:</Label>
                    <Input
                      type="number"
                      min={0.25}
                      max={task.estimate_hours}
                      step={0.25}
                      value={duration_hours ?? ''}
                      placeholder={`${task.estimate_hours}h (全量)`}
                      onChange={(e) => {
                        const value = e.target.value;
                        onTaskDurationChange(
                          task.id,
                          value ? parseFloat(value) : undefined
                        );
                      }}
                      className="h-7 w-24 text-xs"
                    />
                    <span className="text-xs text-gray-400">/ {task.estimate_hours}h</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className={cn(
            'flex items-center justify-center h-full min-h-[60px] border-2 border-dashed rounded-lg text-gray-400 transition-colors',
            isOver && canDrop && 'border-blue-400 bg-blue-50 text-blue-600',
            isOver && !canDrop && 'border-red-400 bg-red-50 text-red-600',
          )}>
            <div className="text-center">
              <Plus className="h-6 w-6 mx-auto mb-1 opacity-50" />
              <span className="text-sm">タスクをドロップ</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
