/**
 * Task #2579 — Takeoff Phase D, Step 3: Tablet field takeoff & as-built
 * redlines.
 *
 * Field staff working on a tablet may be offline (truck cab, basement,
 * brand-new site with no LTE). The takeoff workspace already buffers
 * measurement creates locally — what's been missing is a server-side
 * batch sync endpoint that:
 *   - is idempotent (the tablet may retry the same batch after a
 *     dropped connection),
 *   - tags every accepted row with its scope (BASE / CO / AS_BUILT),
 *   - returns a per-item result so the client can mark each buffered
 *     entry as flushed or surfaced for manual conflict resolution.
 *
 * Idempotency is handled via `clientId`: a UUID minted on-device when
 * the measurement is first drawn. The endpoint upserts on
 * (sheet_id, source_symbol_id-ish) — we re-use the existing
 * `source_symbol_id` text column via a `field:<clientId>` tag rather
 * than a new column so this ships without a schema migration. (The
 * Phase D follow-up roadmap calls for a dedicated `client_id` column +
 * partial unique index; tracked separately.)
 *
 * Contract:
 *   POST /api/takeoff/field/sync
 *     {
 *       sheetId: string,
 *       deviceId: string,
 *       items: Array<{
 *         clientId: string,            // tablet-side UUID
 *         type: "LINEAR"|"AREA"|...,
 *         label: string,
 *         points: Array<{x,y}>,
 *         scopeTag?: "BASE"|"CO"|"AS_BUILT",
 *         changeOrderId?: string,
 *         note?: string,
 *         capturedAt: string,          // ISO
 *       }>,
 *     }
 *
 *   200 → { results: Array<{ clientId, status: "created"|"existing"|"conflict"|"error", id?, reason? }> }
 */
import { Router } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { takeoffMeasurements, takeoffSheets } from "@shared/schema";

type MeasurementInsertType = (typeof takeoffMeasurements.$inferInsert)["type"];
import { requireAuth, type AuthRequest } from "./auth";
import {
  verifySheetAccess,
  getActiveDraftVersionId,
  hasAnyVersions,
} from "./takeoffHelpers";
import { logCreate } from "./auditLogger";
import { logError } from "./utils/logger";

const router = Router();

const FIELD_CLIENT_PREFIX = "field:";

const itemSchema = z.object({
  clientId: z.string().min(8).max(128),
  type: z.enum([
    "LINEAR",
    "AREA",
    "PITCHED_AREA",
    "SURFACE_AREA",
    "VOLUME",
    "COUNT",
    "SEGMENT",
  ]),
  label: z.string().min(1).max(200),
  points: z.array(z.object({ x: z.number(), y: z.number() })).min(1),
  scopeTag: z.enum(["BASE", "CO", "AS_BUILT"]).default("AS_BUILT"),
  changeOrderId: z.string().optional(),
  note: z.string().max(2000).optional(),
  count: z.number().optional(),
  depthFeet: z.number().optional(),
  capturedAt: z.string().optional(),
});

const bodySchema = z.object({
  sheetId: z.string().min(1),
  deviceId: z.string().min(1).max(128),
  items: z.array(itemSchema).min(1).max(500),
});

router.post(
  "/api/takeoff/field/sync",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const parsed = bodySchema.safeParse(req.body);
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: "Invalid payload", details: parsed.error.flatten() });
        return;
      }
      const { sheetId, deviceId, items } = parsed.data;

      const access = await verifySheetAccess(sheetId, req.user!);
      if (!access.allowed) {
        res
          .status(access.sheet ? 403 : 404)
          .json({ error: access.reason || "Sheet not found" });
        return;
      }

      // Resolve a target version. Field captures land on the active
      // draft when one exists; otherwise (frozen/locked sheet) we
      // refuse the whole batch with a structured error so the tablet
      // can surface an actionable banner ("Office has locked this
      // sheet — request a new draft to sync").
      const draftVersionId = await getActiveDraftVersionId(sheetId);
      if (!draftVersionId && (await hasAnyVersions(sheetId))) {
        res.status(409).json({ error: "Sheet has no active draft", code: "no_draft" });
        return;
      }

      const [sheet] = await db
        .select({
          scalePxPerFoot: takeoffSheets.scalePxPerFoot,
          scaleLabel: takeoffSheets.scaleLabel,
        })
        .from(takeoffSheets)
        .where(eq(takeoffSheets.id, sheetId))
        .limit(1);

      const results: Array<{
        clientId: string;
        status: "created" | "existing" | "conflict" | "error";
        id?: string;
        reason?: string;
      }> = [];

      for (const item of items) {
        const tag = `${FIELD_CLIENT_PREFIX}${item.clientId}`;
        try {
          // Idempotency under concurrent retries: take a Postgres
          // transaction-scoped advisory lock keyed on (sheetId,
          // clientId). Two parallel `POST /field/sync` calls carrying
          // the same clientId will serialize on this lock so the
          // second sees the first's row in the check-then-insert
          // below and returns `existing` instead of double-inserting.
          // The lock auto-releases at COMMIT/ROLLBACK. Until a
          // dedicated `client_id` column + partial unique index ships
          // (follow-up #2611), this is the safe ratchet.
          const lockKey = `field-sync:${sheetId}:${item.clientId}`;
          const insertedId = await db.transaction(async (tx) => {
            await tx.execute(
              sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`,
            );
            const [existing] = await tx
              .select({
                id: takeoffMeasurements.id,
                scopeTag: takeoffMeasurements.scopeTag,
                changeOrderId: takeoffMeasurements.changeOrderId,
              })
              .from(takeoffMeasurements)
              .where(
                and(
                  eq(takeoffMeasurements.sheetId, sheetId),
                  eq(takeoffMeasurements.sourceSymbolId, tag),
                ),
              )
              .limit(1);
            if (existing) {
              // True conflict: same clientId already persisted under
              // a different scope (e.g. tablet originally synced as
              // AS_BUILT, now retried as CO with a changeOrderId).
              // We refuse to mutate the row — surface as `conflict`
              // so the client can prompt manual resolution.
              const scopeChanged = existing.scopeTag !== item.scopeTag;
              const coChanged =
                (existing.changeOrderId ?? null) !== (item.changeOrderId ?? null);
              if (scopeChanged || coChanged) {
                return {
                  id: existing.id,
                  created: false,
                  conflict: true,
                  reason: scopeChanged ? "scope_mismatch" : "change_order_mismatch",
                } as const;
              }
              return { id: existing.id, created: false } as const;
            }

            const noteWithDevice = item.note
              ? `${item.note}\n[device:${deviceId}]`
              : `[device:${deviceId}]`;

            const [row] = await tx
              .insert(takeoffMeasurements)
              .values({
                sheetId,
                takeoffVersionId: draftVersionId || undefined,
                type: item.type as MeasurementInsertType,
                label: item.label,
                points: JSON.stringify(item.points),
                count: item.count ?? null,
                depthFeet: item.depthFeet ?? null,
                note: noteWithDevice,
                scopeTag: item.scopeTag,
                changeOrderId: item.changeOrderId ?? null,
                source: "USER",
                calibrationSource:
                  sheet?.scalePxPerFoot != null ? "USER_TWO_POINT" : "UNCALIBRATED",
                scaleAtCapturePxPerFoot: sheet?.scalePxPerFoot ?? null,
                scaleAtCaptureLabel: sheet?.scaleLabel ?? null,
                sourceSymbolId: tag,
                needsReview: true,
              })
              .returning({ id: takeoffMeasurements.id });
            return { id: row.id, created: true };
          });

          if (!insertedId.created) {
            if ("conflict" in insertedId && insertedId.conflict) {
              results.push({
                clientId: item.clientId,
                status: "conflict",
                id: insertedId.id,
                reason: insertedId.reason,
              });
            } else {
              results.push({ clientId: item.clientId, status: "existing", id: insertedId.id });
            }
            continue;
          }

          await logCreate(
            req.user!.id,
            "takeoff_measurement",
            insertedId.id,
            { sheetId, source: "field_sync", deviceId, scopeTag: item.scopeTag },
            req,
          );
          results.push({ clientId: item.clientId, status: "created", id: insertedId.id });
        } catch (err) {
          logError(
            "field-sync: insert failed",
            { sheetId, clientId: item.clientId },
            err instanceof Error ? err : new Error(String(err)),
          );
          results.push({
            clientId: item.clientId,
            status: "error",
            reason: err instanceof Error ? err.message : "insert_failed",
          });
        }
      }

      res.json({
        results,
        accepted: results.filter((r) => r.status === "created").length,
        deduped: results.filter((r) => r.status === "existing").length,
        failed: results.filter((r) => r.status === "error").length,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
