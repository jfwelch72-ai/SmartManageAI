import { type ZodSchema, type ZodError, type ZodTypeAny, z } from "zod";
import type { Response } from "express";

/**
 * Wraps a Zod schema parse so a malformed payload returns a clean JSON 400
 * with the validation details instead of bubbling out of the async route
 * handler as an unhandled promise rejection (which leaves the request hanging
 * on the client until it times out).
 *
 * Returns the parsed value on success, or `null` after sending the 400
 * response so the caller can early-exit. The shape of `details` matches
 * `ZodError.flatten()` so consumers can surface per-field messages.
 *
 * Originally introduced in `server/libraryRoutes.ts` for Task #2165 and
 * promoted here for Task #2179 so all route modules can share it.
 */
export function parseOrRespond<T extends ZodTypeAny>(
  schema: T,
  payload: unknown,
  res: Response,
): z.infer<T> | null {
  const result = schema.safeParse(payload);
  if (!result.success) {
    res.status(400).json({
      error: "Invalid request body",
      details: result.error.flatten(),
    });
    return null;
  }
  return result.data;
}

export function formatZodError(error: ZodError): { error: string; details: Record<string, string[]> } {
  const fieldErrors = error.flatten().fieldErrors;
  const details: Record<string, string[]> = {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    if (messages) {
      details[key] = messages;
    }
  }
  return {
    error: "Validation failed",
    details,
  };
}

export function sendValidationError(res: Response, error: ZodError): void {
  res.status(400).json(formatZodError(error));
}

export function validateBody<T>(schema: ZodSchema<T>, body: unknown, res: Response): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    res.status(400).json({
      error: "Validation failed",
      details: result.error.flatten().fieldErrors,
    });
    return null;
  }
  return result.data;
}

export function validateMonetaryAmount(
  amount: string | number | null | undefined,
  fieldName: string
): { valid: boolean; error?: string } {
  if (amount === null || amount === undefined) {
    return { valid: true };
  }
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(numAmount)) {
    return { valid: false, error: `${fieldName} must be a valid number` };
  }
  if (numAmount <= 0) {
    return { valid: false, error: `${fieldName} must be a positive value (greater than zero)` };
  }
  if (numAmount > 100000000) {
    return { valid: false, error: `${fieldName} exceeds maximum allowed value ($100,000,000)` };
  }
  return { valid: true };
}

export function validateOptionalString(
  value: unknown,
  fieldName: string,
  maxLength = 1000
): { valid: boolean; error?: string; sanitized?: string | null } {
  if (value === null || value === undefined || value === "") {
    return { valid: true, sanitized: null };
  }
  if (typeof value !== "string") {
    return { valid: false, error: `${fieldName} must be a string` };
  }
  if (value.length > maxLength) {
    return { valid: false, error: `${fieldName} exceeds maximum length of ${maxLength} characters` };
  }
  return { valid: true, sanitized: value.trim() };
}
