/**
 * Shared pagination contract for list endpoints. See
 * `docs/api/pagination.md` for the full contract; in short:
 *
 *   GET /api/things?pageSize=200&cursor=<opaque>
 *   →  { items, nextCursor, total? }
 *      Link: <…?cursor=…>; rel="next"
 *
 * Cursor: base64url JSON `{ ts, id }`. Server orders `(ts DESC, id DESC)`.
 * Hard cap: `MAX_PAGE_SIZE = 200` (Zod `.max()` returns 400 pre-DB).
 */
import { z } from "zod";
import type { Response } from "express";
import { and, lt, or, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export interface PaginationCursor {
  ts: string;
  id: string;
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE, `pageSize cannot exceed ${MAX_PAGE_SIZE}`)
    .optional(),
  cursor: z.string().min(1).max(2048).optional(),
});

export type PaginationParams = z.infer<typeof paginationSchema>;

export function encodeCursor(c: PaginationCursor): string {
  const json = JSON.stringify(c);
  return Buffer.from(json, "utf8").toString("base64url");
}

export function decodeCursor(raw: string | undefined | null): PaginationCursor | null {
  if (!raw) return null;
  try {
    const json = Buffer.from(raw, "base64url").toString("utf8");
    const parsed = JSON.parse(json);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.ts === "string" &&
      typeof parsed.id === "string"
    ) {
      const dt = new Date(parsed.ts);
      if (!Number.isFinite(dt.getTime())) return null;
      return { ts: parsed.ts, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve a request's pagination intent into a normalized
 * `{ pageSize, cursor }` pair. Honors `cursor` when present,
 * otherwise treats `page`/`pageSize` as a 1-based offset
 * (legacy mode). Throws a `PaginationError` with status 400
 * when validation fails so callers can `try/catch` once.
 */
export class PaginationError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function parsePagination(query: unknown): {
  page: number;
  pageSize: number;
  cursor: PaginationCursor | null;
  rawCursor: string | null;
} {
  const parsed = paginationSchema.safeParse(query ?? {});
  if (!parsed.success) {
    throw new PaginationError(
      400,
      "Invalid pagination parameters",
      parsed.error.errors,
    );
  }
  const { page, pageSize, cursor: rawCursor } = parsed.data;
  const cursor = rawCursor ? decodeCursor(rawCursor) : null;
  if (rawCursor && !cursor) {
    throw new PaginationError(400, "Invalid cursor");
  }
  return {
    page: page ?? 1,
    pageSize: pageSize ?? DEFAULT_PAGE_SIZE,
    cursor,
    rawCursor: rawCursor ?? null,
  };
}

/**
 * Build the keyset WHERE clause for a `(ts DESC, id DESC)` ordering.
 * Returns `undefined` when no cursor is supplied so callers can chain
 * it into an existing `and(...)`.
 */
export function cursorWhere(
  tsColumn: PgColumn,
  idColumn: PgColumn,
  cursor: PaginationCursor | null,
): SQL | undefined {
  if (!cursor) return undefined;
  const ts = new Date(cursor.ts);
  return or(
    lt(tsColumn, ts),
    and(eq(tsColumn, ts), lt(idColumn, cursor.id)),
  ) as SQL;
}

/**
 * Attach a `Link: <next-url>; rel="next"` header so HATEOAS-aware
 * clients (and humans tailing curl) can discover the next page
 * without parsing the JSON body. Mirrors the body's `nextCursor`.
 *
 * `req.originalUrl` is the URL the client requested (including the
 * query string), so we replace just the cursor param so other filters
 * (status, search, etc.) survive the round-trip.
 */
export function setNextLinkHeader(
  res: Response,
  reqUrl: string,
  nextCursor: string | null,
) {
  if (!nextCursor) return;
  // `reqUrl` is path-relative; URL needs an origin to parse, so use a
  // placeholder we never serialize.
  const u = new URL(reqUrl, "http://placeholder.local");
  u.searchParams.set("cursor", nextCursor);
  // Strip page/offset when we hand out a cursor so the next request
  // doesn't end up using both.
  u.searchParams.delete("page");
  u.searchParams.delete("offset");
  const next = `${u.pathname}${u.search}`;
  res.setHeader("Link", `<${next}>; rel="next"`);
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/**
 * Wrap a fetched page of rows with the standard envelope. Callers
 * MUST fetch `pageSize + 1` rows from the database; `buildPage` then
 * trims the overflow row and uses its existence as the only signal
 * that another page exists. This avoids the off-by-one where an
 * exact-boundary last page would incorrectly emit a `nextCursor`.
 */
export function buildPage<T>(
  rows: T[],
  pageSize: number,
  getCursor: (row: T) => PaginationCursor,
  total?: number,
): PaginatedResult<T> {
  const hasMore = rows.length > pageSize;
  const items = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor(getCursor(items[items.length - 1]))
      : null;
  const result: PaginatedResult<T> = { items, nextCursor };
  if (typeof total === "number") result.total = total;
  return result;
}
