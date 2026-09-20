// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
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
  const notes = useQuery({
    queryKey: queryKeys.dashboard.dailyNotes(NOTE_LIMIT),
    queryFn: () => dailyPlansApi.list({ limit: NOTE_LIMIT }),
    // Revisit the dashboard after editing a note: refresh its preview immediately.
    staleTime: 0,
  });

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
            <Link href={`/scheduling/daily?date=${getJSTDateString()}`}>
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
      <CardContent>
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
        {notes.data?.items.length ? (
          <div className="grid gap-3 sm:grid-cols-3">
            {notes.data.items.map((note) => (
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
              今日のノートから書き始めると、ここに保存したノートが並びます。
            </p>
          )
        )}
      </CardContent>
    </Card>
  );
}
