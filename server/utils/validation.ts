import type { ZodError } from "zod";
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
