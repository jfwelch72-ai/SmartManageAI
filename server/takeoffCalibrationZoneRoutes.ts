// Task #2780 — Multi-region calibration zones CRUD.
// Zones are named regions on a takeoff sheet, each with its own px-per-foot scale.
import { Router } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "./auth";
import { verifySheetAccess } from "./takeoffHelpers";
import { z } from "zod";

const router = Router();

const zoneSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  polygonPoints: z.array(z.object({ x: z.number(), y: z.number() })).min(3),
  pxPerFoot: z.number().positive(),
});

router.get("/api/takeoff/sheets/:sheetId/calibration-zones", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) return res.status(404).json({ error: access.reason || "Sheet not found" });

    const zones = await db.execute(sql`
      SELECT id, sheet_id, name, polygon_points, px_per_foot, created_by_id, created_at, updated_at
      FROM takeoff_sheet_calibration_zones
      WHERE sheet_id = ${sheetId}
      ORDER BY created_at ASC
    `);

    res.json(zones.rows);
  } catch (err) {
    next(err);
  }
});

router.post("/api/takeoff/sheets/:sheetId/calibration-zones", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { sheetId } = req.params;
    const access = await verifySheetAccess(sheetId, req.user!);
    if (!access.allowed) return res.status(404).json({ error: access.reason || "Sheet not found" });

    const parsed = zoneSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid zone data", details: parsed.error.flatten() });
    }

    const { name, polygonPoints, pxPerFoot } = parsed.data;
    const userId = req.user!.id;

    const result = await db.execute(sql`
      INSERT INTO takeoff_sheet_calibration_zones (sheet_id, name, polygon_points, px_per_foot, created_by_id)
      VALUES (${sheetId}, ${name}, ${JSON.stringify(polygonPoints)}::jsonb, ${pxPerFoot}, ${userId})
      RETURNING *
    `);

    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/takeoff/calibration-zones/:zoneId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { zoneId } = req.params;

    const existing = await db.execute(sql`
      SELECT z.id, z.sheet_id FROM takeoff_sheet_calibration_zones z WHERE z.id = ${zoneId} LIMIT 1
    `);
    if (!existing.rows.length) return res.status(404).json({ error: "Zone not found" });

    const row = existing.rows[0] as { id: string; sheet_id: string };
    const access = await verifySheetAccess(row.sheet_id, req.user!);
    if (!access.allowed) return res.status(403).json({ error: "Access denied" });

    const parsed = zoneSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid zone data", details: parsed.error.flatten() });
    }

    const { name, polygonPoints, pxPerFoot } = parsed.data;

    const result = await db.execute(sql`
      UPDATE takeoff_sheet_calibration_zones
      SET name = COALESCE(${name ?? null}, name),
          polygon_points = COALESCE(${polygonPoints ? JSON.stringify(polygonPoints) : null}::jsonb, polygon_points),
          px_per_foot = COALESCE(${pxPerFoot ?? null}, px_per_foot),
          updated_at = NOW()
      WHERE id = ${zoneId}
      RETURNING *
    `);

    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete("/api/takeoff/calibration-zones/:zoneId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { zoneId } = req.params;

    const existing = await db.execute(sql`
      SELECT z.id, z.sheet_id FROM takeoff_sheet_calibration_zones z WHERE z.id = ${zoneId} LIMIT 1
    `);
    if (!existing.rows.length) return res.status(404).json({ error: "Zone not found" });

    const row = existing.rows[0] as { id: string; sheet_id: string };
    const access = await verifySheetAccess(row.sheet_id, req.user!);
    if (!access.allowed) return res.status(403).json({ error: "Access denied" });

    await db.execute(sql`DELETE FROM takeoff_sheet_calibration_zones WHERE id = ${zoneId}`);
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
