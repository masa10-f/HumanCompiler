// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import { useQuery } from "@tanstack/react-query";
import { Images } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { notesApi } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

const MB = 1024 * 1024;

/** Megabytes with one decimal below 10 MB, so a few images do not read as 0. */
function megabytes(bytes: number): string {
  const value = bytes / MB;
  return value < 10 ? value.toFixed(1) : Math.round(value).toString();
}

/** Settings card: how much of the storage for images in notes is in use. */
export function NoteImageUsageCard() {
  const { data, isError } = useQuery({
    queryKey: queryKeys.noteAttachments.usage(),
    queryFn: () => notesApi.getAttachmentUsage(),
  });
  const percent = data
    ? Math.min(100, Math.round((data.used_bytes / Math.max(data.limit_bytes, 1)) * 100))
    : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Images className="h-5 w-5" />
          ノートの画像
        </CardTitle>
        <CardDescription>
          ノートに添付した画像の保存量です。画像は縮小したプレビューとして保存され、原本は保存されません。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {data ? (
          <>
            <Progress value={percent} aria-label="画像の保存量" />
            <p className="text-sm">
              {megabytes(data.used_bytes)} MB / {megabytes(data.limit_bytes)} MB（{data.count}
              枚）
            </p>
          </>
        ) : isError ? (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            保存量を読み込めませんでした
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">読み込み中…</p>
        )}
        <p className="text-sm text-muted-foreground">
          ノートから外した画像は、7日後に削除されて保存量から引かれます。
        </p>
      </CardContent>
    </Card>
  );
}
