// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
import type { MouseEvent } from "react";
import { WeeklyNoteEditor } from "@/components/notes/weekly-note-workspace";
import { useWeeklyNote } from "@/hooks/use-weekly-note";
import { formatWeekRange } from "@/lib/weekly-note";

interface WeeklyNoteSectionProps {
  /** Today; the section shows the weekly note of the week containing it. */
  day: string;
  /** Click handler of the link to the weekly notes page. */
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * This week's weekly note, editable in place. Remount it (React `key`) when
 * `day` changes; a pending edit is saved to its own week on unmount.
 */
export function WeeklyNoteSection({ day, onOpen }: WeeklyNoteSectionProps) {
  const editor = useWeeklyNote(day);
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
}
