// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { CalendarRange } from "lucide-react";

import { AppHeader } from "@/components/layout/app-header";
import { WeeklyRhythmEditor } from "@/components/scheduling/weekly-rhythm-editor";
import { useAuth } from "@/hooks/use-auth";

export default function WeeklyRhythmPage() {
  const { user, loading: authLoading } = useAuth();

  if (authLoading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <AppHeader currentPage="weekly-rhythm" />
      <main className="container mx-auto max-w-5xl space-y-6 px-4 py-6">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <CalendarRange className="h-7 w-7 text-blue-600" />
            週のリズム
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            曜日ごとに、日次ノートの最初に入れる予定を決めます。「予定枠」は /schedule
            の時間枠になり、プロジェクトを選ぶと自動スケジュールがそのプロジェクトのタスクから埋めます。固定予定と休憩はそのまま固定予定・休憩の行になります。
            予定がまだないノートを開くと、その曜日の枠を挿入できます。挿入した後は、ノートの中で自由に変更できます。
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            「動かさない」は、今後追加する週内の時間の再配分で動かさない枠（実験など）の印です。現時点では記録だけで、ノートへの挿入には影響しません。
          </p>
        </div>
        <WeeklyRhythmEditor />
      </main>
    </div>
  );
}
