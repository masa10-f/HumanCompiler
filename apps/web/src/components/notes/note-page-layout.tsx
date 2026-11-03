'use client';

import { ReactNode, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Loader2, AlertCircle, AlertTriangle, FileText } from 'lucide-react';
import { ContextNotePanel } from './context-note-panel';
import { useNote } from '@/hooks/use-notes';
import type { NoteEntityType } from '@/types/context-note';

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
  const { note, loading, error, saving, conflict, updateNote, reloadLatest, overwrite } =
    useNote({
      entityType,
      entityId,
    });
  // The editor reads `content` only on mount; a new key remounts it after a reload.
  const [panelKey, setPanelKey] = useState(0);

  const handleReloadLatest = async () => {
    await reloadLatest();
    setPanelKey((key) => key + 1);
  };

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

      {conflict && (
        <Alert className="mb-4 border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <p>このノートは、開いた後に別の場所（エージェントなど）で更新されました。</p>
            <div className="mt-3 flex flex-wrap items-start gap-3">
              <div className="flex flex-col gap-1">
                <Button
                  size="sm"
                  onClick={handleReloadLatest}
                  disabled={saving}
                >
                  最新を読み込む
                </Button>
                <span className="text-xs text-amber-800 dark:text-amber-200">
                  この画面で保存していない変更は消えます
                </span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  void overwrite();
                }}
                disabled={saving}
              >
                この内容で上書き
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <ContextNotePanel
        key={panelKey}
        content={note?.content || ''}
        onUpdate={(content) => updateNote({ content, content_type: 'html' })}
        saving={saving}
        placeholder={`Write context notes for this ${entityType}...`}
        updatedAt={note?.updated_at}
      />
    </div>
  );
}
