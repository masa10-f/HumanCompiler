// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useId } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { weekStartApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import {
  WEEK_START_DAYS,
  WEEK_START_DAY_LABELS,
  type WeekStartDay,
} from "@/lib/weekly-note";

/** Settings card: the weekday a week starts on, for weekly notes. */
export function WeekStartCard() {
  const id = useId();
  const queryClient = useQueryClient();
  const { data, isError } = useQuery({
    queryKey: queryKeys.userSettings.weekStart(),
    queryFn: () => weekStartApi.get(),
  });
  const mutation = useMutation({
    mutationFn: (weekStartDay: WeekStartDay) =>
      weekStartApi.update({ week_start_day: weekStartDay }),
    onSuccess: (settings) => {
      queryClient.setQueryData(queryKeys.userSettings.weekStart(), settings);
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CalendarDays className="h-5 w-5" />
          週の始まり
        </CardTitle>
        <CardDescription>
          週次ノートの1週間を何曜日から始めるかを選びます。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Label htmlFor={id}>週の始まり</Label>
          <select
            id={id}
            className="h-9 rounded-md border bg-background px-3 text-sm"
            value={data?.week_start_day ?? ""}
            disabled={!data || mutation.isPending}
            onChange={(event) => mutation.mutate(event.target.value as WeekStartDay)}
          >
            {!data ? <option value="">読み込み中…</option> : null}
            {WEEK_START_DAYS.map((value) => (
              <option key={value} value={value}>
                {WEEK_START_DAY_LABELS[value]}
              </option>
            ))}
          </select>
          {mutation.isSuccess ? (
            <span role="status" className="text-sm text-muted-foreground">
              保存しました
            </span>
          ) : null}
        </div>
        {isError || mutation.isError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {mutation.isError
              ? "週の始まりを保存できませんでした"
              : "週の始まりを読み込めませんでした"}
          </p>
        ) : null}
        <p className="text-sm text-muted-foreground">
          変更は、まだノートのない週から反映されます。書いたノートは、書いたときの7日間のまま残ります。
        </p>
      </CardContent>
    </Card>
  );
}
