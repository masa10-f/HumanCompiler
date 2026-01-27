'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/badge';
import { Clock, GripVertical, Pin } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TaskInfo } from '@/types/ai-planning';

interface DraggableTaskProps {
  task: TaskInfo;
  isAssigned?: boolean;
  isFixed?: boolean;
  onRemove?: () => void;
}

export function DraggableTask({ task, isAssigned, isFixed, onRemove }: DraggableTaskProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: task.id,
    data: {
      type: 'task',
      task,
    },
    disabled: isFixed,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.5 : 1,
  };

  const kindColors: Record<string, string> = {
    study: 'bg-blue-50 border-blue-200 hover:border-blue-400',
    focused_work: 'bg-purple-50 border-purple-200 hover:border-purple-400',
    light_work: 'bg-green-50 border-green-200 hover:border-green-400',
  };

  const kindBadgeColors: Record<string, string> = {
    study: 'bg-blue-100 text-blue-700',
    focused_work: 'bg-purple-100 text-purple-700',
    light_work: 'bg-green-100 text-green-700',
  };

  const kindLabels: Record<string, string> = {
    study: '学習',
    focused_work: '集中',
    light_work: '軽作業',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'relative flex items-start gap-2 p-3 rounded-lg border-2 transition-all',
        'bg-white shadow-sm cursor-grab active:cursor-grabbing',
        kindColors[task.kind] || 'bg-gray-50 border-gray-200',
        isDragging && 'shadow-lg ring-2 ring-blue-400 z-50',
        isAssigned && !isFixed && 'border-dashed opacity-80',
        isFixed && 'border-solid border-amber-400 bg-amber-50 cursor-default'
      )}
    >
      {!isFixed && (
        <div
          {...attributes}
          {...listeners}
          className="flex items-center text-gray-400 hover:text-gray-600 touch-none"
        >
          <GripVertical className="h-5 w-5" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {isFixed && (
                <Pin className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
              )}
              <h4 className="font-medium text-sm text-gray-900 truncate">
                {task.title}
              </h4>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline" className={cn('text-xs', kindBadgeColors[task.kind])}>
                {kindLabels[task.kind] || task.kind}
              </Badge>
              <div className="flex items-center text-xs text-gray-500">
                <Clock className="h-3 w-3 mr-1" />
                {task.estimate_hours.toFixed(1)}h
              </div>
            </div>
          </div>

          {isAssigned && !isFixed && onRemove && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              className="text-gray-400 hover:text-red-500 p-1 -mr-1"
              title="割り当てを解除"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
