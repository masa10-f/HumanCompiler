// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Loader2, NotebookPen } from "lucide-react";
import { dailyPlansApi } from "@/lib/api";
import { getJSTDateString } from "@/lib/date-utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type {
  DailyPlanHistoryQuery,
  DailyPlanSummary,
} from "@/types/daily-plan";

export function DailyPlanHistory({
  selectedDate,
  revision,
  disabled,
  onSelect,
}: {
  selectedDate: string;
  revision: number;
  disabled: boolean;
  onSelect: (date: string) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filters, setFilters] = useState<DailyPlanHistoryQuery>({});
  const [items, setItems] = useState<DailyPlanSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [opening, setOpening] = useState<string | null>(null);
  const request = useRef(0);
  const invalidRange = Boolean(from && to && from > to);

  useEffect(() => {
    const id = ++request.current;
    setLoading(true);
    setItems([]);
    setCursor(null);
    setLoadingMore(false);
    setError("");
    dailyPlansApi
      .list({ ...filters, limit: 20 })
      .then((result) => {
        if (id !== request.current) return;
        setItems(result.items);
        setCursor(result.next_cursor);
      })
      .catch(() => {
        if (id === request.current)
          setError("ノートの履歴を取得できませんでした。");
      })
      .finally(() => {
        if (id === request.current) setLoading(false);
      });
    return () => {
      request.current += 1;
    };
  }, [filters, revision, selectedDate, retry]);

  const more = async () => {
    if (!cursor || loadingMore) return;
    const id = request.current;
    setLoadingMore(true);
    setError("");
    try {
      const result = await dailyPlansApi.list({
        ...filters,
        before: cursor,
        limit: 20,
      });
      if (id !== request.current) return;
      setItems((current) => [...current, ...result.items]);
      setCursor(result.next_cursor);
    } catch {
      if (id === request.current)
        setError("続きの履歴を取得できませんでした。");
    } finally {
      if (id === request.current) setLoadingMore(false);
    }
  };
  const open = async (date: string) => {
    if (opening || disabled) return;
    setOpening(date);
    try {
      await onSelect(date);
    } finally {
      setOpening(null);
    }
  };

  return (
    <aside
      aria-label="日次ノートの履歴"
      className="space-y-4 rounded-xl border bg-card p-4 lg:sticky lg:top-20"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <NotebookPen className="h-4 w-4" />
          ノートの履歴
        </h2>
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || Boolean(opening)}
          onClick={() => void open(getJSTDateString())}
        >
          今日へ
        </Button>
      </div>
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (!invalidRange)
            setFilters({ query: query.trim(), date_from: from, date_to: to });
        }}
      >
        <label className="block space-y-1 text-xs">
          本文・タスク名
          <Input
            type="search"
            aria-label="ノートを検索"
            placeholder="メモやタスク名を検索"
            maxLength={200}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <details>
          <summary className="cursor-pointer text-xs text-muted-foreground">
            期間を絞り込む
            {filters.date_from || filters.date_to ? "（指定中）" : ""}
          </summary>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <label className="min-w-0 text-xs">
              開始日
              <Input
                aria-label="履歴の開始日"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                className="min-w-0 px-2"
              />
            </label>
            <label className="min-w-0 text-xs">
              終了日
              <Input
                aria-label="履歴の終了日"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                className="min-w-0 px-2"
              />
            </label>
          </div>
        </details>
        {invalidRange && (
          <p role="alert" className="text-xs text-destructive">
            開始日は終了日以前にしてください。
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={invalidRange}>
            <Search className="mr-1 h-3 w-3" />
            検索
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setQuery("");
              setFrom("");
              setTo("");
              setFilters({});
            }}
          >
            クリア
          </Button>
        </div>
      </form>
      <div aria-live="polite">
        {loading ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            履歴を読み込み中…
          </p>
        ) : (
          <>
            {error && (
              <div role="alert" className="text-sm text-destructive">
                <p>{error}</p>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setRetry((value) => value + 1)}
                >
                  履歴を再読み込み
                </Button>
              </div>
            )}
            {!error && !items.length && (
              <p className="text-sm text-muted-foreground">
                {filters.query || filters.date_from || filters.date_to
                  ? "条件に一致するノートはありません。"
                  : "保存したノートがここに並びます。"}
              </p>
            )}
            <ol className="max-h-64 space-y-1 overflow-y-auto lg:max-h-[calc(100vh-370px)]">
              {items.map((item) => (
                <li key={item.date}>
                  <button
                    type="button"
                    aria-current={
                      item.date === selectedDate ? "date" : undefined
                    }
                    disabled={disabled || Boolean(opening)}
                    onClick={() => void open(item.date)}
                    className={`w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60 ${item.date === selectedDate ? "border-primary/40 bg-primary/5" : "border-transparent"}`}
                  >
                    <span className="flex items-center justify-between font-medium">
                      <time dateTime={item.date}>{item.date}</time>
                      {opening === item.date && (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      )}
                    </span>
                    <span className="mt-1 block truncate">{item.title}</span>
                    <span className="mt-1 line-clamp-2 block whitespace-pre-wrap text-xs text-muted-foreground">
                      {item.preview}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {cursor && (
              <Button
                variant="ghost"
                className="mt-2 w-full"
                size="sm"
                disabled={loadingMore}
                onClick={() => void more()}
              >
                {loadingMore ? "読み込み中…" : "さらに過去のノート"}
              </Button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
