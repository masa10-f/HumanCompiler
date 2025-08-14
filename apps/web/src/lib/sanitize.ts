/**
 * Security utilities for sanitizing user input
 */

/**
 * Sanitize user input to prevent XSS attacks
 * Removes potentially dangerous HTML tags and scripts
 */
export function sanitizeInput(input: string): string {
  if (!input) return '';

  // Remove script tags and their content
  let sanitized = input.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers (onclick, onerror, etc.)
  sanitized = sanitized.replace(/on\w+\s*=\s*["'][^"']*["']/gi, '');
  sanitized = sanitized.replace(/on\w+\s*=\s*[^\s>]*/gi, '');

  // Remove javascript: protocol
  sanitized = sanitized.replace(/javascript:/gi, '');

  // Remove data: protocol for potentially dangerous content
  sanitized = sanitized.replace(/data:text\/html/gi, '');

  // Remove iframe tags
  sanitized = sanitized.replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '');

  // Remove object and embed tags
  sanitized = sanitized.replace(/<(object|embed)\b[^<]*(?:(?!<\/(object|embed)>)<[^<]*)*<\/(object|embed)>/gi, '');

  // Trim whitespace
  return sanitized.trim();
}

/**
 * Validate that input doesn't contain potentially dangerous content
 * Returns true if input is safe, false otherwise
 */
export function isInputSafe(input: string): boolean {
  if (!input) return true;

  // Check for script tags
  if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(input)) {
    return false;
  }

  // Check for event handlers
  if (/on\w+\s*=\s*["'][^"']*["']/gi.test(input) || /on\w+\s*=\s*[^\s>]*/gi.test(input)) {
    return false;
  }

  // Check for javascript: protocol
  if (/javascript:/gi.test(input)) {
    return false;
  }

  // Check for dangerous data: protocols
  if (/data:text\/html/gi.test(input)) {
    return false;
  }

  // Check for iframe, object, or embed tags
  if (/<(iframe|object|embed)\b/gi.test(input)) {
    return false;
  }

  return true;
}

/**
 * Escape HTML special characters to prevent XSS when displaying user content
 */
export function escapeHtml(text: string): string {
  if (!text) return '';

  const htmlEscapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#x27;',
    '/': '&#x2F;',
  };

  return text.replace(/[&<>"'/]/g, (char) => htmlEscapeMap[char] || char);
}
