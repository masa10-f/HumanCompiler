// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dailyPlansApi, weekStartApi, weeklyNotesApi } from "@/lib/api";
import { getJSTDateString } from "@/lib/date-utils";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import {
  WEEK_START_DAY_LABELS,
  addDays,
  formatShortDate,
  formatWeekRange,
  relativeWeekLabel,
  weekDates,
  weekEndOf,
  weekdayLabel,
} from "@/lib/weekly-note";
import { useWeeklyNote } from "@/hooks/use-weekly-note";
import type { UseNoteDocumentReturn } from "@/hooks/use-note-document";
import type { WeeklyNote } from "@/types/weekly-note";
import { ContextNotePanel } from "./context-note-panel";
import { NoteConflictAlert } from "./note-conflict-alert";

const RECENT_LIMIT = 8;

interface WeeklyNoteWorkspaceProps {
  /** Any day of the week shown; the server decides which week it belongs to. */
  day: string;
  onDayChange: (day: string) => void;
}

/** One week's note, the week's daily notes, and recent weekly notes. */
export function WeeklyNoteWorkspace({ day, onDayChange }: WeeklyNoteWorkspaceProps) {
  return (
    <div className="space-y-4">
      <WeekStartSummary />
      {/* A key per week gives each week fresh editor state; a pending edit is
          saved to its own week on unmount. */}
      <WeekView key={day} day={day} onDayChange={onDayChange} />
    </div>
  );
}

/** The user's week start, changed on the settings page. */
function WeekStartSummary() {
  const { data } = useQuery({
    queryKey: queryKeys.userSettings.weekStart(),
    queryFn: () => weekStartApi.get(),
  });
  if (!data) return null;

  return (
    <p className="text-right text-sm text-muted-foreground">
      週の始まり: {WEEK_START_DAY_LABELS[data.week_start_day]}（
      <Link href="/settings" className="underline hover:text-foreground">
        設定で変更
      </Link>
      ）
    </p>
  );
}

function WeekView({ day, onDayChange }: WeeklyNoteWorkspaceProps) {
  const today = getJSTDateString();
  const editor = useWeeklyNote(day);
  // The week the server resolved `day` to; unknown until the note loads.
  const weekStart = editor.note?.week_start ?? null;
  const isThisWeek = weekStart !== null && relativeWeekLabel(weekStart, today) === "今週";
  const base = weekStart ?? day;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-h-12">
          {weekStart ? (
            <>
              <p className="text-sm text-muted-foreground">
                {relativeWeekLabel(weekStart, today)}
              </p>
              <h2 className="text-xl font-semibold">{formatWeekRange(weekStart)}</h2>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onDayChange(addDays(base, -7))}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            前の週
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isThisWeek}
            onClick={() => onDayChange(today)}
          >
            今週
          </Button>
          <Button variant="outline" size="sm" onClick={() => onDayChange(addDays(base, 7))}>
            次の週
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-label="週次ノート">
          <WeeklyNoteEditor editor={editor} />
        </section>
        <aside className="space-y-6">
          {weekStart ? <WeekDailyNotes weekStart={weekStart} /> : null}
          <RecentWeeklyNotes weekStart={weekStart} onDayChange={onDayChange} />
        </aside>
      </div>
    </div>
  );
}

function WeeklyNoteEditor({ editor }: { editor: UseNoteDocumentReturn<WeeklyNote> }) {
  const queryClient = useQueryClient();
  const { note, loading, error, saving, conflict, updateNote, reloadLatest, overwrite } =
    editor;
  // A new key remounts the panel after a reload, so it starts over in view mode
  // and the editor's undo history cannot bring back the dropped local text.
  const [panelKey, setPanelKey] = useState(0);
  const updatedAt = note?.updated_at ?? null;

  // Keep the recent list's previews in step with saves.
  useEffect(() => {
    if (updatedAt) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.weeklyNotes.lists() });
    }
  }, [updatedAt, queryClient]);

  if (loading) {
    return (
      <div role="status" className="flex min-h-[240px] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        <span className="sr-only">読み込み中…</span>
      </div>
    );
  }

  if (error && !note) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center text-center">
        <AlertCircle className="mb-3 h-8 w-8 text-red-500" />
        <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <NoteConflictAlert
        sticky
        conflict={conflict}
        saving={saving}
        onReload={async () => {
          await reloadLatest();
          setPanelKey((key) => key + 1);
        }}
        onOverwrite={overwrite}
      />
      {error ? (
        <p role="alert" className="mb-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
      <ContextNotePanel
        key={panelKey}
        content={note?.content ?? ""}
        onUpdate={(content) => updateNote({ content, content_type: "html" })}
        saving={saving}
        placeholder="今週の目標、うまくいったこと、来週に持ち越すことなど"
        updatedAt={updatedAt}
        emptyTitle="この週のノートはまだありません"
        emptyDescription="週の目標や振り返りを書いておくと、エージェントも MCP から読めます。"
      />
    </div>
  );
}

function WeekDailyNotes({ weekStart }: { weekStart: string }) {
  const weekEnd = weekEndOf(weekStart);
  const today = getJSTDateString();
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.weeklyNotes.dailyNotes(weekStart),
    queryFn: () =>
      dailyPlansApi.list({ date_from: weekStart, date_to: weekEnd, limit: 7 }),
  });
  const byDate = new Map((data?.items ?? []).map((item) => [item.date, item]));

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">この週の日次ノート</h3>
      {isError ? (
        <p className="text-sm text-muted-foreground">日次ノートを読み込めませんでした</p>
      ) : (
        <ul className="divide-y rounded-md border bg-white dark:bg-gray-950">
          {weekDates(weekStart).map((date) => {
            const item = byDate.get(date);
            return (
              <li key={date}>
                <Link
                  href={`/scheduling/daily?date=${date}`}
                  className={cn(
                    "flex gap-3 px-3 py-2 text-sm hover:bg-muted/50",
                    date === today && "bg-primary/5",
                  )}
                >
                  <span className="w-14 shrink-0 tabular-nums text-muted-foreground">
                    {formatShortDate(date)}（{weekdayLabel(date)}）
                  </span>
                  <span
                    className={cn(
                      "min-w-0 truncate",
                      !item && "text-muted-foreground",
                    )}
                  >
                    {isLoading ? "…" : item ? item.title || item.preview : "ノートなし"}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function RecentWeeklyNotes({
  weekStart,
  onDayChange,
}: {
  weekStart: string | null;
  onDayChange: (day: string) => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.weeklyNotes.list(RECENT_LIMIT),
    queryFn: () => weeklyNotesApi.list({ limit: RECENT_LIMIT }),
  });

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">最近の週次ノート</h3>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">読み込み中…</p>
      ) : isError ? (
        <p className="text-sm text-muted-foreground">週次ノートを読み込めませんでした</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">まだ週次ノートはありません</p>
      ) : (
        <ul className="space-y-1">
          {data.items.map((item) => (
            <li key={item.week_start}>
              <button
                type="button"
                onClick={() => onDayChange(item.week_start)}
                aria-current={item.week_start === weekStart ? "true" : undefined}
                className={cn(
                  "w-full rounded-md px-3 py-2 text-left text-sm hover:bg-muted/50",
                  item.week_start === weekStart && "bg-primary/10",
                )}
              >
                <span className="block font-medium">
                  {formatShortDate(item.week_start)}〜{formatShortDate(item.week_end)}
                </span>
                <span className="block truncate text-muted-foreground">
                  {item.preview}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
