import * as z from 'zod'

import { isValidJSTDateInput } from '@/lib/date-utils'

export const goalDueDateSchema = z
  .string()
  .optional()
  .refine(
    (value) => !value || isValidJSTDateInput(value),
    '有効なYYYY-MM-DD形式で入力してください',
  )
