// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** The largest remaining estimate the API takes (a task's estimate is NUMERIC(5,2)). */
export const MAX_REMAINING_HOURS = 999.99

export const REMAINING_HOURS_TOO_SMALL = '残り時間は0以上で入力してください'
export const REMAINING_HOURS_TOO_LARGE = `残り時間は${MAX_REMAINING_HOURS}時間以内で入力してください`

/** Why a remaining estimate cannot be sent, or undefined when it can (empty included). */
export function remainingHoursError(value: number | undefined): string | undefined {
  if (value === undefined) return undefined
  if (value < 0) return REMAINING_HOURS_TOO_SMALL
  if (value > MAX_REMAINING_HOURS) return REMAINING_HOURS_TOO_LARGE
  return undefined
}

interface RemainingEstimateFieldProps {
  id: string
  /** Hours left on the task after this record; undefined while the field is empty. */
  value: number | undefined
  onChange: (value: number | undefined) => void
  /** The task's estimate now, shown beside the field when known. */
  currentEstimateHours?: number | null
  /** A task being completed has nothing left to estimate. */
  disabled?: boolean
  error?: string
}

/**
 * What is left on a task after a piece of work. The Runner's checkout and a
 * time record entered by hand ask it the same way: the task's estimate becomes
 * the time logged so far plus this.
 */
export function RemainingEstimateField({
  id,
  value,
  onChange,
  currentEstimateHours,
  disabled = false,
  error,
}: RemainingEstimateFieldProps) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>残りの見込み（時間・任意）</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={id}
          type="number"
          step="0.1"
          min="0"
          max={MAX_REMAINING_HOURS}
          className="w-32"
          placeholder="例: 1.5"
          value={value ?? ''}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-help`}
          onChange={(event) => {
            const parsed = parseFloat(event.target.value)
            onChange(event.target.value === '' || Number.isNaN(parsed) ? undefined : parsed)
          }}
        />
        {currentEstimateHours != null && (
          <span className="text-xs text-muted-foreground">
            現在の見積: {currentEstimateHours}h
          </span>
        )}
      </div>
      <p id={`${id}-help`} className="text-xs text-muted-foreground">
        入力すると、タスクの見積を「これまでの実績＋残り」に更新します。
      </p>
      {error && <p className="text-sm font-medium text-destructive">{error}</p>}
    </div>
  )
}
