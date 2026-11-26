// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"use client"

import * as React from "react"

import { Input, type InputProps } from "@/components/ui/input"

export interface NumberInputProps
  extends Omit<InputProps, "type" | "value" | "defaultValue" | "onChange"> {
  value: number | null | undefined
  /**
   * Called with the parsed number while the user types, or with `undefined`
   * when the field is cleared and `allowEmpty` is set.
   */
  onValueChange: (value: number | undefined) => void
  /**
   * Treat an empty field as a real value (`undefined`). Without it the field
   * may still be empty while editing, but it goes back to the last value when
   * focus leaves it.
   */
  allowEmpty?: boolean
  /** Parse whole numbers only. */
  integer?: boolean
  /** Pull the value into `min`/`max` when focus leaves the field. */
  clampOnBlur?: boolean
}

function parseDraft(draft: string, integer: boolean): number | undefined {
  const trimmed = draft.trim()
  if (trimmed === "") return undefined
  // Parse the whole value (so "1e2" is 100), then drop any fraction for integers.
  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined
  return integer ? Math.trunc(parsed) : parsed
}

function formatValue(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : String(value)
}

function toBound(bound: InputProps["min"]): number | undefined {
  if (bound === undefined || bound === "") return undefined
  const parsed = Number(bound)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * A number field that keeps what the user typed, so it can be cleared before a
 * new value is entered instead of snapping to a fallback such as 0 or 1.
 */
const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    { value, onValueChange, allowEmpty = false, integer = false, clampOnBlur = false, onBlur, min, max, ...props },
    ref,
  ) => {
    const [draft, setDraft] = React.useState(() => formatValue(value))
    const draftRef = React.useRef(draft)
    draftRef.current = draft

    // Follow values set from outside (presets, form resets, parent clamping)
    // without overwriting what the user is typing when it already matches.
    React.useEffect(() => {
      if (parseDraft(draftRef.current, integer) !== (value ?? undefined)) {
        setDraft(formatValue(value))
      }
    }, [value, integer])

    const handleChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      setDraft(next)
      const parsed = parseDraft(next, integer)
      if (parsed !== undefined) {
        onValueChange(parsed)
      } else if (allowEmpty && next.trim() === "") {
        onValueChange(undefined)
      }
    }

    const handleBlur = (event: React.FocusEvent<HTMLInputElement>) => {
      const parsed = parseDraft(draft, integer)
      if (parsed === undefined) {
        if (!(allowEmpty && draft.trim() === "")) setDraft(formatValue(value))
      } else {
        let next = parsed
        if (clampOnBlur) {
          const lower = toBound(min)
          const upper = toBound(max)
          if (lower !== undefined) next = Math.max(lower, next)
          if (upper !== undefined) next = Math.min(upper, next)
        }
        if (next !== parsed) onValueChange(next)
        // Show what was kept: the clamped number, or the parent's value when it
        // transformed the input (e.g. 0 meaning "none", or a fraction dropped).
        const kept = next !== parsed ? next : (value ?? undefined)
        if (Number(draft.trim()) !== kept) setDraft(formatValue(kept))
      }
      onBlur?.(event)
    }

    return (
      <Input
        {...props}
        ref={ref}
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={handleChange}
        onBlur={handleBlur}
      />
    )
  },
)
NumberInput.displayName = "NumberInput"

export { NumberInput }
