/**
 * Task #1812 — friendly error helpers for drawing-set pin failures.
 *
 * The backend (`server/drawingSetRoutes.ts`) rejects duplicate pins to a
 * drawing set with HTTP 409 and `{ error: "Sheet already in this drawing
 * set" }`. The default `apiRequest` wrapper in `client/src/lib/queryClient.ts`
 * attaches the parsed body and HTTP status to the thrown `Error`, so we can
 * identify the duplicate-pin case structurally instead of substring-matching
 * the message.
 *
 * Both helpers fall back to a generic message for any non-409 failure so
 * unrelated 4xx/5xx errors keep their existing wording.
 */

interface ApiErrorLike {
  status?: number;
  message?: string;
}

export function isDuplicatePinError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as ApiErrorLike;
  if (e.status === 409) return true;
  if (typeof e.message === "string" && /\b409\b/.test(e.message)) return true;
  return false;
}

export function pinSheetErrorDescription(
  err: unknown,
  opts: { sheetName?: string | null; setName?: string | null },
): string {
  if (isDuplicatePinError(err)) {
    const sheet = opts.sheetName?.trim();
    const set = opts.setName?.trim();
    const setRef = set ? `"${set}"` : "this set";
    if (sheet) return `"${sheet}" is already pinned to ${setRef}.`;
    return `This sheet is already pinned to ${setRef}.`;
  }
  return "Failed to pin sheet.";
}

export function bulkPinErrorDescription(
  err: unknown,
  opts: { setName?: string | null },
): string {
  if (isDuplicatePinError(err)) {
    const set = opts.setName?.trim();
    const setRef = set ? `"${set}"` : "this set";
    return `One or more selected sheets are already pinned to ${setRef}.`;
  }
  return "Failed to update pinned sheets.";
}
