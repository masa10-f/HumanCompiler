// SPDX-License-Identifier: MIT
// SPDX-FileCopyrightText: 2025 HumanCompiler Contributors

'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useTaskNote } from '@/hooks/use-notes';
import { ContextNoteEditor } from '@/components/notes/context-note-editor';
import { FileText, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TaskNotesSectionProps {
  taskId: string;
}

export function TaskNotesSection({ taskId }: TaskNotesSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const { note, loading, saving, updateNote } = useTaskNote(taskId);

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            タスクノート
          </CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsExpanded(!isExpanded)}
            className="h-8 w-8 p-0"
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent
        className={cn(
          'transition-all duration-200 overflow-hidden',
          isExpanded ? 'max-h-[600px] opacity-100' : 'max-h-0 opacity-0 py-0'
        )}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : (
          <ContextNoteEditor
            content={note?.content ?? ''}
            onUpdate={(content) => updateNote({ content })}
            saving={saving}
            placeholder="作業メモを入力..."
            className="max-h-[500px] overflow-y-auto"
          />
        )}
      </CardContent>
    </Card>
  );
}
