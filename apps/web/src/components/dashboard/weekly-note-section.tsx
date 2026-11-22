// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
import { forwardRef, useImperativeHandle, type MouseEvent } from "react";
import { WeeklyNoteEditor } from "@/components/notes/weekly-note-workspace";
import { useWeeklyNote } from "@/hooks/use-weekly-note";
import { formatWeekRange } from "@/lib/weekly-note";

interface WeeklyNoteSectionProps {
  /** Today; the section shows the weekly note of the week containing it. */
  day: string;
  /** Click handler of the link to the weekly notes page. */
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

export interface WeeklyNoteSectionHandle {
  /**
   * Save pending edits and wait for them; rejects while the note has unsaved
   * content, so the caller can stay on the dashboard instead of leaving.
   */
  beforeLeave: () => Promise<void>;
}

/**
 * This week's weekly note, editable in place. Remount it (React `key`) when
 * `day` changes. Call `beforeLeave` before navigating or remounting, so the
 * next screen reads the saved note and a failed save keeps the editor open.
 */
export const WeeklyNoteSection = forwardRef<
  WeeklyNoteSectionHandle,
  WeeklyNoteSectionProps
>(function WeeklyNoteSection({ day, onOpen }, ref) {
  const editor = useWeeklyNote(day);
  const { flush } = editor;
  useImperativeHandle(
    ref,
    () => ({
      beforeLeave: () =>
        // Say which of the card's two notes needs attention.
        flush().catch((error: unknown) => {
          throw new Error(
            `週次ノート: ${error instanceof Error ? error.message : "保存できませんでした。"}`,
          );
        }),
    }),
    [flush],
  );
  const weekStart = editor.note?.week_start ?? null;

  return (
    <section aria-label="今週のノート" className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          今週のノート
          {weekStart && (
            <time
              dateTime={weekStart}
              className="ml-2 font-normal text-muted-foreground"
            >
              {formatWeekRange(weekStart)}
            </time>
          )}
        </h3>
        <Link
          href={`/notes/weekly?week=${weekStart ?? day}`}
          onClick={onOpen}
          className="text-sm text-muted-foreground underline hover:text-foreground"
        >
          週次ノートを開く
        </Link>
      </div>
      <WeeklyNoteEditor editor={editor} />
    </section>
  );
});
