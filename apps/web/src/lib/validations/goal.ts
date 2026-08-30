// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2024-2025 Masato Fukushima <masa1063fuk@gmail.com>
//
// This file is part of HumanCompiler.
// For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

import * as z from 'zod'

import { isValidJSTDateInput } from '@/lib/date-utils'

export const goalDueDateSchema = z
  .string()
  .optional()
  .refine(
    (value) => !value || isValidJSTDateInput(value),
    '有効なYYYY-MM-DD形式で入力してください',
  )
