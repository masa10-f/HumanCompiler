// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CheckSquare2, Clock3, RefreshCw, Target } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { dashboardApi } from '@/lib/api';
import { formatJSTDateTime } from '@/lib/date-utils';
import { queryKeys } from '@/lib/query-keys';
import type { RecentDashboardItem } from '@/types/dashboard';
import { taskStatusLabels } from '@/types/task';

const ITEM_LIMIT = 5;

const UPDATED_AT_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tokyo',
};

const formatUpdatedAt = (value: string) =>
  formatJSTDateTime(value, UPDATED_AT_FORMAT_OPTIONS);

const getItemHref = (item: RecentDashboardItem) => {
  const goalHref = `/projects/${item.project_id}/goals/${item.goal_id}`;
  return item.kind === 'task' ? `${goalHref}/tasks/${item.id}` : goalHref;
};

export function RecentItemShortcuts() {
  const recentItems = useQuery({
    queryKey: queryKeys.dashboard.recentItems(ITEM_LIMIT),
    queryFn: () => dashboardApi.getRecentItems(ITEM_LIMIT),
    staleTime: 30 * 1000,
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Clock3 className="h-5 w-5 text-blue-600" />
          最近触った項目
        </CardTitle>
        <CardDescription>
          更新したタスク・ゴールへすぐに戻れます
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recentItems.isLoading && !recentItems.data ? (
          <div
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            <span className="sr-only">最近触った項目を読み込み中</span>
            {Array.from({ length: ITEM_LIMIT }, (_, index) => (
              <div key={index} className="h-32 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        ) : recentItems.data?.length ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {recentItems.data.map((item) => {
              const Icon = item.kind === 'task' ? CheckSquare2 : Target;
              const itemLabel = item.kind === 'task' ? 'タスク' : 'ゴール';
              const breadcrumb =
                item.kind === 'task'
                  ? `${item.project_title} › ${item.goal_title}`
                  : item.project_title;

              return (
                <Link
                  key={`${item.kind}-${item.id}`}
                  href={getItemHref(item)}
                  className="group min-w-0 rounded-lg border bg-background p-3 transition-colors hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-blue-950/30"
                  aria-label={`${itemLabel}「${item.title}」を開く`}
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <Badge variant="outline" className="gap-1">
                      <Icon className="h-3.5 w-3.5" />
                      {itemLabel}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {taskStatusLabels[item.status]}
                    </span>
                  </div>
                  <p className="line-clamp-2 min-h-10 break-words text-sm font-medium group-hover:text-blue-700 dark:group-hover:text-blue-300">
                    {item.title}
                  </p>
                  <p
                    className="mt-2 truncate text-xs text-muted-foreground"
                    title={breadcrumb}
                  >
                    {breadcrumb}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatUpdatedAt(item.updated_at)} 更新
                  </p>
                </Link>
              );
            })}
          </div>
        ) : recentItems.isError ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-destructive">
              最近触った項目を取得できませんでした
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => recentItems.refetch()}
            >
              <RefreshCw className="mr-1 h-4 w-4" />
              再試行
            </Button>
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-muted-foreground">
            タスクやゴールを更新すると、ここにショートカットが表示されます
          </div>
        )}
      </CardContent>
    </Card>
  );
}
