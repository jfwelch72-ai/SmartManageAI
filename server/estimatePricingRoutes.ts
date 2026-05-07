/**
 * Task #2578 — Estimate pricing extras: alternate groups, allowances,
 * contingencies, and sub-bid leveling sheets. Also exposes the new
 * exports (proposal PDF, AIA G703 SOV, leveling sheet xlsx).
 */

import { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import {
  estimates,
  estimateLineItems,
  bids,
  projects,
  bidSubcontractorQuotes,
  estimateAlternateGroups,
  estimateLevelingSheets,
  estimateLevelingSheetColumns,
  insertEstimateAlternateGroupSchema,
  insertEstimateLevelingSheetSchema,
  insertEstimateLevelingSheetColumnSchema,
  estimateLineTypeSchema,
  allowanceBasisSchema,
  costBookProviders,
  costBookEntries,
  estimatingCrewTemplates,
  estimatingCrewTemplateWorkers,
  estimatingCrewTemplateEquipment,
  type Estimate,
} from "@shared/schema";
import { getCostBookAdapter, applyGeoFactor } from "./services/costBook/provider";
import { computeCrewDailyCost } from "./crewTemplateRoutes";
import { requireAuth, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { getOrganizationBranding } from "./organizationBranding";
import { generateProposalPDF } from "./services/exports/proposalPdf";
import { generateSovG703Xlsx } from "./services/exports/sovG703";
import {
  generateLevelingSheetXlsx,
  buildLevelingColumnsFromQuotes,
} from "./services/exports/levelingSheetXlsx";
import { logError } from "./utils/logger";

const router = Router();

function isManagement(role: string): boolean {
  return ["SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"].includes(role);
}

async function loadEstimateForOrg(estimateId: string, orgId: string): Promise<Estimate | null> {
  const [est] = await db.select().from(estimates).where(eq(estimates.id, estimateId)).limit(1);
  if (!est) return null;
  if (est.bidId) {
    const [bid] = await db.select().from(bids).where(eq(bids.id, est.bidId)).limit(1);
    if (bid && bid.gcOrganizationId !== orgId) return null;
  } else if (est.projectId) {
    const [proj] = await db.select().from(projects).where(eq(projects.id, est.projectId)).limit(1);
    if (proj && proj.gcOrganizationId !== orgId) return null;
  }
  return est;
}

// ---------------------------------------------------------------------------
// Alternate Groups
// ---------------------------------------------------------------------------
router.get("/api/estimates/:estimateId/alternate-groups", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.json([]);
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const rows = await db
      .select()
      .from(estimateAlternateGroups)
      .where(eq(estimateAlternateGroups.estimateId, est.id))
      .orderBy(asc(estimateAlternateGroups.displayOrder), asc(estimateAlternateGroups.code));
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

router.post("/api/estimates/:estimateId/alternate-groups", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = insertEstimateAlternateGroupSchema.omit({ estimateId: true }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
    const [created] = await db
      .insert(estimateAlternateGroups)
      .values({ ...parsed.data, estimateId: est.id })
      .returning();
    res.status(201).json(created);
  } catch (err) {
    next(err);
  }
});

router.patch("/api/estimates/:estimateId/alternate-groups/:groupId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = insertEstimateAlternateGroupSchema
      .partial()
      .omit({ estimateId: true })
      .safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });
    const [updated] = await db
      .update(estimateAlternateGroups)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(
        eq(estimateAlternateGroups.id, req.params.groupId),
        eq(estimateAlternateGroups.estimateId, est.id),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Group not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

router.delete("/api/estimates/:estimateId/alternate-groups/:groupId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    await db
      .delete(estimateAlternateGroups)
      .where(and(
        eq(estimateAlternateGroups.id, req.params.groupId),
        eq(estimateAlternateGroups.estimateId, est.id),
      ));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Line type / allowance / contingency setter (operates on existing lines)
// ---------------------------------------------------------------------------
const lineTypePatchSchema = z.object({
  lineType: estimateLineTypeSchema,
  alternateGroupId: z.string().nullish(),
  allowanceBasis: allowanceBasisSchema.nullish(),
  contingencyPercent: z.coerce.number().nonnegative().nullish(),
});

router.patch("/api/estimates/:estimateId/line-items/:lineItemId/line-type", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = lineTypePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    if (parsed.data.alternateGroupId) {
      const [grp] = await db
        .select({ id: estimateAlternateGroups.id })
        .from(estimateAlternateGroups)
        .where(and(
          eq(estimateAlternateGroups.id, parsed.data.alternateGroupId),
          eq(estimateAlternateGroups.estimateId, est.id),
        ))
        .limit(1);
      if (!grp) return res.status(400).json({ error: "alternateGroupId does not belong to this estimate" });
    }

    const update: Record<string, unknown> = {
      lineType: parsed.data.lineType,
      alternateGroupId: parsed.data.alternateGroupId ?? null,
      allowanceBasis: parsed.data.allowanceBasis ?? null,
      contingencyPercent:
        parsed.data.contingencyPercent != null ? String(parsed.data.contingencyPercent) : null,
      updatedAt: new Date(),
    };
    const [updated] = await db
      .update(estimateLineItems)
      .set(update)
      .where(and(
        eq(estimateLineItems.id, req.params.lineItemId),
        eq(estimateLineItems.estimateId, est.id),
      ))
      .returning();
    if (!updated) return res.status(404).json({ error: "Line item not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Apply a cost-book entry to an estimate line item.
// Atomically writes the unit/extended costs AND the provenance fields
// (source, source code, as-of date, geo factor) so the line can prove
// where the price came from.
// ---------------------------------------------------------------------------
const applyCostBookSchema = z.object({
  providerId: z.string().min(1),
  sourceCode: z.string().min(1),
  regionCode: z.string().nullish(),
  quantity: z.coerce.number().nonnegative().optional(),
});

router.post("/api/estimates/:estimateId/line-items/:lineItemId/apply-cost-book-entry", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = applyCostBookSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    const [provider] = await db
      .select()
      .from(costBookProviders)
      .where(and(eq(costBookProviders.id, parsed.data.providerId), eq(costBookProviders.organizationId, orgId)))
      .limit(1);
    if (!provider) return res.status(404).json({ error: "Cost-book provider not found" });

    const adapter = getCostBookAdapter(provider);
    const lookup = await adapter.lookupBySourceCode(provider, parsed.data.sourceCode, parsed.data.regionCode ?? undefined);
    if (!lookup) return res.status(404).json({ error: "Cost-book entry not found for that source code" });

    const [line] = await db
      .select()
      .from(estimateLineItems)
      .where(and(eq(estimateLineItems.id, req.params.lineItemId), eq(estimateLineItems.estimateId, est.id)))
      .limit(1);
    if (!line) return res.status(404).json({ error: "Line item not found" });

    const qty = parsed.data.quantity ?? Number(line.quantity || 0);
    const adj = lookup.adjusted;
    const materialCost = adj.materialCost * qty;
    const laborCost = adj.laborCost * qty;
    const equipmentCost = adj.equipmentCost * qty;
    const totalCost = adj.totalCost * qty
      + Number(line.consumablesCost || 0)
      + Number(line.subcontractCost || 0)
      + Number(line.overheadAllocation || 0)
      + Number(line.profitAllocation || 0);

    const [updated] = await db
      .update(estimateLineItems)
      .set({
        quantity: String(qty),
        materialCost: String(materialCost),
        laborCost: String(laborCost),
        equipmentCost: String(equipmentCost),
        totalCost: String(totalCost),
        costBookEntryId: lookup.entry.id,
        costBookSource: provider.name,
        costBookSourceCode: lookup.entry.sourceCode,
        costBookAsOfDate: lookup.entry.asOfDate,
        costBookGeoFactor: lookup.geoFactor
          ? String(Number(lookup.geoFactor.totalFactor || 1))
          : null,
        userAdjusted: false,
        updatedAt: new Date(),
      })
      .where(eq(estimateLineItems.id, line.id))
      .returning();
    res.json({ line: updated, provenance: {
      provider: provider.name,
      sourceCode: lookup.entry.sourceCode,
      asOfDate: lookup.entry.asOfDate,
      regionCode: lookup.geoFactor?.regionCode ?? null,
      totalFactor: lookup.geoFactor ? Number(lookup.geoFactor.totalFactor || 1) : 1,
    }});
  } catch (err) {
    logError("apply cost-book entry failed", undefined, err as Error);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Apply a crew template to an estimate line item.
// Computes labor + equipment cost from `crewDays` * computeCrewDailyCost
// and stamps crewTemplateId / crewDays on the line so the rollup shows
// the source of the labor numbers.
// ---------------------------------------------------------------------------
const applyCrewSchema = z.object({
  crewTemplateId: z.string().min(1),
  crewDays: z.coerce.number().positive(),
});

router.post("/api/estimates/:estimateId/line-items/:lineItemId/apply-crew", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = applyCrewSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    const [template] = await db
      .select()
      .from(estimatingCrewTemplates)
      .where(and(eq(estimatingCrewTemplates.id, parsed.data.crewTemplateId), eq(estimatingCrewTemplates.organizationId, orgId)))
      .limit(1);
    if (!template) return res.status(404).json({ error: "Crew template not found" });

    const [line] = await db
      .select()
      .from(estimateLineItems)
      .where(and(eq(estimateLineItems.id, req.params.lineItemId), eq(estimateLineItems.estimateId, est.id)))
      .limit(1);
    if (!line) return res.status(404).json({ error: "Line item not found" });

    const workers = await db
      .select()
      .from(estimatingCrewTemplateWorkers)
      .where(eq(estimatingCrewTemplateWorkers.crewTemplateId, template.id));
    const equipment = await db
      .select()
      .from(estimatingCrewTemplateEquipment)
      .where(eq(estimatingCrewTemplateEquipment.crewTemplateId, template.id));

    const hoursPerDay = Number(template.defaultHoursPerDay ?? 8);
    const cost = computeCrewDailyCost(workers, equipment, hoursPerDay);
    const days = parsed.data.crewDays;

    const laborCost = cost.laborCostPerDay * days;
    const equipmentCost = cost.equipmentCostPerDay * days;
    const laborHours = workers.reduce((s, w) => s + w.count * hoursPerDay * days, 0);
    const equipmentHours = equipment.reduce((s, e) => s + e.count * hoursPerDay * days, 0);

    const totalCost = Number(line.materialCost || 0)
      + laborCost
      + equipmentCost
      + Number(line.consumablesCost || 0)
      + Number(line.subcontractCost || 0)
      + Number(line.overheadAllocation || 0)
      + Number(line.profitAllocation || 0);

    const [updated] = await db
      .update(estimateLineItems)
      .set({
        laborHours: String(laborHours),
        laborCost: String(laborCost),
        equipmentHours: String(equipmentHours),
        equipmentCost: String(equipmentCost),
        totalCost: String(totalCost),
        crewTemplateId: template.id,
        crewDays: String(days),
        userAdjusted: false,
        updatedAt: new Date(),
      })
      .where(eq(estimateLineItems.id, line.id))
      .returning();

    res.json({
      line: updated,
      crew: {
        templateId: template.id,
        templateName: template.name,
        crewDays: days,
        laborCostPerDay: cost.laborCostPerDay,
        equipmentCostPerDay: cost.equipmentCostPerDay,
        totalCostPerDay: cost.totalCostPerDay,
      },
    });
  } catch (err) {
    logError("apply crew template failed", undefined, err as Error);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Roll-up: split totals by line type for proposal display
// ---------------------------------------------------------------------------
router.get("/api/estimates/:estimateId/rollup-by-line-type", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const lines = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, est.id));
    const groups = await db
      .select()
      .from(estimateAlternateGroups)
      .where(eq(estimateAlternateGroups.estimateId, est.id));

    const sumBy = (predicate: (li: typeof lines[number]) => boolean) =>
      lines.filter(predicate).reduce((s, li) => s + Number(li.totalCost || 0), 0);

    const baseSubtotal = sumBy((li) => (li.lineType ?? "BASE") === "BASE");
    const allowanceSubtotal = sumBy((li) => li.lineType === "ALLOWANCE");
    const contingencySubtotal = sumBy((li) => li.lineType === "CONTINGENCY");

    const alternates = groups.map((g) => {
      const alt = lines.filter((li) => li.lineType === "ALTERNATE" && li.alternateGroupId === g.id);
      return {
        group: g,
        subtotal: alt.reduce((s, li) => s + Number(li.totalCost || 0), 0),
        lineCount: alt.length,
      };
    });

    res.json({
      baseSubtotal,
      allowanceSubtotal,
      contingencySubtotal,
      alternates,
      totalIfAllAlternatesIncluded:
        baseSubtotal + allowanceSubtotal + contingencySubtotal +
        alternates.reduce((s, a) => s + a.subtotal, 0),
      totalWithDefaultAlternates:
        baseSubtotal + allowanceSubtotal + contingencySubtotal +
        alternates.filter((a) => a.group.defaultIncluded).reduce((s, a) => s + a.subtotal, 0),
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Leveling sheets
// ---------------------------------------------------------------------------
router.get("/api/estimates/:estimateId/leveling-sheets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.json([]);
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const sheets = await db
      .select()
      .from(estimateLevelingSheets)
      .where(eq(estimateLevelingSheets.estimateId, est.id))
      .orderBy(asc(estimateLevelingSheets.scopeLabel));
    res.json(sheets);
  } catch (err) {
    next(err);
  }
});

router.get("/api/estimates/:estimateId/leveling-sheets/:sheetId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const [sheet] = await db
      .select()
      .from(estimateLevelingSheets)
      .where(and(
        eq(estimateLevelingSheets.id, req.params.sheetId),
        eq(estimateLevelingSheets.estimateId, est.id),
      ))
      .limit(1);
    if (!sheet) return res.status(404).json({ error: "Leveling sheet not found" });
    const columns = await db
      .select()
      .from(estimateLevelingSheetColumns)
      .where(eq(estimateLevelingSheetColumns.levelingSheetId, sheet.id))
      .orderBy(asc(estimateLevelingSheetColumns.displayOrder));
    res.json({ sheet, columns });
  } catch (err) {
    next(err);
  }
});

const createLevelingSchema = z.object({
  sheet: insertEstimateLevelingSheetSchema.omit({ estimateId: true, createdByUserId: true }),
  columns: z.array(insertEstimateLevelingSheetColumnSchema.omit({ levelingSheetId: true })).default([]),
});

router.post("/api/estimates/:estimateId/leveling-sheets", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = createLevelingSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    const [sheet] = await db
      .insert(estimateLevelingSheets)
      .values({
        ...parsed.data.sheet,
        estimateId: est.id,
        createdByUserId: req.user!.id,
      })
      .returning();
    if (parsed.data.columns.length > 0) {
      await db.insert(estimateLevelingSheetColumns).values(
        parsed.data.columns.map((c) => ({ ...c, levelingSheetId: sheet.id })),
      );
    }
    res.status(201).json(sheet);
  } catch (err) {
    next(err);
  }
});

/**
 * Auto-build a leveling sheet from a bid's existing subcontractor quotes
 * for a given scope. Pulls every sub quote whose `scopeOfWork === scope`
 * and creates one column per quote (plus an optional in-house column).
 */
const autoBuildSchema = z.object({
  scopeLabel: z.string().min(1),
  inHouseCost: z.coerce.number().nonnegative().nullish(),
  inHouseInclusions: z.array(z.string()).default([]),
});

router.post("/api/estimates/:estimateId/leveling-sheets/auto-build", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const parsed = autoBuildSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.errors });

    if (!est.bidId) {
      return res.status(400).json({ error: "Auto-build only supported for bid estimates" });
    }

    const subQuotes = await db
      .select()
      .from(bidSubcontractorQuotes)
      .where(eq(bidSubcontractorQuotes.bidId, est.bidId));
    const matching = subQuotes.filter((q) => (q.scopeOfWork || "Unspecified") === parsed.data.scopeLabel);

    const built = buildLevelingColumnsFromQuotes({
      inHouseCost: parsed.data.inHouseCost ?? null,
      inHouseInclusions: parsed.data.inHouseInclusions,
      quotes: matching.map((q) => ({
        id: q.id,
        label: q.subcontractorName,
        baseAmount: Number(q.quoteAmount || 0),
        inclusions: (q.inclusions || "").split(/\r?\n|;|,/).map((s) => s.trim()).filter(Boolean),
        exclusions: (q.exclusions || "").split(/\r?\n|;|,/).map((s) => s.trim()).filter(Boolean),
        isSelected: q.isSelected ?? false,
      })),
    });

    const [sheet] = await db
      .insert(estimateLevelingSheets)
      .values({
        estimateId: est.id,
        scopeLabel: parsed.data.scopeLabel,
        inHouseCost: parsed.data.inHouseCost != null ? String(parsed.data.inHouseCost) : null,
        inclusionKeys: built.inclusionKeys,
        createdByUserId: req.user!.id,
      })
      .returning();

    let displayOrder = 0;
    for (const col of built.columns) {
      const matched = matching.find((q) => col.label === q.subcontractorName);
      await db.insert(estimateLevelingSheetColumns).values({
        levelingSheetId: sheet.id,
        sourceKind: col.sourceKind,
        subcontractorQuoteId: matched?.id ?? null,
        label: col.label,
        baseAmount: String(col.baseAmount),
        includedKeys: col.includedKeys,
        excludedKeys: col.excludedKeys,
        addForExcluded: String(col.addForExcluded),
        normalizedAmount: String(col.normalizedAmount),
        isRecommended: col.isRecommended,
        displayOrder: displayOrder++,
      });
    }

    res.status(201).json({ sheet, builtColumns: built.columns.length });
  } catch (err) {
    next(err);
  }
});

router.delete("/api/estimates/:estimateId/leveling-sheets/:sheetId", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    await db
      .delete(estimateLevelingSheets)
      .where(and(
        eq(estimateLevelingSheets.id, req.params.sheetId),
        eq(estimateLevelingSheets.estimateId, est.id),
      ));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/api/estimates/:estimateId/leveling-sheets/:sheetId/export.xlsx", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });
    const [sheet] = await db
      .select()
      .from(estimateLevelingSheets)
      .where(and(
        eq(estimateLevelingSheets.id, req.params.sheetId),
        eq(estimateLevelingSheets.estimateId, est.id),
      ))
      .limit(1);
    if (!sheet) return res.status(404).json({ error: "Leveling sheet not found" });
    const columns = await db
      .select()
      .from(estimateLevelingSheetColumns)
      .where(eq(estimateLevelingSheetColumns.levelingSheetId, sheet.id))
      .orderBy(asc(estimateLevelingSheetColumns.displayOrder));

    const buf = generateLevelingSheetXlsx({
      estimateCode: est.id,
      scopeLabel: sheet.scopeLabel,
      inclusionKeys: Array.isArray(sheet.inclusionKeys) ? (sheet.inclusionKeys as string[]) : [],
      columns: columns.map((c) => ({
        label: c.label,
        sourceKind: (c.sourceKind === "IN_HOUSE" ? "IN_HOUSE" : "SUB_QUOTE"),
        baseAmount: Number(c.baseAmount || 0),
        includedKeys: Array.isArray(c.includedKeys) ? (c.includedKeys as string[]) : [],
        excludedKeys: Array.isArray(c.excludedKeys) ? (c.excludedKeys as string[]) : [],
        addForExcluded: Number(c.addForExcluded || 0),
        normalizedAmount: Number(c.normalizedAmount || 0),
        isRecommended: !!c.isRecommended,
        notes: c.notes,
      })),
    });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="leveling-${sheet.scopeLabel.replace(/\W+/g, "_")}.xlsx"`);
    res.send(buf);
  } catch (err) {
    logError("leveling sheet export failed", undefined, err as Error);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Branded proposal PDF
// ---------------------------------------------------------------------------
router.get("/api/estimates/:estimateId/export/proposal-pdf", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });

    const lines = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, est.id))
      .orderBy(asc(estimateLineItems.createdAt));
    const groups = await db
      .select()
      .from(estimateAlternateGroups)
      .where(eq(estimateAlternateGroups.estimateId, est.id))
      .orderBy(asc(estimateAlternateGroups.displayOrder));

    let title = "Project Proposal";
    let code: string | undefined;
    let clientName: string | undefined;
    let address: string | undefined;
    if (est.bidId) {
      const [bid] = await db.select().from(bids).where(eq(bids.id, est.bidId)).limit(1);
      if (bid) {
        title = bid.name;
        code = bid.code;
        clientName = bid.clientName ?? undefined;
        address = [bid.locationAddress, bid.city, bid.state].filter(Boolean).join(", ") || undefined;
      }
    } else if (est.projectId) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, est.projectId)).limit(1);
      if (proj) {
        title = proj.name;
        code = proj.code;
        clientName = proj.clientName ?? undefined;
        address = [proj.locationAddress, proj.city, proj.state].filter(Boolean).join(", ") || undefined;
      }
    }

    const branding = await getOrganizationBranding(orgId);

    const includedAlternateIds = (req.query.includeAlt as string | undefined)
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const stream = generateProposalPDF({
      branding,
      context: {
        title,
        code,
        clientName,
        projectAddress: address,
        preparedBy: req.user!.firstName ? `${req.user!.firstName} ${req.user!.lastName ?? ""}`.trim() : undefined,
        preparedAt: new Date(),
        notes: est.notes ?? null,
      },
      lineItems: lines.map((li) => ({
        id: li.id,
        lineType: li.lineType ?? "BASE",
        alternateGroupId: li.alternateGroupId ?? null,
        description: li.description,
        category: li.category,
        quantity: Number(li.quantity || 0),
        unit: li.unit,
        totalCost: Number(li.totalCost || 0),
        costBookSource: li.costBookSource ?? null,
        costBookSourceCode: li.costBookSourceCode ?? null,
        costBookAsOfDate: li.costBookAsOfDate ? String(li.costBookAsOfDate) : null,
      })),
      alternateGroups: groups.map((g) => ({
        id: g.id,
        code: g.code,
        name: g.name,
        description: g.description,
        defaultIncluded: g.defaultIncluded,
      })),
      includedAlternateIds,
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="proposal-${code ?? est.id}.pdf"`);
    stream.pipe(res);
  } catch (err) {
    logError("proposal pdf export failed", undefined, err as Error);
    next(err);
  }
});

// ---------------------------------------------------------------------------
// AIA G703-compatible Schedule of Values (xlsx)
// ---------------------------------------------------------------------------
router.get("/api/estimates/:estimateId/export/sov-g703.xlsx", requireAuth, async (req: AuthRequest, res, next) => {
  try {
    if (!isManagement(req.user!.role)) return res.status(403).json({ error: "Insufficient permissions" });
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Organization required" });
    const est = await loadEstimateForOrg(req.params.estimateId, orgId);
    if (!est) return res.status(404).json({ error: "Estimate not found" });

    const lines = await db
      .select()
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, est.id))
      .orderBy(asc(estimateLineItems.createdAt));

    let projectName = "Project";
    let projectCode = est.id;
    if (est.bidId) {
      const [bid] = await db.select().from(bids).where(eq(bids.id, est.bidId)).limit(1);
      if (bid) { projectName = bid.name; projectCode = bid.code; }
    } else if (est.projectId) {
      const [proj] = await db.select().from(projects).where(eq(projects.id, est.projectId)).limit(1);
      if (proj) { projectName = proj.name; projectCode = proj.code; }
    }
    const branding = await getOrganizationBranding(orgId);

    const buf = generateSovG703Xlsx({
      projectName,
      projectCode,
      contractor: branding.organizationName,
      retainagePercent: 10,
      lines: lines.map((li, idx) => ({
        itemNumber: String(idx + 1).padStart(3, "0"),
        description: li.description + (li.lineType && li.lineType !== "BASE" ? `  [${li.lineType}]` : ""),
        scheduledValue: Number(li.totalCost || 0),
      })),
    });

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="SOV-G703-${projectCode}.xlsx"`);
    res.send(buf);
  } catch (err) {
    logError("sov g703 export failed", undefined, err as Error);
    next(err);
  }
});

export default router;
