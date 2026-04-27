import type { Response } from "express";

const MAX_JSON_PARSE_SIZE = 10 * 1024 * 1024; // 10MB

export function successResponse(res: Response, data?: Record<string, any>) {
  const { success: _ignored, ...rest } = data || {};
  res.json({ success: true, ...rest });
}

export function errorResponse(res: Response, status: number, message: string) {
  res.status(status).json({ success: false, error: message });
}

// Overloads:
//   1) No fallback           → T | null
//   2) Explicit `null` fallback → T | null
//   3) Non-null fallback     → T   (so callers don't need a trailing `?? []`)
export function safeJsonParse<T = any>(raw: string | null | undefined): T | null;
export function safeJsonParse<T = any>(raw: string | null | undefined, fallback: null): T | null;
export function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T;
export function safeJsonParse<T = any>(
  raw: string | null | undefined,
  fallback: T | null = null
): T | null {
  if (!raw) return fallback;
  if (raw.length > MAX_JSON_PARSE_SIZE) {
    console.warn(`JSON payload too large (${raw.length} bytes), skipping parse`);
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
