/**
 * Date utilities for handling JST (Japan Standard Time) operations
 *
 * This module provides utilities to handle timezone-related issues in HumanCompiler,
 * ensuring that dates and times are correctly managed for Japanese users.
 */

// JST offset constant for performance optimization
const JST_OFFSET_MS = 9 * 60 * 60 * 1000 // 9 hours in milliseconds

/**
 * Get the current date in JST as YYYY-MM-DD string format
 *
 * This function ensures that the "today" date is always based on Japan Standard Time,
 * regardless of the system's local timezone or UTC conversion issues.
 *
 * @returns Date string in YYYY-MM-DD format based on JST
 *
 * @example
 * // JST: 2025-08-27 08:00 (UTC: 2025-08-26 23:00)
 * getJSTDateString() // "2025-08-27" (correct JST date)
 *
 * // Compare with problematic approach:
 * new Date().toISOString().split('T')[0] // "2025-08-26" (wrong, based on UTC)
 */
export function getJSTDateString(): string {
  const now = new Date()

  // Validate current date
  if (isNaN(now.getTime())) {
    throw new Error('Invalid current date')
  }

  // Create a new date object adjusted to JST (UTC+9)
  const jstTime = new Date(now.getTime() + JST_OFFSET_MS)

  // Extract date components
  const year = jstTime.getUTCFullYear()
  const month = String(jstTime.getUTCMonth() + 1).padStart(2, '0')
  const day = String(jstTime.getUTCDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

/**
 * Format a UTC datetime string to JST display format
 *
 * @param utcDateString - UTC datetime string (ISO 8601 format)
 * @param options - Intl.DateTimeFormatOptions for formatting
 * @returns Formatted datetime string in JST
 *
 * @example
 * formatJSTDateTime("2025-08-27T05:30:00Z")
 * // "2025/8/27 14:30" (JST display)
 */
export function formatJSTDateTime(
  utcDateString: string,
  options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo'
  }
): string {
  const date = new Date(utcDateString)

  // Validate parsed date
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${utcDateString}`)
  }

  return date.toLocaleString('ja-JP', options)
}

/**
 * Parse UTC datetime string and return Date object adjusted for JST operations
 *
 * @param utcDateString - UTC datetime string
 * @returns Date object for JST operations
 */
export function parseUTCToJST(utcDateString: string): Date {
  const utcDate = new Date(utcDateString)

  // Ensure the date is properly parsed as UTC
  if (isNaN(utcDate.getTime())) {
    throw new Error(`Invalid date string: ${utcDateString}`)
  }

  return utcDate
}

/**
 * Get JST date for a specific date string (YYYY-MM-DD)
 *
 * @param dateString - Date string in YYYY-MM-DD format
 * @returns Date object representing the start of day in JST
 */
export function getJSTDate(dateString: string): Date {
  // Validate input format
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(dateString)) {
    throw new Error(`Invalid date string format: ${dateString}. Expected YYYY-MM-DD format.`)
  }

  const parts = dateString.split('-').map(Number)

  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid date string format: ${dateString}. Expected YYYY-MM-DD format.`)
  }

  const [year, month, day] = parts as [number, number, number]

  // Validate date values
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) {
    throw new Error(`Invalid date values: ${dateString}`)
  }

  // Create date in JST timezone using ISO string to ensure JST interpretation
  // This avoids local timezone dependency issues
  const paddedMonth = String(month).padStart(2, '0')
  const paddedDay = String(day).padStart(2, '0')
  const jstISOString = `${year}-${paddedMonth}-${paddedDay}T00:00:00+09:00`

  const jstDate = new Date(jstISOString)

  // Final validation
  if (isNaN(jstDate.getTime())) {
    throw new Error(`Failed to create valid JST date from: ${dateString}`)
  }

  return jstDate
}

/**
 * Format a date for display in Japanese format
 *
 * @param date - Date object or date string
 * @param includeTime - Whether to include time in the format
 * @returns Formatted date string in Japanese locale
 */
export function formatJapaneseDate(
  date: Date | string,
  includeTime: boolean = false
): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date

  // Validate date object
  if (isNaN(dateObj.getTime())) {
    throw new Error(`Invalid date: ${date}`)
  }

  const options: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone: 'Asia/Tokyo'
  }

  if (includeTime) {
    options.hour = '2-digit'
    options.minute = '2-digit'
  }

  return dateObj.toLocaleString('ja-JP', options)
}

/**
 * Get the current JST time as ISO string
 * Useful for timestamps that need to be JST-based
 *
 * @returns ISO string representing current JST time
 */
export function getJSTISOString(): string {
  const now = new Date()

  // Validate current date
  if (isNaN(now.getTime())) {
    throw new Error('Invalid current date')
  }

  const jstTime = new Date(now.getTime() + JST_OFFSET_MS)

  // Validate JST time calculation
  if (isNaN(jstTime.getTime())) {
    throw new Error('Failed to calculate JST time')
  }

  // Return as ISO string but replace Z with +09:00 to indicate JST
  return jstTime.toISOString().replace('Z', '+09:00')
}
