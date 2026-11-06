// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { parseISO } from 'date-fns'

/** Clamp a percentage to the range used by timeline progress UI. */
export function clampPercentage(value: number): number {
  const normalized = Number.isFinite(value) ? value : 0
  return Math.min(100, Math.max(0, normalized))
}

/** Format timeline effort consistently, preserving one decimal when needed. */
export function formatHours(value: number): string {
  const rounded = Math.round(value * 10) / 10
  return Number.isInteger(rounded) ? `${rounded}h` : `${rounded.toFixed(1)}h`
}

/** Parse an ISO date string, returning null for empty or invalid values. */
export function parseOptionalDate(dateString: string | null | undefined): Date | null {
  if (!dateString) return null
  try {
    const date = parseISO(dateString)
    return Number.isNaN(date.getTime()) ? null : date
  } catch {
    return null
  }
}
