/**
 * Utility functions for handling decimal numbers with precision
 */

/**
 * Round a number to a specified number of decimal places
 * Uses a more reliable method than Math.round(value * 100) / 100
 * @param value The number to round
 * @param decimals Number of decimal places (default: 2)
 * @returns The rounded number
 */
export function roundToDecimals(value: number, decimals: number = 2): number {
  if (isNaN(value)) return 0;

  // Use toFixed and parseFloat to avoid floating point precision issues
  return parseFloat(value.toFixed(decimals));
}

/**
 * Format a number for display with fixed decimal places
 * @param value The number to format
 * @param decimals Number of decimal places (default: 2)
 * @returns The formatted string
 */
export function formatDecimal(value: number, decimals: number = 2): string {
  if (isNaN(value)) return '0.00';

  return value.toFixed(decimals);
}

/**
 * Parse a string to a float with validation
 * @param value The string to parse
 * @param defaultValue Default value if parsing fails
 * @returns The parsed number
 */
export function parseFloatSafe(value: string, defaultValue: number = 0): number {
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Convert hours to minutes with proper rounding
 * @param hours Number of hours
 * @returns Number of minutes
 */
export function hoursToMinutes(hours: number): number {
  return Math.round(hours * 60);
}

/**
 * Convert minutes to hours with proper precision
 * @param minutes Number of minutes
 * @param decimals Number of decimal places for hours (default: 2)
 * @returns Number of hours
 */
export function minutesToHours(minutes: number, decimals: number = 2): number {
  return roundToDecimals(minutes / 60, decimals);
}
