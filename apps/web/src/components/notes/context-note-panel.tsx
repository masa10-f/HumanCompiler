'use client';

import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Edit3, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ContextNoteEditor } from './context-note-editor';
import { ContextNoteViewer } from './context-note-viewer';

interface ContextNotePanelProps {
  content: string;
  onUpdate: (content: string) => void;
  saving?: boolean;
  placeholder?: string;
  updatedAt?: string | Date | null;
  variant?: 'full' | 'compact';
  className?: string;
}

function hasRenderableContent(content: string) {
  return content
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim().length > 0;
}

export function ContextNotePanel({
  content,
  onUpdate,
  saving = false,
  placeholder = 'Write your notes here...',
  updatedAt,
  variant = 'full',
  className,
}: ContextNotePanelProps) {
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const isCompact = variant === 'compact';
  const hasContent = useMemo(() => hasRenderableContent(content), [content]);
  const formattedUpdatedAt = useMemo(() => {
    if (!updatedAt) return null;

    const date = updatedAt instanceof Date ? updatedAt : new Date(updatedAt);
    if (Number.isNaN(date.getTime())) return null;

    return format(date, 'yyyy-MM-dd HH:mm');
  }, [updatedAt]);

  if (mode === 'edit') {
    return (
      <div className={cn('space-y-3', className)}>
        <ContextNoteEditor
          content={content}
          onUpdate={onUpdate}
          saving={saving}
          placeholder={placeholder}
          variant={variant}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-500 dark:text-gray-400">
          <div className="flex min-h-9 items-center">
            {saving ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-4 w-4 animate-spin" />
                Saving...
              </span>
            ) : formattedUpdatedAt ? (
              <span>Last updated: {formattedUpdatedAt}</span>
            ) : null}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setMode('view')}
          >
            Done
          </Button>
        </div>
      </div>
    );
  }

  if (!hasContent) {
    return (
      <div
        className={cn(
          'rounded-lg border border-dashed border-gray-300 bg-white px-4 py-6 text-center dark:border-gray-700 dark:bg-gray-900',
          isCompact && 'py-4',
          className
        )}
      >
        <FileText className="mx-auto mb-3 h-6 w-6 text-gray-400" />
        <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
          No notes yet
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Add context when it becomes useful.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => setMode('edit')}
        >
          <Edit3 className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-center justify-end">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setMode('edit')}
        >
          <Edit3 className="mr-2 h-4 w-4" />
          Edit
        </Button>
      </div>
      <ContextNoteViewer content={content} variant={variant} />
      {formattedUpdatedAt && (
        <div className="text-sm text-gray-500 dark:text-gray-400">
          Last updated: {formattedUpdatedAt}
        </div>
      )}
    </div>
  );
}
