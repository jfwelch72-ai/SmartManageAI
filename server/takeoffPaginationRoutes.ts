/**
 * Task #2579 — Takeoff Phase D, Step 1: Pagination & spatial chunking.
 *
 * Adds a paginated, sheet-scoped, optionally bounding-box-filtered
 * read endpoint for takeoff measurements. The legacy
 * `GET /api/takeoff/sheets/:sheetId/measurements` returns every row
 * for the sheet, which is fine for sub-thousand-row sheets but blocks
 * the browser on dense sheets (5,000+ measurements).
 *
 * Contract:
 *   GET /api/takeoff/sheets/:sheetId/measurements/page
 *     ?limit=500            (1..2000, default 500)
 *     &cursor=<iso ts|id>   (opaque; pass back `nextCursor`)
 *     &versionId=<uuid>     (optional override; default: active draft)
 *     &bbox=minX,minY,maxX,maxY   (sheet-pixel space; optional)
 *
 *   200 → { items, nextCursor, hasMore, total? }
 *
 * Cursor pagination is keyset on (createdAt, id) so it is stable
 * even while teammates insert new rows. The bbox filter parses the
 * `points` JSON server-side and rejects rows whose computed extent
 * does not intersect — `points` is not a typed geometry column today
 * so we cannot push it down to the index. To keep the parse cost
 * bounded the endpoint refuses limits > 2000 and the caller is
 * expected to drive pagination from the cursor.
 */
import { Router } from "express";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { takeoffMeasurements } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import {
  verifySheetAccess,
  safeParsePoints,
  getDefaultVersionId,
} from "./takeoffHelpers";

const router = Router();

const MAX_PAGE_SIZE = 2000;
const DEFAULT_PAGE_SIZE = 500;

const bboxSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/)
  .transform((raw) => {
    const [minX, minY, maxX, maxY] = raw.split(",").map(Number);
    return { minX, minY, maxX, maxY };
  })
  .refine(
    (b) => b.minX <= b.maxX && b.minY <= b.maxY,
    "bbox min must be <= max",
  );

interface Cursor {
  ts: string;
  id: string;
}

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof parsed?.ts === "string" && typeof parsed?.id === "string") {
      return { ts: parsed.ts, id: parsed.id };
    }
  } catch {
    // fall through
  }
  return null;
}

function intersectsBbox(
  pointsJson: string | null | undefined,
  bbox: { minX: number; minY: number; maxX: number; maxY: number },
): boolean {
  const points = safeParsePoints(pointsJson);
  if (!points || points.length === 0) return false;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (typeof p?.x !== "number" || typeof p?.y !== "number") continue;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  if (minX === Infinity) return false;
  return !(
    maxX < bbox.minX ||
    minX > bbox.maxX ||
    maxY < bbox.minY ||
    minY > bbox.maxY
  );
}

router.get(
  "/api/takeoff/sheets/:sheetId/measurements/page",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { sheetId } = req.params;
      const access = await verifySheetAccess(sheetId, req.user!);
      if (!access.allowed) {
        res
          .status(access.sheet ? 403 : 404)
          .json({ error: access.reason || "Sheet not found" });
        return;
      }

      const limitRaw = Number(req.query.limit ?? DEFAULT_PAGE_SIZE);
      const limit = Number.isFinite(limitRaw)
        ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(limitRaw)))
        : DEFAULT_PAGE_SIZE;

      const cursor = decodeCursor(
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      );

      let bbox: { minX: number; minY: number; maxX: number; maxY: number } | null = null;
      if (typeof req.query.bbox === "string" && req.query.bbox.length > 0) {
        const parsed = bboxSchema.safeParse(req.query.bbox);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid bbox", details: parsed.error.flatten() });
          return;
        }
        bbox = parsed.data;
      }

      let versionId: string | null = null;
      if (typeof req.query.versionId === "string" && req.query.versionId) {
        versionId = req.query.versionId;
      } else {
        versionId = await getDefaultVersionId(sheetId);
      }

      const baseConditions = [eq(takeoffMeasurements.sheetId, sheetId)];
      if (versionId) {
        baseConditions.push(eq(takeoffMeasurements.takeoffVersionId, versionId));
      }
      if (cursor) {
        // Keyset: (createdAt, id) > (cursor.ts, cursor.id)
        baseConditions.push(
          or(
            gt(takeoffMeasurements.createdAt, new Date(cursor.ts)),
            and(
              eq(takeoffMeasurements.createdAt, new Date(cursor.ts)),
              gt(takeoffMeasurements.id, cursor.id),
            ),
          )!,
        );
      }

      // When a bbox filter is active we can't push the predicate down
      // (points is text JSON, not a typed geometry column), so we
      // page-fetch raw rows and post-filter. We loop until we've
      // accumulated `limit` matches or exhausted the sheet, and we
      // anchor the next-page cursor on the LAST RAW row inspected
      // (not the last filtered row) so pagination always makes
      // forward progress even when a page contains zero matches in
      // the bbox.
      type RawRow = typeof takeoffMeasurements.$inferSelect;
      const filtered: RawRow[] = [];
      let lastRaw: RawRow | null = null;
      let exhausted = false;

      if (bbox) {
        const innerLimit = Math.min(MAX_PAGE_SIZE, Math.max(limit * 3, 500));
        const maxIterations = 6; // hard ceiling to bound worst-case latency
        let iter = 0;
        let cursorConditions = [...baseConditions];
        while (filtered.length < limit && iter < maxIterations) {
          const rows: RawRow[] = await db
            .select()
            .from(takeoffMeasurements)
            .where(and(...cursorConditions))
            .orderBy(asc(takeoffMeasurements.createdAt), asc(takeoffMeasurements.id))
            .limit(innerLimit);
          if (rows.length === 0) {
            exhausted = true;
            break;
          }
          for (const r of rows) {
            lastRaw = r;
            if (intersectsBbox(r.points, bbox)) {
              filtered.push(r);
              if (filtered.length >= limit) break;
            }
          }
          if (rows.length < innerLimit) {
            exhausted = true;
            break;
          }
          if (filtered.length >= limit) break;
          // Advance cursor past the last raw row inspected so the
          // next iteration moves forward. Rebuild from baseConditions
          // each loop so we don't accumulate stacking cursor preds.
          const advance = lastRaw!;
          cursorConditions = [...baseConditions];
          cursorConditions.push(
            or(
              gt(takeoffMeasurements.createdAt, advance.createdAt),
              and(
                eq(takeoffMeasurements.createdAt, advance.createdAt),
                gt(takeoffMeasurements.id, advance.id),
              ),
            )!,
          );
          iter += 1;
        }
      } else {
        const rows: RawRow[] = await db
          .select()
          .from(takeoffMeasurements)
          .where(and(...baseConditions))
          .orderBy(asc(takeoffMeasurements.createdAt), asc(takeoffMeasurements.id))
          .limit(limit + 1);
        for (const r of rows) {
          lastRaw = r;
        }
        if (rows.length > limit) {
          filtered.push(...rows.slice(0, limit));
          // anchor cursor on the last item we're returning
          lastRaw = filtered[filtered.length - 1];
        } else {
          filtered.push(...rows);
          exhausted = true;
        }
      }

      const page = filtered.slice(0, limit);
      const hasMore = !exhausted;
      const cursorAnchor = bbox
        ? lastRaw // anchor on raw progress so empty pages still advance
        : page[page.length - 1] ?? null;

      const items = page.map((m) => ({
        ...m,
        points: safeParsePoints(m.points) || [],
      }));

      res.json({
        items,
        nextCursor:
          hasMore && cursorAnchor
            ? encodeCursor({
                ts: cursorAnchor.createdAt.toISOString(),
                id: cursorAnchor.id,
              })
            : null,
        hasMore,
        pageSize: items.length,
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * Lightweight count endpoint so the client can render a "loading X of
 * N" badge without fetching every row.
 */
router.get(
  "/api/takeoff/sheets/:sheetId/measurements/count",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const { sheetId } = req.params;
      const access = await verifySheetAccess(sheetId, req.user!);
      if (!access.allowed) {
        res
          .status(access.sheet ? 403 : 404)
          .json({ error: access.reason || "Sheet not found" });
        return;
      }
      let versionId: string | null = null;
      if (typeof req.query.versionId === "string" && req.query.versionId) {
        versionId = req.query.versionId;
      } else {
        versionId = await getDefaultVersionId(sheetId);
      }
      const conds = [eq(takeoffMeasurements.sheetId, sheetId)];
      if (versionId) conds.push(eq(takeoffMeasurements.takeoffVersionId, versionId));
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(takeoffMeasurements)
        .where(and(...conds));
      res.json({ count: Number(count) || 0 });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
