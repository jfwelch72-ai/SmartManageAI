import { type ZodSchema, type ZodError, z } from "zod";
import type { Response } from "express";

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
