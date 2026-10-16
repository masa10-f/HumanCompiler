// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { AppHeader } from "@/components/layout/app-header";
import { DailyPlanHistory } from "@/components/scheduling/daily-plan-history";

export default function NotesPage() {
  const { loading, isAuthenticated } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !isAuthenticated) router.replace("/login");
  }, [loading, isAuthenticated, router]);

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
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold">ノート一覧</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          メモや予定、進捗の記録を日付ごとに振り返れます。ノートを選ぶと編集画面が開きます。
        </p>
        <DailyPlanHistory
          layout="collection"
          selectedDate=""
          revision={0}
          disabled={false}
          onSelect={async (date) => {
            router.push(`/scheduling/daily?date=${date}`);
          }}
        />
      </main>
    </div>
  );
}
