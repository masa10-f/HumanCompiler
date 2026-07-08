'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createContextNoteExtensions } from './context-note-extensions';

interface ContextNoteViewerProps {
  content: string;
  className?: string;
  variant?: 'full' | 'compact';
}

export function ContextNoteViewer({
  content,
  className,
  variant = 'full',
}: ContextNoteViewerProps) {
  const isCompact = variant === 'compact';
  const editor = useEditor({
    extensions: createContextNoteExtensions(),
    content,
    editable: false,
    editorProps: {
      attributes: {
        'aria-label': 'Note content',
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  if (!editor) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <EditorContent
      editor={editor}
      className={cn(
        'context-note-content context-note-viewer max-w-none',
        isCompact ? 'p-3' : 'p-4',
        'rounded-lg bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100',
        'border border-gray-200 dark:border-gray-700',
        '[&_.ProseMirror]:outline-none',
        className
      )}
    />
  );
}
