// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import { AlertTriangle } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface NoteConflictAlertProps {
  /** `useNote().conflict`: the note changed elsewhere and saves are paused. */
  conflict: boolean;
  /** Both buttons are disabled while a save is in flight. */
  saving: boolean;
  onReload: () => void | Promise<void>;
  onOverwrite: () => void | Promise<void>;
  className?: string;
}

/**
 * The banner every note editor shows when its save got a 409: the note was
 * changed elsewhere (e.g. by an agent) after this screen read it.
 */
export function NoteConflictAlert({
  conflict,
  saving,
  onReload,
  onOverwrite,
  className,
}: NoteConflictAlertProps) {
  if (!conflict) return null;

  return (
    <Alert
      className={cn(
        'mb-4 border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400',
        className
      )}
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p>このノートは、開いた後に別の場所（エージェントなど）で更新されました。</p>
        <div className="mt-3 flex flex-wrap items-start gap-3">
          <div className="flex flex-col gap-1">
            <Button
              size="sm"
              onClick={() => {
                void onReload();
              }}
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
              void onOverwrite();
            }}
            disabled={saving}
          >
            この内容で上書き
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
