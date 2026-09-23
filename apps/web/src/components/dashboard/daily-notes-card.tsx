// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DailyNotePreview } from "./daily-note-preview";
import { useQuery } from "@tanstack/react-query";
import { NotebookPen, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { dailyPlansApi } from "@/lib/api";
import { getJSTDateString } from "@/lib/date-utils";
import { queryKeys } from "@/lib/query-keys";

const NOTE_LIMIT = 3;

export function DailyNotesCard() {
  const [today, setToday] = useState(getJSTDateString);
  useEffect(() => {
    const refreshDate = () => setToday(getJSTDateString());
    const timer = window.setInterval(refreshDate, 60000);
    window.addEventListener("focus", refreshDate);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshDate);
    };
  }, []);
  // Fetch today explicitly: future-dated notes can fill every recent-note slot.
  const todayNote = useQuery({
    queryKey: queryKeys.dashboard.dailyNote(today),
    queryFn: () => dailyPlansApi.get(today),
    staleTime: 0,
  });
  const notes = useQuery({
    queryKey: queryKeys.dashboard.dailyNotes(NOTE_LIMIT),
    queryFn: () => dailyPlansApi.list({ limit: NOTE_LIMIT }),
    // Revisit the dashboard after editing a note: refresh its preview immediately.
    staleTime: 0,
  });

  const recentNotes = notes.data?.items.filter((note) => note.date !== today);
  return (
    <Card>
      <CardHeader className="gap-3 pb-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <NotebookPen className="h-5 w-5 text-blue-600" />
            ノート
          </CardTitle>
          <CardDescription>
            日付ごとのメモ・予定・進捗を記録できます
          </CardDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link href={`/scheduling/daily?date=${today}`}>
              今日のノートを開く
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/notes">
              <Search className="mr-1 h-4 w-4" />
              ノート一覧・検索
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <section aria-label="今日のノート" className="space-y-2">
          <h3 className="text-sm font-semibold">
            今日のノート{" "}
            <time
              dateTime={today}
              className="ml-2 font-normal text-muted-foreground"
            >
              {today}
            </time>
          </h3>
          {todayNote.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              今日のノートを読み込み中…
            </p>
          ) : todayNote.isError ? (
            <div role="status" className="text-sm text-destructive">
              今日のノートを取得できませんでした。
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void todayNote.refetch()}
              >
                今日のノートを再読み込み
              </Button>
            </div>
          ) : todayNote.data.document.blocks.length ? (
            <DailyNotePreview document={todayNote.data.document} />
          ) : (
            <p className="text-sm text-muted-foreground">
              今日のノートはまだ空です。「今日のノートを開く」から書き始められます。
            </p>
          )}
        </section>
        <h3 className="text-sm font-semibold">ほかの日のノート</h3>
        {notes.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            最近のノートを読み込み中…
          </p>
        )}
        {notes.isError && (
          <div
            role="status"
            className="flex items-center gap-2 text-sm text-destructive"
          >
            最近のノートを取得できませんでした。
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void notes.refetch()}
            >
              再試行
            </Button>
          </div>
        )}
        {recentNotes?.length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {recentNotes.map((note) => (
              <Link
                key={note.date}
                href={`/scheduling/daily?date=${note.date}`}
                aria-label={`${note.date} のノートを開く`}
                className="min-w-0 rounded-lg border p-3 transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <time
                  dateTime={note.date}
                  className="text-xs text-muted-foreground"
                >
                  {note.date}
                </time>
                <p className="mt-1 truncate text-sm font-medium">
                  {note.title}
                </p>
                <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
                  {note.preview}
                </p>
              </Link>
            ))}
          </div>
        ) : (
          !notes.isPending &&
          !notes.isError && (
            <p className="text-sm text-muted-foreground">
              ほかの日に保存したノートはまだありません。
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
