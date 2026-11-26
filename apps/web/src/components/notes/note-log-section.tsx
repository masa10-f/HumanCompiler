// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { useId, useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, ChevronDown, ChevronRight, History, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNote } from '@/hooks/use-notes';
import type { NoteEntityType, NoteLogSummary } from '@/types/context-note';
import { ContextNotePanel } from './context-note-panel';
import { NoteConflictAlert } from './note-conflict-alert';

interface NoteLogSectionProps {
  entityType: NoteEntityType;
  entityId: string;
  /**
   * What the overview says about the log, shown while the log is closed.
   * null: the item has no log with text yet. undefined: not known yet.
   */
  summary?: NoteLogSummary | null;
  variant?: 'full' | 'compact';
  className?: string;
}

function formatUpdatedAt(value: string): string | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : format(date, 'yyyy-MM-dd HH:mm');
}

function summaryText(summary: NoteLogSummary | null | undefined): string | null {
  if (summary === undefined) return null;
  if (summary === null) return 'まだありません';
  const updated = formatUpdatedAt(summary.updated_at);
  const size = `約${summary.characters.toLocaleString('ja-JP')}文字`;
  return updated ? `${size}・最終更新 ${updated}` : size;
}

/** The log itself. Mounted when the section is first opened, so it loads then. */
function NoteLogBody({
  entityType,
  entityId,
  variant,
}: Required<Pick<NoteLogSectionProps, 'entityType' | 'entityId' | 'variant'>>) {
  const { note, loading, error, saving, conflict, updateNote, refetch, reloadLatest, overwrite } =
    useNote({ entityType, entityId, section: 'log' });
  // A new key remounts the panel after a reload, so it starts over in view mode
  // and the editor's undo history cannot bring back the dropped local text.
  const [panelKey, setPanelKey] = useState(0);

  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
        <AlertCircle className="h-6 w-6 text-red-500" />
        <p className="text-sm text-red-600">ログの読み込みに失敗しました</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          再試行
        </Button>
      </div>
    );
  }
  return (
    <>
      <NoteConflictAlert
        conflict={conflict}
        saving={saving}
        onReload={async () => {
          await reloadLatest();
          setPanelKey((key) => key + 1);
        }}
        onOverwrite={overwrite}
      />
      <ContextNotePanel
        key={panelKey}
        content={note?.content ?? ''}
        onUpdate={(content) => updateNote({ content, content_type: 'html' })}
        saving={saving}
        placeholder="経緯や作業メモを書き足す..."
        updatedAt={note?.updated_at}
        variant={variant}
        emptyTitle="ログはまだありません"
        emptyDescription="経緯や作業メモはここに書き足していきます。エージェントの追記もここに入ります。"
        attachmentTarget={{ type: entityType, id: entityId }}
      />
    </>
  );
}

/**
 * The log of a project, goal or task, under its overview and closed until
 * asked for: a log keeps growing, and the page is for what is true now. It is
 * loaded when first opened and stays mounted afterwards, so an edit in
 * progress is not lost by closing it.
 */
export function NoteLogSection({
  entityType,
  entityId,
  summary,
  variant = 'full',
  className,
}: NoteLogSectionProps) {
  const [open, setOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const bodyId = useId();
  const Chevron = open ? ChevronDown : ChevronRight;
  // Once the log has been opened the header would repeat what is below it, and
  // the overview's figures go stale as the log is edited.
  const text = opened ? null : summaryText(summary);

  return (
    <section
      className={cn('mt-4 border-t border-gray-200 pt-3 dark:border-gray-700', className)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => {
          setOpen((value) => !value);
          setOpened(true);
        }}
        className="flex w-full items-center gap-2 rounded-md py-1 text-left text-sm text-gray-600 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-gray-300 dark:hover:text-gray-100"
      >
        <Chevron className="h-4 w-4 shrink-0" aria-hidden />
        <History className="h-4 w-4 shrink-0" aria-hidden />
        <span className="font-medium">ログ</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">経緯・作業メモ</span>
        {text ? (
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-400">{text}</span>
        ) : null}
      </button>
      <div id={bodyId} hidden={!open} className="mt-3">
        {opened ? (
          <NoteLogBody entityType={entityType} entityId={entityId} variant={variant} />
        ) : null}
      </div>
    </section>
  );
}
