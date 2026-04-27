// Task #2079 — Sync Takeoff "Recent" entries across the user's devices.
//
// Recent bid/sheet/project openings used to live exclusively in
// localStorage, so a user who jumped between desktop and laptop saw a
// different "Recent" rail on each machine. These routes back the same
// shape with a per-user table (`takeoff_recents`) so the rail follows the
// user. The frontend keeps writing locally for instant UX and reconciles
// with the server in the background — see client/src/lib/takeoff-recents.ts.

import { Router } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "./db";
import { takeoffRecents } from "@shared/schema";
import { requireAuth, type AuthRequest } from "./auth";
import { logError } from "./utils/logger";

const router = Router();

// Mirrors MAX_ENTRIES on the client. Anything older than this gets pruned
// at write time so the table can't grow unbounded for power users.
const MAX_ENTRIES_PER_USER = 24;

const recentEntrySchema = z.object({
  kind: z.enum(["bid", "project"]),
  entityId: z.string().min(1).max(128),
  entityCode: z.string().min(1).max(128),
  entityName: z.string().max(512).nullable().optional(),
  sheetId: z.string().max(128).nullable().optional(),
  sheetName: z.string().max(512).nullable().optional(),
  // openedAt is a unix-ms timestamp from the client. Optional so callers can
  // omit it and let the server stamp `now()`.
  openedAt: z.number().int().nonnegative().optional(),
});

function toDate(openedAt: number | undefined): Date {
  if (typeof openedAt !== "number" || !Number.isFinite(openedAt)) {
    return new Date();
  }
  // Defensive clamp — refuse timestamps wildly in the future so a buggy
  // client clock can't pin a bogus entry to the top of the rail forever.
  const now = Date.now();
  const max = now + 60 * 60 * 1000; // +1h tolerance for clock skew
  return new Date(Math.min(openedAt, max));
}

router.get("/api/takeoff/recents", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const rows = await db
      .select()
      .from(takeoffRecents)
      .where(eq(takeoffRecents.userId, userId))
      .orderBy(desc(takeoffRecents.openedAt))
      .limit(MAX_ENTRIES_PER_USER);

    return res.json(
      rows.map((row) => ({
        kind: row.kind,
        entityId: row.entityId,
        entityCode: row.entityCode,
        entityName: row.entityName,
        sheetId: row.sheetId === "" ? null : row.sheetId,
        sheetName: row.sheetName,
        openedAt: row.openedAt.getTime(),
      })),
    );
  } catch (error) {
    logError("Failed to load takeoff recents", { error: String(error) });
    return next(error);
  }
});

router.post("/api/takeoff/recents", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(400).json({ error: "User is not associated with an organization." });
    }

    const parsed = recentEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid takeoff recent entry",
        details: parsed.error.errors,
      });
    }

    const entry = parsed.data;
    // Normalize sheetId to "" so the unique index treats sheet-less entries
    // as a single slot per (user, kind, entity).
    const sheetIdKey = entry.sheetId && entry.sheetId.length > 0 ? entry.sheetId : "";
    const openedAt = toDate(entry.openedAt);

    await db
      .insert(takeoffRecents)
      .values({
        userId,
        organizationId: orgId,
        kind: entry.kind,
        entityId: entry.entityId,
        entityCode: entry.entityCode,
        entityName: entry.entityName ?? null,
        sheetId: sheetIdKey,
        sheetName: entry.sheetName ?? null,
        openedAt,
      })
      .onConflictDoUpdate({
        target: [
          takeoffRecents.userId,
          takeoffRecents.kind,
          takeoffRecents.entityId,
          takeoffRecents.sheetId,
        ],
        set: {
          // Only bump openedAt forward — re-opening an entry should refresh
          // its position on the rail without ever moving it backward in
          // case an older sync arrives out of order.
          openedAt: sql`GREATEST(${takeoffRecents.openedAt}, EXCLUDED.opened_at)`,
          entityCode: entry.entityCode,
          entityName: entry.entityName ?? null,
          sheetName: entry.sheetName ?? null,
        },
      });

    // Prune anything past the cap so the table can't grow unbounded. Done
    // inline because the table is small and the writes are infrequent —
    // there's no need for a background job. Uses a subquery so the same
    // statement works on both Neon and stock Postgres.
    await db.execute(sql`
      DELETE FROM ${takeoffRecents}
      WHERE user_id = ${userId}
        AND id NOT IN (
          SELECT id FROM ${takeoffRecents}
          WHERE user_id = ${userId}
          ORDER BY opened_at DESC
          LIMIT ${MAX_ENTRIES_PER_USER}
        )
    `);

    return res.status(204).end();
  } catch (error) {
    logError("Failed to record takeoff recent", { error: String(error) });
    return next(error);
  }
});

const deleteSchema = z.object({
  kind: z.enum(["bid", "project"]),
  entityId: z.string().min(1).max(128),
  sheetId: z.string().max(128).nullable().optional(),
});

router.delete("/api/takeoff/recents", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const userId = req.user!.id;
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request", details: parsed.error.errors });
    }
    const sheetIdKey = parsed.data.sheetId && parsed.data.sheetId.length > 0 ? parsed.data.sheetId : "";

    await db
      .delete(takeoffRecents)
      .where(
        and(
          eq(takeoffRecents.userId, userId),
          eq(takeoffRecents.kind, parsed.data.kind),
          eq(takeoffRecents.entityId, parsed.data.entityId),
          eq(takeoffRecents.sheetId, sheetIdKey),
        ),
      );

    return res.status(204).end();
  } catch (error) {
    logError("Failed to delete takeoff recent", { error: String(error) });
    return next(error);
  }
});

export default router;
