// Task #2576 — Base-bid vs Change-Order scope tagging on takeoff
// measurements.
//
// Endpoints:
//   POST   /api/takeoff/measurements/:id/scope        — set scope (BASE|CO + optional changeOrderId)
//   GET    /api/change-orders/:coId/takeoff-rollup    — aggregate cost rollup of measurements tagged with this CO
//   GET    /api/bids/:bidId/takeoff/measurements?scope=BASE|CO|ALL — scoped list
//
// All endpoints are tenant-isolated via `verifyMeasurementOrg`.

import { Router } from "express";
import { z } from "zod";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "./db";
import {
  takeoffMeasurements,
  takeoffSheets,
  bids,
  projects,
  changeOrders,
} from "@shared/schema";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { logAudit } from "./auditLogger";
import { resolveNetAreaFt2 } from "./services/takeoff/measurementDeductions";

const router = Router();

interface MeasurementScopeContext {
  orgId: string;
  bidId: string | null;
  projectId: string | null;
}

async function getMeasurementScopeContext(
  measurementId: string,
): Promise<MeasurementScopeContext | null> {
  const [m] = await db
    .select({ sheetId: takeoffMeasurements.sheetId })
    .from(takeoffMeasurements)
    .where(eq(takeoffMeasurements.id, measurementId))
    .limit(1);
  if (!m) return null;
  const [s] = await db
    .select({ bidId: takeoffSheets.bidId, projectId: takeoffSheets.projectId })
    .from(takeoffSheets)
    .where(eq(takeoffSheets.id, m.sheetId))
    .limit(1);
  if (!s) return null;
  if (s.bidId) {
    const [b] = await db
      .select({ orgId: bids.gcOrganizationId })
      .from(bids)
      .where(eq(bids.id, s.bidId))
      .limit(1);
    if (!b?.orgId) return null;
    // Bids in this schema are not directly linked to a project
    // (project linkage happens at conversion time on the project
    // record itself), so we cannot enforce a project-match invariant
    // for bid-scoped measurements — only the org-match invariant.
    return { orgId: b.orgId, bidId: s.bidId, projectId: null };
  }
  if (s.projectId) {
    const [p] = await db
      .select({ orgId: projects.gcOrganizationId })
      .from(projects)
      .where(eq(projects.id, s.projectId))
      .limit(1);
    if (!p?.orgId) return null;
    return { orgId: p.orgId, bidId: null, projectId: s.projectId };
  }
  return null;
}

const scopeBodySchema = z
  .object({
    scopeTag: z.enum(["BASE", "CO"]),
    changeOrderId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    // Trustworthiness invariant: a CO-scoped measurement MUST be tied
    // to a specific change order. Without it the BASE-vs-CO rollup
    // becomes meaningless ("ghost" CO line items with no parent).
    if (data.scopeTag === "CO" && !data.changeOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changeOrderId"],
        message: "changeOrderId is required when scopeTag is 'CO'",
      });
    }
    // BASE measurements must NOT carry a changeOrderId — silently
    // ignoring it would let a stale CO link survive a "move back to
    // base bid" action.
    if (data.scopeTag === "BASE" && data.changeOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changeOrderId"],
        message: "changeOrderId must be null when scopeTag is 'BASE'",
      });
    }
  });

router.post(
  "/api/takeoff/measurements/:id/scope",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = scopeBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const ctx = await getMeasurementScopeContext(req.params.id);
      if (!ctx || ctx.orgId !== orgId) {
        return res.status(404).json({ error: "Measurement not found" });
      }

      if (parsed.data.scopeTag === "CO" && parsed.data.changeOrderId) {
        // The CO must (a) exist, (b) belong to the caller's org via its
        // project, and (c) align with this measurement's project — i.e.
        // you cannot tag a measurement from Project A onto a CO from
        // Project B even within the same tenant.
        const [co] = await db
          .select({ id: changeOrders.id, projectId: changeOrders.projectId })
          .from(changeOrders)
          .where(eq(changeOrders.id, parsed.data.changeOrderId))
          .limit(1);
        if (!co) return res.status(400).json({ error: "Invalid changeOrderId" });
        const [coProject] = await db
          .select({ orgId: projects.gcOrganizationId })
          .from(projects)
          .where(eq(projects.id, co.projectId))
          .limit(1);
        if (!coProject || coProject.orgId !== orgId) {
          return res.status(400).json({ error: "Invalid changeOrderId" });
        }
        if (ctx.projectId && co.projectId !== ctx.projectId) {
          return res.status(400).json({
            error: "Change order belongs to a different project than this measurement",
          });
        }
      }

      const [previous] = await db
        .select({
          scopeTag: takeoffMeasurements.scopeTag,
          changeOrderId: takeoffMeasurements.changeOrderId,
        })
        .from(takeoffMeasurements)
        .where(eq(takeoffMeasurements.id, req.params.id))
        .limit(1);

      const newChangeOrderId =
        parsed.data.scopeTag === "BASE" ? null : parsed.data.changeOrderId ?? null;

      const [updated] = await db
        .update(takeoffMeasurements)
        .set({
          scopeTag: parsed.data.scopeTag,
          changeOrderId: newChangeOrderId,
          updatedAt: new Date(),
        })
        .where(eq(takeoffMeasurements.id, req.params.id))
        .returning({
          id: takeoffMeasurements.id,
          scopeTag: takeoffMeasurements.scopeTag,
          changeOrderId: takeoffMeasurements.changeOrderId,
        });

      await logAudit(
        {
          userId: req.user!.id,
          entityType: "takeoff_measurement_scope",
          entityId: req.params.id,
          action: "UPDATE",
          oldValue: JSON.stringify(previous ?? {}),
          newValue: JSON.stringify({
            scopeTag: parsed.data.scopeTag,
            changeOrderId: newChangeOrderId,
          }),
        },
        req,
      );

      res.json(updated);
    } catch (err) {
      next(err);
    }
  },
);

interface RollupRow {
  measurementId: string;
  label: string;
  type: string;
  quantity: number;
  unit: string;
  unitCost: number | null;
  cost: number;
}

// Task #2588 — Bulk-move many takeoff measurements to a change order (or
// back to base bid) in one round-trip. The MeasurementTable surfaces a
// "Move N selected to…" toolbar action whenever 2+ rows are selected;
// without this endpoint the UI would have to fan out N per-row POSTs
// which (a) burns rate-limit budget on a routine batch action, and
// (b) leaves no clean way to half-rollback when one row in the batch
// fails validation.
//
// Same trustworthiness invariants as the per-row /scope route:
//   - CO scope MUST carry a changeOrderId; BASE scope MUST NOT.
//   - Every measurement must belong to the caller's org (tenant-iso).
//   - The target CO must belong to the same org and must align with
//     each measurement's project (cross-project tagging is rejected
//     for the whole batch — partial application would surprise the
//     estimator and corrupt the BASE/CO rollups).
//
// Route MUST be registered before any "/api/takeoff/measurements/:id"
// handler with a wildcard `:id` slot, but that route lives in
// `server/takeoffMeasurementRoutes.ts`; the literal "bulk-scope" path
// here is unique within this router so ordering against `/scope` is
// not a concern.
const bulkScopeBodySchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    scopeTag: z.enum(["BASE", "CO"]),
    changeOrderId: z.string().nullable().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.scopeTag === "CO" && !data.changeOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changeOrderId"],
        message: "changeOrderId is required when scopeTag is 'CO'",
      });
    }
    if (data.scopeTag === "BASE" && data.changeOrderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["changeOrderId"],
        message: "changeOrderId must be null when scopeTag is 'BASE'",
      });
    }
  });

router.post(
  "/api/takeoff/measurements/bulk-scope",
  requireAuth,
  requireRole("SUPER_ADMIN", "ADMIN", "MANAGER", "ESTIMATOR"),
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });
      const parsed = bulkScopeBodySchema.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

      const ids = Array.from(new Set(parsed.data.ids));

      // Resolve each measurement → (sheetId, bidId|projectId, orgId) in
      // a single join so we can enforce tenant + project alignment in
      // O(1) round-trips instead of N. We fan out to bids OR projects
      // depending on which one the sheet is anchored to (a sheet has
      // exactly one of bidId/projectId set in this schema).
      // Tenant-isolation note: we resolve the rows and their owning
      // org in a single join and then filter to *only* rows belonging
      // to the caller's org BEFORE doing any "did we find them all?"
      // bookkeeping. If we tested `rows.length !== ids.length` over
      // the unfiltered set and reported `missingIds`, the response
      // would leak the existence of foreign-org measurement ids
      // (anything present in the DB but in another tenant would be
      // absent from `missingIds`, telling the caller the id exists).
      // Rejecting on the org-filtered count with a generic error
      // closes that oracle.
      const rowsRaw = await db
        .select({
          id: takeoffMeasurements.id,
          sheetId: takeoffMeasurements.sheetId,
          scopeTag: takeoffMeasurements.scopeTag,
          changeOrderId: takeoffMeasurements.changeOrderId,
          bidId: takeoffSheets.bidId,
          projectId: takeoffSheets.projectId,
          bidOrgId: bids.gcOrganizationId,
          projectOrgId: projects.gcOrganizationId,
        })
        .from(takeoffMeasurements)
        .innerJoin(takeoffSheets, eq(takeoffSheets.id, takeoffMeasurements.sheetId))
        .leftJoin(bids, eq(bids.id, takeoffSheets.bidId))
        .leftJoin(projects, eq(projects.id, takeoffSheets.projectId))
        .where(inArray(takeoffMeasurements.id, ids));

      const rows = rowsRaw.filter((r) => {
        const rowOrg = r.bidId ? r.bidOrgId : r.projectId ? r.projectOrgId : null;
        return rowOrg === orgId;
      });

      if (rows.length !== ids.length) {
        // Generic 404 — do NOT list the per-id breakdown. We can't
        // distinguish "doesn't exist" from "exists in another tenant"
        // without leaking the latter, so we treat both the same.
        return res.status(404).json({ error: "One or more measurements were not found" });
      }

      const measurementProjectIds = new Set<string>();
      for (const r of rows) {
        if (r.projectId) measurementProjectIds.add(r.projectId);
      }

      const newChangeOrderId =
        parsed.data.scopeTag === "BASE" ? null : parsed.data.changeOrderId ?? null;

      if (parsed.data.scopeTag === "CO" && newChangeOrderId) {
        const [co] = await db
          .select({ id: changeOrders.id, projectId: changeOrders.projectId })
          .from(changeOrders)
          .where(eq(changeOrders.id, newChangeOrderId))
          .limit(1);
        if (!co) return res.status(400).json({ error: "Invalid changeOrderId" });
        const [coProject] = await db
          .select({ orgId: projects.gcOrganizationId })
          .from(projects)
          .where(eq(projects.id, co.projectId))
          .limit(1);
        if (!coProject || coProject.orgId !== orgId) {
          return res.status(400).json({ error: "Invalid changeOrderId" });
        }
        // Cross-project guard: every project-anchored measurement in
        // the batch must live on the same project as the target CO.
        // Bid-anchored measurements (no projectId) are exempt — they
        // share the same trade-off the per-row route accepts.
        for (const projId of measurementProjectIds) {
          if (projId !== co.projectId) {
            return res.status(400).json({
              error: "Change order belongs to a different project than one or more measurements",
            });
          }
        }
      }

      // Apply in a single transaction so a mid-batch failure rolls
      // back cleanly and the BASE/CO totals stay coherent.
      const updated = await db.transaction(async (tx) => {
        const out: Array<{ id: string; scopeTag: string; changeOrderId: string | null }> = [];
        for (const existing of rows) {
          const [row] = await tx
            .update(takeoffMeasurements)
            .set({
              scopeTag: parsed.data.scopeTag,
              changeOrderId: newChangeOrderId,
              updatedAt: new Date(),
            })
            .where(eq(takeoffMeasurements.id, existing.id))
            .returning({
              id: takeoffMeasurements.id,
              scopeTag: takeoffMeasurements.scopeTag,
              changeOrderId: takeoffMeasurements.changeOrderId,
            });
          if (row) out.push(row);
        }
        return out;
      });

      // One audit row per measurement so the trail mirrors the per-row
      // /scope endpoint — a SOC-2 reviewer can join bulk and per-row
      // scope changes by `entityType` without special-casing.
      for (const existing of rows) {
        await logAudit(
          {
            userId: req.user!.id,
            entityType: "takeoff_measurement_scope",
            entityId: existing.id,
            action: "UPDATE",
            oldValue: JSON.stringify({
              scopeTag: existing.scopeTag,
              changeOrderId: existing.changeOrderId,
            }),
            newValue: JSON.stringify({
              scopeTag: parsed.data.scopeTag,
              changeOrderId: newChangeOrderId,
              bulk: true,
            }),
          },
          req,
        );
      }

      res.json({
        updatedCount: updated.length,
        scopeTag: parsed.data.scopeTag,
        changeOrderId: newChangeOrderId,
        measurements: updated,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/api/change-orders/:coId/takeoff-rollup",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });

      // Tenant guard via the change order's project / org.
      const [co] = await db
        .select()
        .from(changeOrders)
        .where(eq(changeOrders.id, req.params.coId))
        .limit(1);
      if (!co) return res.status(404).json({ error: "Change order not found" });
      const [project] = await db
        .select({ orgId: projects.gcOrganizationId })
        .from(projects)
        .where(eq(projects.id, co.projectId))
        .limit(1);
      if (!project || project.orgId !== orgId) {
        return res.status(404).json({ error: "Change order not found" });
      }

      const measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(
          and(
            eq(takeoffMeasurements.scopeTag, "CO"),
            eq(takeoffMeasurements.changeOrderId, req.params.coId),
          ),
        );

      const rows: RollupRow[] = [];
      let total = 0;
      for (const m of measurements) {
        const unit = m.type === "AREA" ? "SF" : m.type === "LINEAR" ? "LF" : m.type === "VOLUME" ? "CY" : "EA";
        let qty = 0;
        if (m.type === "AREA") {
          const breakdown = resolveNetAreaFt2({
            grossAreaFt2: m.computedAreaFt2 ?? 0,
            rawDeductions: m.deductions ?? null,
            scalePxPerFoot: m.scaleAtCapturePxPerFoot ?? null,
          });
          qty = breakdown.netAreaFt2;
        } else if (m.type === "LINEAR") {
          qty = Number(m.computedLengthFt ?? 0);
        } else if (m.type === "VOLUME") {
          qty = Number(m.computedVolumeCy ?? 0);
        } else {
          qty = Number(m.count ?? 0);
        }
        const unitCost = m.unitCost == null ? null : Number(m.unitCost);
        const cost = unitCost ? qty * unitCost : 0;
        total += cost;
        rows.push({
          measurementId: m.id,
          label: m.label,
          type: m.type,
          quantity: Number(qty.toFixed(4)),
          unit,
          unitCost,
          cost: Number(cost.toFixed(2)),
        });
      }

      res.json({
        changeOrderId: req.params.coId,
        measurementCount: rows.length,
        rows,
        rollupCost: Number(total.toFixed(2)),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/api/bids/:bidId/takeoff/measurements-by-scope",
  requireAuth,
  async (req: AuthRequest, res, next) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "No organization" });

      const [bid] = await db
        .select({ orgId: bids.gcOrganizationId })
        .from(bids)
        .where(eq(bids.id, req.params.bidId))
        .limit(1);
      if (!bid || bid.orgId !== orgId) return res.status(404).json({ error: "Bid not found" });

      const requested = String(req.query.scope ?? "ALL").toUpperCase();
      const scope = requested === "BASE" || requested === "CO" ? requested : "ALL";

      const sheets = await db
        .select({ id: takeoffSheets.id })
        .from(takeoffSheets)
        .where(eq(takeoffSheets.bidId, req.params.bidId));
      const sheetIds = sheets.map((s) => s.id);
      if (sheetIds.length === 0) return res.json({ scope, measurements: [] });

      const conds = [sql`${takeoffMeasurements.sheetId} = ANY(${sheetIds})`];
      if (scope !== "ALL") {
        conds.push(sql`${takeoffMeasurements.scopeTag} = ${scope}`);
      }
      const measurements = await db
        .select()
        .from(takeoffMeasurements)
        .where(and(...conds));
      res.json({ scope, measurements });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
