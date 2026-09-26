'use client';

import Link from 'next/link';
import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  CalendarDays,
  ChevronRight,
  History,
  SlidersHorizontal,
} from 'lucide-react';
import { AppHeader } from '@/components/layout/app-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth';

interface SubPage {
  title: string;
  path: string;
  icon: LucideIcon;
  description: string;
  note?: string;
}

const SUB_PAGE_GROUPS: Array<{ id: string; title: string; pages: SubPage[] }> = [
  {
    id: 'review',
    title: '振り返り',
    pages: [
      {
        title: 'スケジュール履歴',
        path: '/scheduling/history',
        icon: History,
        description:
          '自動スケジュールで作った日ごとの予定を一覧で確認し、各タスクの作業時間を記録できます。',
      },
      {
        title: '週間作業報告',
        path: '/scheduling/weekly-report',
        icon: BarChart3,
        description:
          '開始日から7日間の作業ログを集計し、作業時間・完了タスク数と報告書（Markdown）を作成します。',
        note: 'OpenAI API キーの登録（設定画面）が必要です。',
      },
    ],
  },
  {
    id: 'settings',
    title: '設定',
    pages: [
      {
        title: 'スケジュール調整',
        path: '/scheduling/tuning',
        icon: SlidersHorizontal,
        description:
          '自動スケジュールの配置ルール（作業種別の一致、期限、作業ブロックの長さ、プロジェクトの切り替え、連続作業など）の重みを変え、試しに配置して確認できます。',
        note: '保存した設定は、このブラウザでの自動スケジュールに使われます。',
      },
    ],
  },
];

const NOTE_EXAMPLES = [
  { code: '1100-1200 会議', label: '固定予定' },
  { code: '/schedule 13:00-17:00 (90m)', label: '時間枠内にタスクを90分配置' },
];

export default function SchedulingHomePage() {
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
      <AppHeader currentPage="scheduling" />
      <main className="container mx-auto max-w-4xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-3xl font-bold">スケジューリング</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            1日の予定は日次計画のノートで立てます。ほかのページは、その結果の振り返りと自動スケジュールの調整に使います。
          </p>
        </div>

        <section aria-labelledby="daily-plan-heading">
          <Card className="border-blue-200 dark:border-blue-900">
            <CardContent className="p-6">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-3">
                  <h2
                    id="daily-plan-heading"
                    className="flex items-center gap-2 text-xl font-semibold"
                  >
                    <CalendarDays className="h-5 w-5 text-blue-600" aria-hidden />
                    日次計画
                  </h2>
                  <p className="text-sm leading-6 text-muted-foreground">
                    その日のノートに固定予定・休憩・/schedule の時間枠を書き、「自動スケジュール」でタスクを時間に割り当てます。メモや作業の実績も同じノートに残せます。
                  </p>
                  <ul className="space-y-1 text-sm">
                    {NOTE_EXAMPLES.map((example) => (
                      <li
                        key={example.code}
                        className="flex flex-wrap items-center gap-x-2 gap-y-1"
                      >
                        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                          {example.code}
                        </code>
                        <span className="text-muted-foreground">
                          {example.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button asChild className="shrink-0">
                  <Link href="/scheduling/daily">今日のノートを開く</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        {SUB_PAGE_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`${group.id}-heading`}>
            <h2
              id={`${group.id}-heading`}
              className="mb-2 text-sm font-semibold text-muted-foreground"
            >
              {group.title}
            </h2>
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {group.pages.map((page) => (
                <li key={page.path}>
                  <Link
                    href={page.path}
                    className="flex items-start gap-3 px-4 py-4 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <page.icon
                      className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{page.title}</div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {page.description}
                      </p>
                      {page.note && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {page.note}
                        </p>
                      )}
                    </div>
                    <ChevronRight
                      className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden
                    />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </main>
    </div>
  );
}
