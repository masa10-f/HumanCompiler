/**
 * Date utilities for handling JST (Japan Standard Time) operations
 * 
 * This module provides utilities to handle timezone-related issues in HumanCompiler,
 * ensuring that dates and times are correctly managed for Japanese users.
 */

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
  
  // Create a new date object adjusted to JST (UTC+9)
  const jstOffset = 9 * 60 * 60 * 1000 // 9 hours in milliseconds
  const jstTime = new Date(now.getTime() + jstOffset)
  
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
  // Create date in JST timezone to avoid UTC conversion issues
  const parts = dateString.split('-').map(Number)
  
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid date string format: ${dateString}. Expected YYYY-MM-DD format.`)
  }
  
  const [year, month, day] = parts as [number, number, number]
  
  // Create date at midnight JST
  const jstDate = new Date()
  jstDate.setFullYear(year, month - 1, day)
  jstDate.setHours(0, 0, 0, 0)
  
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
  const jstOffset = 9 * 60 * 60 * 1000 // 9 hours in milliseconds
  const jstTime = new Date(now.getTime() + jstOffset)
  
  // Return as ISO string but replace Z with +09:00 to indicate JST
  return jstTime.toISOString().replace('Z', '+09:00')
}