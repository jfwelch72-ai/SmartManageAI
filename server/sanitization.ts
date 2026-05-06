import { logWarn } from "./utils/logger";

/**
 * Input Sanitization Utilities
 * 
 * Provides defense-in-depth text sanitization to ensure data integrity
 * and prevent malformed data from entering the database.
 * 
 * Note: React's JSX auto-escapes content, preventing XSS. These utilities
 * focus on data quality and normalization.
 */

/**
 * Sanitize a text field by:
 * 1. Trimming whitespace
 * 2. Removing null bytes
 * 3. Normalizing line breaks to \n
 * 4. Limiting length
 * 
 * @param value - The text to sanitize
 * @param maxLength - Maximum allowed length (default: 10000)
 * @returns Sanitized text or undefined if input was null/undefined
 */
export function sanitizeText(value: string | null | undefined, maxLength: number = 10000): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  // Convert to string and trim
  let sanitized = String(value).trim();

  // Remove null bytes (security)
  sanitized = sanitized.replace(/\0/g, '');

  // Normalize line breaks (CRLF -> LF)
  sanitized = sanitized.replace(/\r\n/g, '\n');

  // Remove excessive whitespace (multiple spaces/tabs)
  sanitized = sanitized.replace(/[ \t]+/g, ' ');

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Return undefined for empty strings (after trimming)
  return sanitized === '' ? undefined : sanitized;
}

/**
 * Sanitize a short text field (names, titles, codes)
 * More restrictive than sanitizeText - removes line breaks
 * 
 * @param value - The text to sanitize
 * @param maxLength - Maximum allowed length (default: 255)
 * @returns Sanitized text or undefined if input was null/undefined
 */
export function sanitizeShortText(value: string | null | undefined, maxLength: number = 255): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  // Convert to string and trim
  let sanitized = String(value).trim();

  // Remove null bytes
  sanitized = sanitized.replace(/\0/g, '');

  // Remove ALL line breaks (single line only)
  sanitized = sanitized.replace(/[\r\n]/g, ' ');

  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Limit length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength);
  }

  // Return undefined for empty strings
  return sanitized === '' ? undefined : sanitized;
}

/**
 * Sanitize an email address
 * Converts to lowercase and validates basic format
 * 
 * @param email - The email to sanitize
 * @returns Sanitized email or undefined if invalid
 */
export function sanitizeEmail(email: string | null | undefined): string | undefined {
  if (email === null || email === undefined) {
    return undefined;
  }

  // Convert to lowercase and trim
  const sanitized = String(email).toLowerCase().trim();

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sanitized)) {
    return undefined;
  }

  // Limit length
  if (sanitized.length > 255) {
    return undefined;
  }

  return sanitized;
}

/**
 * Sanitize a phone number
 * Removes all non-numeric characters except + (for international)
 * 
 * @param phone - The phone number to sanitize
 * @returns Sanitized phone or undefined if invalid
 */
export function sanitizePhone(phone: string | null | undefined): string | undefined {
  if (phone === null || phone === undefined) {
    return undefined;
  }

  // Remove all characters except digits, +, -, (, ), and spaces
  let sanitized = String(phone).trim().replace(/[^\d+\-() ]/g, '');

  // Remove excessive whitespace
  sanitized = sanitized.replace(/\s+/g, ' ');

  // Return undefined if too short or too long
  const digitsOnly = sanitized.replace(/\D/g, '');
  if (digitsOnly.length < 10 || digitsOnly.length > 15) {
    return undefined;
  }

  return sanitized;
}

/**
 * Sanitize a URL
 * Validates URL format and ensures it starts with http/https
 * 
 * @param url - The URL to sanitize
 * @returns Sanitized URL or undefined if invalid
 */
export function sanitizeUrl(url: string | null | undefined): string | undefined {
  if (url === null || url === undefined) {
    return undefined;
  }

  const sanitized = String(url).trim();

  // Check if it's a valid URL
  try {
    const urlObj = new URL(sanitized);
    
    // Only allow http and https protocols
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return undefined;
    }

    return urlObj.toString();
  } catch {
    logWarn("Non-critical operation failed");
    return undefined;
  }
}
