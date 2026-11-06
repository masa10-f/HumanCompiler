import { clampPercentage, formatHours, parseOptionalDate } from '../utils'

describe('Timeline Utils', () => {
  describe('parseOptionalDate', () => {
    it('returns null for empty input', () => {
      expect(parseOptionalDate(null)).toBeNull()
      expect(parseOptionalDate(undefined)).toBeNull()
      expect(parseOptionalDate('')).toBeNull()
    })

    it('parses a valid ISO string', () => {
      expect(parseOptionalDate('2024-08-19T12:00:00Z')?.toISOString()).toBe(
        '2024-08-19T12:00:00.000Z',
      )
    })

    it('returns null for an invalid string', () => {
      expect(parseOptionalDate('invalid-date')).toBeNull()
    })
  })

  describe('clampPercentage', () => {
    it('keeps values within 0-100', () => {
      expect(clampPercentage(-5)).toBe(0)
      expect(clampPercentage(42)).toBe(42)
      expect(clampPercentage(130)).toBe(100)
      expect(clampPercentage(Number.NaN)).toBe(0)
    })
  })

  describe('formatHours', () => {
    it('drops trailing decimals for whole hours', () => {
      expect(formatHours(8)).toBe('8h')
      expect(formatHours(2.25)).toBe('2.3h')
      expect(formatHours(0.04)).toBe('0h')
    })
  })
})
