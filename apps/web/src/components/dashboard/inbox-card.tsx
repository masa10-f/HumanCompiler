// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useProposalSummary } from "@/hooks/use-proposals";
import { PROPOSAL_KIND_LABELS } from "@/types/proposal";

/** Pending agent proposals at a glance. A failed fetch leaves only the title and the link. */
export function InboxCard() {
  const { data, isLoading } = useProposalSummary();
  const isEmpty = data?.pending_count === 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            インボックス
            {data && data.pending_count > 0 && (
              <Badge variant="secondary">{data.pending_count}</Badge>
            )}
          </CardTitle>
          {!isEmpty && (
            <Link href="/inbox" className="text-sm text-primary hover:underline">
              すべて見る
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div
            data-testid="inbox-card-skeleton"
            className="h-5 w-2/3 animate-pulse rounded bg-muted"
          />
        )}
        {isEmpty && (
          <p className="text-sm text-muted-foreground">未処理の提案はありません</p>
        )}
        {data && data.pending_count > 0 && (
          <ul className="space-y-2">
            {data.latest.map((item) => (
              <li key={item.id}>
                <Link
                  href="/inbox"
                  className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted/50"
                >
                  <Badge variant="outline" className="shrink-0">
                    {PROPOSAL_KIND_LABELS[item.kind]}
                  </Badge>
                  <span className="min-w-0 break-words">{item.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
