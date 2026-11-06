// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import Link from 'next/link'
import { AlertTriangle, Clock3, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProjectCapacity } from '@/types/timeline'

/** Weekly hours used until the project gets an effort ratio in the settings. */
export const DEFAULT_FALLBACK_WEEKLY_HOURS = 20
export const TRIAGE_SETTINGS_HREF = '/settings#triage-settings'

function formatCapacityHours(hours: number): string {
  return `${Math.round(hours * 10) / 10}`
}

/**
 * The weekly hours the roadmap plans with: the project's share of the weekly
 * capacity set in the capacity triage settings. Without an effort ratio there
 * is no share to plan with, so a temporary value can be entered instead.
 */
export function resolveWeeklyWorkHours(
  capacity: ProjectCapacity | undefined,
  fallbackHours: number,
): number {
  if (capacity && capacity.weekly_work_hours > 0) return capacity.weekly_work_hours
  return fallbackHours
}

export function TimelineCapacityBadge({
  capacity,
  fallbackHours,
  onFallbackHoursChange,
}: {
  capacity: ProjectCapacity | undefined
  fallbackHours: number
  onFallbackHoursChange: (hours: number) => void
}) {
  const fromSettings = Boolean(capacity && capacity.weekly_work_hours > 0)

  // The capacity is unknown until the timeline has loaded.
  if (!capacity) return null

  return (
    <div className="flex w-full flex-col gap-2 sm:w-auto sm:items-end">
      <div className="flex w-fit items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-300">
          <Clock3 className="h-4 w-4" />
        </div>
        <div>
          {fromSettings ? (
            <>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                週間キャパシティ
              </p>
              <p className="mt-0.5 text-sm font-semibold text-slate-950 dark:text-white">
                {formatCapacityHours(capacity.weekly_work_hours)}
                <span className="ml-1 text-xs font-normal text-slate-500">時間 / 週</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                稼働 {formatCapacityHours(capacity.effective_capacity_hours)}h × エフォート{' '}
                {capacity.effort_percent}%
              </p>
            </>
          ) : (
            <>
              <Label
                htmlFor="weekly-work-hours"
                className="block text-[10px] font-bold uppercase tracking-wider text-slate-500"
              >
                週間キャパシティ（仮）
              </Label>
              <div className="mt-0.5 flex items-center gap-1.5">
                <Input
                  id="weekly-work-hours"
                  type="number"
                  min="1"
                  max="168"
                  value={fallbackHours}
                  onChange={(e) =>
                    onFallbackHoursChange(
                      Math.min(168, Math.max(1, Number(e.target.value) || 1)),
                    )
                  }
                  className="h-7 w-16 border-0 bg-transparent p-0 text-right text-sm font-semibold shadow-none focus-visible:ring-0"
                />
                <span className="text-xs text-slate-500">時間 / 週</span>
              </div>
            </>
          )}
        </div>
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="ml-1 h-8 gap-1 rounded-lg px-2 text-xs text-slate-600 dark:text-slate-300"
        >
          <Link href={TRIAGE_SETTINGS_HREF} aria-label="キャパ配分の設定を開く">
            <Settings2 className="h-3.5 w-3.5" />
            設定
          </Link>
        </Button>
      </div>
      {!fromSettings && (
        <p
          role="status"
          className="flex max-w-md items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {capacity.effort_percent > 0
              ? '週の稼働時間がバッファ以下のため、'
              : 'このプロジェクトのエフォート比が未設定のため、'}
            仮の週間時間で完了見込みを計算しています。
            <Link href={TRIAGE_SETTINGS_HREF} className="underline underline-offset-2">
              設定のキャパ配分
            </Link>
            で週の稼働時間とエフォート比を設定してください。
          </span>
        </p>
      )}
    </div>
  )
}
