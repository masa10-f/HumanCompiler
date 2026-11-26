// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

'use client'

import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

/** A session's reflection: what to keep, what was a problem, what to try. */
export interface KptValues {
  keep: string
  problem: string
  try: string
}

export const EMPTY_KPT: KptValues = { keep: '', problem: '', try: '' }

const FIELDS = [
  { key: 'keep', label: 'Keep: うまくいったこと', placeholder: '良かった点を記録' },
  { key: 'problem', label: 'Problem: 困ったこと', placeholder: '課題や問題点を記録' },
  { key: 'try', label: 'Try: 次に試したいこと', placeholder: '次回への改善点を記録' },
] as const

/**
 * The three reflection fields, as the checkout asks them and as a finished
 * session's reflection is edited.
 */
export function KptFields({
  idPrefix,
  value,
  onChange,
}: {
  /** Keeps the field ids apart when two dialogs with these fields are mounted. */
  idPrefix: string
  value: KptValues
  onChange: (value: KptValues) => void
}) {
  return (
    <>
      {FIELDS.map((field) => (
        <div key={field.key} className="space-y-2">
          <Label htmlFor={`${idPrefix}-${field.key}`} className="text-xs">
            {field.label}
          </Label>
          <Textarea
            id={`${idPrefix}-${field.key}`}
            placeholder={field.placeholder}
            value={value[field.key]}
            onChange={(event) => onChange({ ...value, [field.key]: event.target.value })}
            rows={2}
            maxLength={500}
          />
        </div>
      ))}
    </>
  )
}
