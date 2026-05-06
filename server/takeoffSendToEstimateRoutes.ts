/**
 * Task #2404 — Send-to-Estimate.
 *
 * Idempotent endpoint that pushes selected takeoff measurements into an
 * estimate as line items, keyed on (estimateId, sourceMeasurementId).
 *
 * Modes:
 *   - "merge"  (default): existing rows for the same measurement get qty
 *     and unitCost overwritten; user-edited markup/notes are preserved.
 *     New rows are inserted.
 *   - "replace": same as merge, plus any line items previously sent
 *     from this takeoff that are no longer in the payload are removed.
 */
import { Router } from "express";
import { db } from "./db";
import {
  estimates,
  estimateLineItems,
  takeoffMeasurements,
  takeoffSheets,
  standaloneTakeoffs,
  bids,
  projects,
  quantityCategories,
} from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";

const router = Router();

type EstimateCategory =
  | "CONCRETE" | "EXCAVATION" | "PAVERS" | "BOLLARDS" | "GC" | "OVERHEAD"
  | "PROFIT" | "GENERAL" | "PLUMBING" | "HVAC" | "ROOFING" | "STRUCTURAL_STEEL"
  | "MASONRY" | "DRYWALL" | "PAINTING" | "FLOORING" | "FIRE_PROTECTION"
  | "DEMOLITION" | "CARPENTRY" | "INSULATION" | "WINDOWS_DOORS" | "ELEVATOR"
  | "GRADING" | "PAVING" | "SITEWORK" | "WATERPROOFING" | "MECHANICAL"
  | "FRAMING" | "STRIPING" | "SIGNAGE" | "LANDSCAPING" | "ELECTRICAL"
  | "OTHER" | "METALS" | "FINISHES";
type EstimateSource = "MANUAL" | "TAKEOFF" | "GENERATED" | "ASSEMBLY";

const sendSchema = z.object({
  estimateId: z.string().min(1),
  sourceTakeoffId: z.string().min(1),
  measurementIds: z.array(z.string().min(1)).min(1).max(2000),
  mode: z.enum(["merge", "replace"]).optional().default("merge"),
});

const CATEGORY_MAP: Record<string, EstimateCategory> = {
  CONCRETE: "CONCRETE",
  PAVING: "PAVING",
  EXCAVATION: "EXCAVATION",
  GRADING: "GRADING",
  SITEWORK: "SITEWORK",
  ELECTRICAL: "ELECTRICAL",
  PLUMBING: "PLUMBING",
  HVAC: "HVAC",
  ROOFING: "ROOFING",
  MASONRY: "MASONRY",
  DRYWALL: "DRYWALL",
  PAINTING: "PAINTING",
  FLOORING: "FLOORING",
  CARPENTRY: "CARPENTRY",
  STRIPING: "STRIPING",
};

function mapCategory(catName: string | null | undefined): EstimateCategory {
  if (!catName) return "GENERAL";
  const upper = catName.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return CATEGORY_MAP[upper] ?? "GENERAL";
}

function deriveQuantity(m: typeof takeoffMeasurements.$inferSelect): { qty: number; unit: string } {
  if (m.computedAreaFt2 != null && m.computedAreaFt2 > 0) return { qty: m.computedAreaFt2, unit: "SF" };
  if (m.computedVolumeCy != null && m.computedVolumeCy > 0) return { qty: m.computedVolumeCy, unit: "CY" };
  if (m.computedLengthFt != null && m.computedLengthFt > 0) return { qty: m.computedLengthFt, unit: "LF" };
  if (m.count != null && m.count > 0) return { qty: m.count, unit: "EA" };
  return { qty: 0, unit: "EA" };
}

router.post("/api/takeoff/send-to-estimate", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const parsed = sendSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid payload", details: parsed.error.errors });
    const user = req.user!;

    // Verify estimate access.
    const [est] = await db.select().from(estimates).where(eq(estimates.id, parsed.data.estimateId)).limit(1);
    if (!est) return res.status(404).json({ error: "Estimate not found" });

    let estimateOrgId: string | null = null;
    if (est.bidId) {
      const [b] = await db.select({ org: bids.gcOrganizationId }).from(bids).where(eq(bids.id, est.bidId)).limit(1);
      estimateOrgId = b?.org ?? null;
    } else if (est.projectId) {
      const [p] = await db.select({ org: projects.gcOrganizationId }).from(projects).where(eq(projects.id, est.projectId)).limit(1);
      estimateOrgId = p?.org ?? null;
    }
    if (user.role !== "SUPER_ADMIN" && estimateOrgId !== user.organizationId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Load measurements + sheets (verify they all live in the source takeoff).
    const measurements = await db
      .select()
      .from(takeoffMeasurements)
      .where(inArray(takeoffMeasurements.id, parsed.data.measurementIds));
    if (measurements.length === 0) return res.status(400).json({ error: "No measurements found" });

    const sheetIds = Array.from(new Set(measurements.map((m) => m.sheetId)));
    const sheets = await db.select().from(takeoffSheets).where(inArray(takeoffSheets.id, sheetIds));
    const sheetById = new Map(sheets.map((s) => [s.id, s]));

    // Resolve the source takeoff's owning organization so we can org-scope
    // every measurement before touching it. This prevents cross-org IDOR:
    // even if an attacker guesses measurement ids that belong to another
    // org's takeoff, the org-id check below rejects them.
    const sourceBidIds = Array.from(new Set(sheets.map((s) => s.bidId).filter(Boolean) as string[]));
    const sourceProjectIds = Array.from(new Set(sheets.map((s) => s.projectId).filter(Boolean) as string[]));
    const sourceStandaloneIds = Array.from(new Set(sheets.map((s) => s.standaloneTakeoffId).filter(Boolean) as string[]));
    const [bidOrgs, projOrgs, standaloneOrgs] = await Promise.all([
      sourceBidIds.length
        ? db.select({ id: bids.id, org: bids.gcOrganizationId }).from(bids).where(inArray(bids.id, sourceBidIds))
        : Promise.resolve([] as { id: string; org: string | null }[]),
      sourceProjectIds.length
        ? db.select({ id: projects.id, org: projects.gcOrganizationId }).from(projects).where(inArray(projects.id, sourceProjectIds))
        : Promise.resolve([] as { id: string; org: string | null }[]),
      sourceStandaloneIds.length
        ? db.select({ id: standaloneTakeoffs.id, org: standaloneTakeoffs.organizationId }).from(standaloneTakeoffs).where(inArray(standaloneTakeoffs.id, sourceStandaloneIds))
        : Promise.resolve([] as { id: string; org: string | null }[]),
    ]);
    const orgByBid = new Map(bidOrgs.map((r) => [r.id, r.org]));
    const orgByProject = new Map(projOrgs.map((r) => [r.id, r.org]));
    const orgByStandalone = new Map(standaloneOrgs.map((r) => [r.id, r.org]));

    // sourceTakeoffId can be a bid id, project id, or standalone takeoff id.
    // Verify each measurement's sheet belongs to the source takeoff context
    // AND its owning organization matches the caller's org (or caller is
    // SUPER_ADMIN).
    for (const m of measurements) {
      const s = sheetById.get(m.sheetId);
      if (!s) return res.status(400).json({ error: "Measurement has no parent sheet" });
      const matches =
        s.bidId === parsed.data.sourceTakeoffId ||
        s.projectId === parsed.data.sourceTakeoffId ||
        s.standaloneTakeoffId === parsed.data.sourceTakeoffId;
      if (!matches) return res.status(400).json({ error: "Measurement does not belong to the source takeoff" });
      const sheetOrg =
        (s.bidId && orgByBid.get(s.bidId)) ||
        (s.projectId && orgByProject.get(s.projectId)) ||
        (s.standaloneTakeoffId && orgByStandalone.get(s.standaloneTakeoffId)) ||
        null;
      if (user.role !== "SUPER_ADMIN" && sheetOrg !== user.organizationId) {
        return res.status(403).json({ error: "Forbidden: measurement is in another organization" });
      }
    }

    // Load category names for description fallback.
    const categoryIds = Array.from(new Set(measurements.map((m) => m.categoryId).filter(Boolean) as string[]));
    const categoryRows = categoryIds.length
      ? await db.select().from(quantityCategories).where(inArray(quantityCategories.id, categoryIds))
      : [];
    const catById = new Map(categoryRows.map((c) => [c.id, c]));

    // Load existing rows previously sent from this takeoff into this
    // estimate for idempotent merge / replace.
    const existing = await db
      .select()
      .from(estimateLineItems)
      .where(
        and(
          eq(estimateLineItems.estimateId, parsed.data.estimateId),
          eq(estimateLineItems.sourceTakeoffId, parsed.data.sourceTakeoffId),
        ),
      );
    const existingByMeasurement = new Map(
      existing.filter((r) => r.sourceMeasurementId).map((r) => [r.sourceMeasurementId as string, r]),
    );

    let inserted = 0;
    let updated = 0;
    const created: typeof estimateLineItems.$inferSelect[] = [];

    for (const m of measurements) {
      const { qty, unit } = deriveQuantity(m);
      const cat = m.categoryId ? catById.get(m.categoryId) : null;
      const description = `${cat?.name ?? m.label ?? "Takeoff item"}${m.note ? ` — ${m.note}` : ""}`;
      const unitCost = m.unitCost ?? cat?.unitCost ?? 0;
      const materialCost = qty * Number(unitCost);
      const category = mapCategory(cat?.name);

      const existingRow = existingByMeasurement.get(m.id);
      if (existingRow) {
        // Idempotent re-send: overwrite quantity / unit / unitCost / material cost
        // but keep user-edited markup, notes, overhead/profit.
        const newTotal =
          materialCost +
          Number(existingRow.laborCost ?? 0) +
          Number(existingRow.equipmentCost ?? 0) +
          Number(existingRow.consumablesCost ?? 0) +
          Number(existingRow.subcontractCost ?? 0) +
          Number(existingRow.overheadAllocation ?? 0) +
          Number(existingRow.profitAllocation ?? 0);
        await db
          .update(estimateLineItems)
          .set({
            quantity: String(qty),
            unit,
            materialCost: String(materialCost),
            totalCost: String(newTotal),
            updatedAt: new Date(),
          })
          .where(eq(estimateLineItems.id, existingRow.id));
        updated++;
      } else {
        const [row] = await db
          .insert(estimateLineItems)
          .values({
            estimateId: parsed.data.estimateId,
            category: category satisfies EstimateCategory,
            description,
            quantity: String(qty),
            unit,
            source: "TAKEOFF" satisfies EstimateSource,
            sourceTakeoffCategoryId: m.categoryId ?? null,
            materialCost: String(materialCost),
            laborCost: "0",
            laborHours: "0",
            equipmentCost: "0",
            equipmentHours: "0",
            consumablesCost: "0",
            subcontractCost: "0",
            overheadAllocation: "0",
            profitAllocation: "0",
            totalCost: String(materialCost),
            sourceType: "takeoff_send",
            sourceTakeoffId: parsed.data.sourceTakeoffId,
            sourceMeasurementId: m.id,
          })
          .returning();
        created.push(row);
        inserted++;
      }
    }

    // Replace mode — hard-delete rows previously sent from the same
    // takeoff that are no longer in this payload. Hard delete is used
    // (rather than soft delete) so existing estimate read paths
    // (totals, snapshots, approval) don't have to learn a new
    // `deletedAt IS NULL` filter; the audit log row above records the
    // removal count for traceability.
    let removed = 0;
    if (parsed.data.mode === "replace") {
      const incomingIds = new Set(parsed.data.measurementIds);
      const stale = existing.filter((r) => r.sourceMeasurementId && !incomingIds.has(r.sourceMeasurementId));
      if (stale.length > 0) {
        await db
          .delete(estimateLineItems)
          .where(inArray(estimateLineItems.id, stale.map((r) => r.id)));
        removed = stale.length;
      }
    }

    await logAudit(
      {
        userId: user.id,
        action: "CREATE",
        entityType: "estimate_line_item",
        entityId: parsed.data.estimateId,
        newValue: `Send-to-Estimate: +${inserted} new, ~${updated} updated, -${removed} removed (sourceTakeoffId=${parsed.data.sourceTakeoffId})`,
      },
      req,
    );

    res.json({ inserted, updated, removed, lineItems: created });
  } catch (err) {
    next(err);
  }
});

export default router;
