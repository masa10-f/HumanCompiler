// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import { goalDueDateSchema } from '@/lib/validations/goal'

describe('goalDueDateSchema', () => {
  it.each([undefined, '', '2026-09-30'])('accepts %p', (value) => {
    expect(goalDueDateSchema.safeParse(value).success).toBe(true)
  })

  it.each(['2026-9-30', '2025-02-29', 'not-a-date'])(
    'rejects invalid date input %p with a field-level error',
    (value) => {
      const result = goalDueDateSchema.safeParse(value)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.issues[0].message).toBe(
          '有効なYYYY-MM-DD形式で入力してください',
        )
      }
    },
  )
})
