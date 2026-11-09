// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/layout/app-header";
import { NotesTabs } from "@/components/notes/notes-tabs";
import { WeeklyNoteWorkspace } from "@/components/notes/weekly-note-workspace";
import { getJSTDateString } from "@/lib/date-utils";
import { isValidDateString } from "@/lib/weekly-note";

/** `?week=` may be any day of the week; it opens the week of that day. */
function initialDay(): string {
  const week =
    typeof window === "undefined"
      ? null
      : new URLSearchParams(window.location.search).get("week");
  return week && isValidDateString(week) ? week : getJSTDateString();
}

export default function WeeklyNotesPage() {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [day, setDay] = useState(initialDay);

  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace("/login");
  }, [loading, isAuthenticated, router]);

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("week", day);
    window.history.replaceState(window.history.state, "", url);
  }, [day]);

  if (loading || !isAuthenticated)
    return (
      <div
        role="status"
        className="flex min-h-screen items-center justify-center"
      >
        読み込み中…
      </div>
    );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="daily-notes" />
      <main className="mx-auto max-w-5xl px-4 py-8">
        <h1 className="text-2xl font-bold">ノート一覧</h1>
        <p className="mb-4 mt-2 text-sm text-muted-foreground">
          1週間ごとに、目標や振り返りを1つのノートにまとめられます。週の始まりの曜日は設定で選べます。
        </p>
        <NotesTabs current="weekly" />
        <WeeklyNoteWorkspace day={day} onDayChange={setDay} />
      </main>
    </div>
  );
}
