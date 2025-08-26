/**
 * Security utilities for safe text rendering
 */

/**
 * Escapes HTML characters to prevent XSS attacks
 * @param text - The text to escape
 * @returns HTML-escaped text safe for rendering
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Sanitizes text content for safe display
 * - Escapes HTML characters
 * - Preserves whitespace formatting
 * @param text - The text to sanitize
 * @returns Sanitized text safe for rendering
 */
export function sanitizeText(text: string | null | undefined): string {
  if (!text) return '';
  return escapeHtml(text);
}
