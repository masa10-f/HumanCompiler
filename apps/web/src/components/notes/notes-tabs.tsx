// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>

"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "daily", label: "日次ノート", href: "/notes" },
  { id: "weekly", label: "週次ノート", href: "/notes/weekly" },
] as const;

/** Switches between the daily note list and the weekly notes. */
export function NotesTabs({ current }: { current: (typeof TABS)[number]["id"] }) {
  return (
    <nav aria-label="ノートの種類" className="mb-6 flex gap-1 border-b">
      {TABS.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={tab.id === current ? "page" : undefined}
          className={cn(
            "-mb-px border-b-2 px-4 py-2 text-sm",
            tab.id === current
              ? "border-primary font-medium text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
