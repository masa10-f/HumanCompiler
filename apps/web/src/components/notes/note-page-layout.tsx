'use client';

import { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, FileText } from 'lucide-react';
import { ContextNoteEditor } from './context-note-editor';
import { useNote } from '@/hooks/use-notes';
import type { NoteEntityType } from '@/types/context-note';
import { format } from 'date-fns';

interface NotePageLayoutProps {
  entityType: NoteEntityType;
  entityId: string;
  entityTitle: string;
  breadcrumb: ReactNode;
  backUrl: string;
}

export function NotePageLayout({
  entityType,
  entityId,
  entityTitle,
  breadcrumb,
  backUrl,
}: NotePageLayoutProps) {
  const router = useRouter();
  const { note, loading, error, saving, updateNote } = useNote({
    entityType,
    entityId,
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <AlertCircle className="h-12 w-12 text-red-500 mb-4" />
        <p className="text-red-600 dark:text-red-400 mb-4">{error}</p>
        <Button onClick={() => router.push(backUrl)}>Go Back</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Navigation */}
      <div className="flex items-center gap-4 mb-6">
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push(backUrl)}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="text-sm text-gray-500 dark:text-gray-400">
          {breadcrumb}
        </div>
      </div>

      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <FileText className="h-6 w-6 text-gray-400" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {entityTitle}
          </h1>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {entityType.charAt(0).toUpperCase() + entityType.slice(1)} Context Notes
        </p>
      </div>

      {/* Editor */}
      <ContextNoteEditor
        content={note?.content || ''}
        onUpdate={(content) => {
          if (note) {
            updateNote({ content });
          }
        }}
        saving={saving}
        placeholder={`Write context notes for this ${entityType}...`}
      />

      {/* Footer */}
      {note && (
        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400">
          Last updated: {format(new Date(note.updated_at), 'yyyy-MM-dd HH:mm')}
        </div>
      )}
    </div>
  );
}
