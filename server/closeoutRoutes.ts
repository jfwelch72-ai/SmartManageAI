import { Router, type Response, type NextFunction } from "express";
import { db } from "./db";
import {
  closeoutTemplates,
  closeoutTemplateItems,
  closeoutChecklists,
  closeoutItems,
  closeoutPackages,
  type CloseoutItem,
  type CloseoutTemplate,
  projects,
  warrantyDocuments,
  lienWaivers,
  projectPermits,
  punchListItems,
  projectInspections,
  assetHandoverItems,
  planDocuments,
} from "@shared/schema";
import { eq, desc, sql, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { exportLimiter } from "./rateLimiter";
import { logAudit } from "./auditLogger";
import { getOrgIdForFilter } from "./orgFilter";
import { logError } from "./utils/logger";
import archiver from "archiver";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";
import { createHash } from "crypto";
import { objectStorageClient, ObjectStorageService } from "./objectStorage";
import { getCorrelationId } from "./middleware/correlationId";

const router = Router();

const MGMT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "SUPERINTENDENT"] as const;

// ─── DEFAULT TEMPLATE SEED ────────────────────────────────────────────────────

const DEFAULT_TEMPLATE_ITEMS: Array<{
  category: CloseoutItem["category"];
  title: string;
  description?: string;
  required?: boolean;
  autoSource?: string;
}> = [
  { category: "OM_MANUAL", title: "Operations & Maintenance manuals", description: "Compiled O&M manuals for all installed systems.", autoSource: "warranty_documents" },
  { category: "WARRANTY", title: "Warranty certificates", description: "Manufacturer & contractor warranties for all major equipment.", autoSource: "warranty_documents" },
  { category: "AS_BUILT", title: "As-built drawings (record set)", description: "Final marked-up plan set reflecting actual installed conditions.", autoSource: "plan_documents" },
  { category: "ATTIC_STOCK", title: "Attic stock & spare parts log", description: "Inventory of spare materials handed over to owner." },
  { category: "TRAINING", title: "Owner training records", description: "Sign-in sheets and recordings for systems training." },
  { category: "LIEN_RELEASE", title: "Final lien releases", description: "Unconditional final lien waivers from GC and all subs.", autoSource: "lien_waivers" },
  { category: "FINAL_COI", title: "Final Certificate(s) of Insurance", description: "Final COI(s) per contract requirements." },
  { category: "PUNCH_LIST", title: "Closed punch list", description: "All punch list items resolved and verified.", autoSource: "punch_list" },
  { category: "INSPECTION", title: "Final inspections passed", description: "Certificate of Occupancy and authority-having-jurisdiction sign-offs.", autoSource: "inspections" },
  { category: "PERMIT", title: "Closed permits", description: "All permits closed with the issuing authority.", autoSource: "permits" },
];

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function escHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function getProjectByCodeForUser(code: string, req: AuthRequest, res: Response) {
  const [project] = await db.select().from(projects).where(eq(projects.code, code)).limit(1);
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return null;
  }
  const { shouldFilter, orgId, mustDenyAccess } = getOrgIdForFilter(req);
  if (mustDenyAccess) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  if (shouldFilter && orgId && project.gcOrganizationId !== orgId) {
    res.status(403).json({ error: "Access denied" });
    return null;
  }
  return project;
}

async function ensureChecklist(projectId: string, orgId: string, userId: string) {
  const [existing] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.projectId, projectId)).limit(1);
  if (existing) return existing;

  const [created] = await db.insert(closeoutChecklists).values({
    projectId,
    organizationId: orgId,
    name: "Project Closeout",
    createdById: userId,
  }).returning();
  return created;
}

// ─── TEMPLATE ROUTES ──────────────────────────────────────────────────────────

router.get("/api/closeout/templates", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { shouldFilter, orgId } = getOrgIdForFilter(req);
    if (!shouldFilter || !orgId) return res.json([]);

    const templates = await db.select().from(closeoutTemplates).where(eq(closeoutTemplates.organizationId, orgId)).orderBy(desc(closeoutTemplates.isDefault), closeoutTemplates.name);

    const ids = templates.map((t: CloseoutTemplate) => t.id);
    const items = ids.length
      ? await db.select().from(closeoutTemplateItems).where(inArray(closeoutTemplateItems.templateId, ids)).orderBy(closeoutTemplateItems.sortOrder)
      : [];

    const byTemplate = new Map<string, typeof items>();
    for (const it of items) {
      const arr = byTemplate.get(it.templateId) ?? [];
      arr.push(it);
      byTemplate.set(it.templateId, arr);
    }
    res.json(templates.map((t: CloseoutTemplate) => ({ ...t, items: byTemplate.get(t.id) ?? [] })));
  } catch (err) { next(err); }
});

router.post(
  "/api/closeout/templates",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const Body = z.object({
        name: z.string().min(1).max(120),
        projectType: z.string().max(80).optional(),
        description: z.string().max(2000).optional(),
        isDefault: z.boolean().optional(),
        items: z.array(z.object({
          category: z.string(),
          title: z.string().min(1).max(200),
          description: z.string().max(2000).optional(),
          required: z.boolean().optional(),
          autoSource: z.string().max(80).optional(),
          sortOrder: z.number().int().optional(),
        })).optional(),
      });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });

      const [tpl] = await db.insert(closeoutTemplates).values({
        organizationId: orgId,
        name: parsed.data.name,
        projectType: parsed.data.projectType ?? null,
        description: parsed.data.description ?? null,
        isDefault: parsed.data.isDefault ?? false,
        createdById: req.user!.id,
      }).returning();

      const seedItems: Array<{
        category: string;
        title: string;
        description?: string;
        required?: boolean;
        autoSource?: string;
        sortOrder?: number;
      }> = parsed.data.items?.length ? parsed.data.items : DEFAULT_TEMPLATE_ITEMS;

      const items = seedItems.map((it, i) => ({
        templateId: tpl.id,
        category: (it.category ?? "OTHER") as CloseoutItem["category"],
        title: it.title,
        description: it.description ?? null,
        required: it.required ?? true,
        autoSource: it.autoSource ?? null,
        sortOrder: it.sortOrder ?? i,
      }));
      if (items.length) await db.insert(closeoutTemplateItems).values(items);

      await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "closeoutTemplate", entityId: tpl.id }, req);
      res.status(201).json(tpl);
    } catch (err) { next(err); }
  },
);

router.delete(
  "/api/closeout/templates/:id",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const orgId = req.user!.organizationId;
      const [tpl] = await db.select().from(closeoutTemplates).where(eq(closeoutTemplates.id, req.params.id)).limit(1);
      if (!tpl || tpl.organizationId !== orgId) return res.status(404).json({ error: "Not found" });
      await db.delete(closeoutTemplates).where(eq(closeoutTemplates.id, req.params.id));
      await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "closeoutTemplate", entityId: req.params.id }, req);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ─── PER-PROJECT CHECKLIST ROUTES ─────────────────────────────────────────────

router.get("/api/projects/:code/closeout", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCodeForUser(req.params.code, req, res);
    if (!project) return;

    const [checklist] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.projectId, project.id)).limit(1);
    if (!checklist) return res.json({ checklist: null, items: [], packages: [] });

    const items = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id)).orderBy(closeoutItems.sortOrder, closeoutItems.createdAt);
    const packages = await db.select().from(closeoutPackages).where(eq(closeoutPackages.checklistId, checklist.id)).orderBy(desc(closeoutPackages.generatedAt)).limit(10);
    res.json({ checklist, items, packages });
  } catch (err) { next(err); }
});

router.get("/api/projects/:code/closeout/summary", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCodeForUser(req.params.code, req, res);
    if (!project) return;

    const [checklist] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.projectId, project.id)).limit(1);
    if (!checklist) {
      return res.json({
        hasChecklist: false,
        total: 0, complete: 0, ready: 0, pending: 0, overdue: 0, percent: 0,
        byCategory: [],
      });
    }

    const items = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id));
    const now = Date.now();
    const total = items.length;
    const complete = items.filter((i) => i.status === "COMPLETE" || i.status === "WAIVED").length;
    const ready = items.filter((i) => i.status === "READY").length;
    const pending = items.filter((i) => i.status === "PENDING" || i.status === "IN_PROGRESS").length;
    const overdue = items.filter((i) => i.dueDate && i.status !== "COMPLETE" && i.status !== "WAIVED" && new Date(i.dueDate).getTime() < now).length;

    const catMap = new Map<string, { total: number; complete: number }>();
    for (const it of items) {
      const e = catMap.get(it.category) ?? { total: 0, complete: 0 };
      e.total += 1;
      if (it.status === "COMPLETE" || it.status === "WAIVED") e.complete += 1;
      catMap.set(it.category, e);
    }

    res.json({
      hasChecklist: true,
      checklistId: checklist.id,
      total, complete, ready, pending, overdue,
      percent: total > 0 ? Math.round((complete / total) * 100) : 0,
      byCategory: Array.from(catMap.entries()).map(([category, v]) => ({ category, ...v })),
    });
  } catch (err) { next(err); }
});

router.post(
  "/api/projects/:code/closeout/init",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;
      const orgId = req.user!.organizationId;
      if (!orgId) return res.status(403).json({ error: "Organization required" });

      const Body = z.object({ templateId: z.string().optional() });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed" });

      const checklist = await ensureChecklist(project.id, orgId, req.user!.id);

      // Determine template items
      let tplItems: Array<{
        category: CloseoutItem["category"]; title: string; description: string | null;
        required: boolean; autoSource: string | null; sortOrder: number;
      }>;
      if (parsed.data.templateId) {
        const [tpl] = await db.select().from(closeoutTemplates).where(eq(closeoutTemplates.id, parsed.data.templateId)).limit(1);
        if (!tpl || tpl.organizationId !== orgId) return res.status(404).json({ error: "Template not found" });
        const rows = await db.select().from(closeoutTemplateItems).where(eq(closeoutTemplateItems.templateId, tpl.id)).orderBy(closeoutTemplateItems.sortOrder);
        tplItems = rows.map((r) => ({
          category: r.category, title: r.title, description: r.description,
          required: r.required, autoSource: r.autoSource, sortOrder: r.sortOrder,
        }));
        await db.update(closeoutChecklists).set({ templateId: tpl.id, updatedAt: new Date() }).where(eq(closeoutChecklists.id, checklist.id));
      } else {
        tplItems = DEFAULT_TEMPLATE_ITEMS.map((it, i) => ({
          category: it.category, title: it.title, description: it.description ?? null,
          required: it.required ?? true, autoSource: it.autoSource ?? null, sortOrder: i,
        }));
      }

      // Skip items already present (by title + category) to be re-runnable.
      const existing = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id));
      const seen = new Set(existing.map((e) => `${e.category}|${e.title}`));

      const toInsert = tplItems
        .filter((t) => !seen.has(`${t.category}|${t.title}`))
        .map((t) => ({
          checklistId: checklist.id,
          projectId: project.id,
          category: t.category,
          title: t.title,
          description: t.description,
          required: t.required,
          autoSource: t.autoSource,
          sortOrder: t.sortOrder,
        }));

      if (toInsert.length) await db.insert(closeoutItems).values(toInsert);

      await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "closeoutChecklist", entityId: checklist.id, newValue: JSON.stringify({ added: toInsert.length }) }, req);

      const items = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id)).orderBy(closeoutItems.sortOrder);
      res.json({ checklist, items });
    } catch (err) { next(err); }
  },
);

router.post(
  "/api/projects/:code/closeout/items",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;
      const orgId = req.user!.organizationId!;
      const checklist = await ensureChecklist(project.id, orgId, req.user!.id);

      const Body = z.object({
        category: z.string().optional(),
        title: z.string().min(1).max(200),
        description: z.string().max(2000).optional(),
        required: z.boolean().optional(),
        notes: z.string().max(4000).optional(),
        autoSource: z.string().max(80).optional(),
        sortOrder: z.number().int().optional(),
      });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });

      const [item] = await db.insert(closeoutItems).values({
        checklistId: checklist.id,
        projectId: project.id,
        category: (parsed.data.category ?? "OTHER") as CloseoutItem["category"],
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        required: parsed.data.required ?? true,
        notes: parsed.data.notes ?? null,
        autoSource: parsed.data.autoSource ?? null,
        sortOrder: parsed.data.sortOrder ?? 0,
      }).returning();
      await logAudit({ userId: req.user!.id, action: "CREATE", entityType: "closeoutItem", entityId: item.id }, req);
      res.status(201).json(item);
    } catch (err) { next(err); }
  },
);

router.patch(
  "/api/projects/:code/closeout/items/:id",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;

      const [item] = await db.select().from(closeoutItems).where(eq(closeoutItems.id, req.params.id)).limit(1);
      if (!item || item.projectId !== project.id) return res.status(404).json({ error: "Not found" });

      const Body = z.object({
        title: z.string().min(1).max(200).optional(),
        description: z.string().max(2000).nullable().optional(),
        category: z.string().optional(),
        required: z.boolean().optional(),
        status: z.enum(["PENDING", "IN_PROGRESS", "READY", "COMPLETE", "WAIVED"]).optional(),
        assignedToUserId: z.string().nullable().optional(),
        dueDate: z.string().nullable().optional(),
        notes: z.string().max(4000).nullable().optional(),
        sortOrder: z.number().int().optional(),
        attachments: z.array(z.object({
          url: z.string(), filename: z.string(), mimeType: z.string().optional(),
          uploadedAt: z.string(), uploadedById: z.string().optional(),
        })).optional(),
      });
      const parsed = Body.safeParse(req.body);
      if (!parsed.success) return res.status(400).json({ error: "Validation failed", details: parsed.error.format() });

      const update: Partial<CloseoutItem> & { updatedAt: Date } = { updatedAt: new Date() };
      if (parsed.data.title !== undefined) update.title = parsed.data.title;
      if (parsed.data.description !== undefined) update.description = parsed.data.description;
      if (parsed.data.category !== undefined) update.category = parsed.data.category as CloseoutItem["category"];
      if (parsed.data.required !== undefined) update.required = parsed.data.required;
      if (parsed.data.assignedToUserId !== undefined) update.assignedToUserId = parsed.data.assignedToUserId;
      if (parsed.data.dueDate !== undefined) update.dueDate = parsed.data.dueDate ? new Date(parsed.data.dueDate) : null;
      if (parsed.data.notes !== undefined) update.notes = parsed.data.notes;
      if (parsed.data.sortOrder !== undefined) update.sortOrder = parsed.data.sortOrder;
      if (parsed.data.attachments !== undefined) update.attachments = parsed.data.attachments;
      if (parsed.data.status !== undefined) {
        update.status = parsed.data.status;
        if (parsed.data.status === "COMPLETE" || parsed.data.status === "WAIVED") {
          update.completedAt = new Date();
          update.completedById = req.user!.id;
        } else {
          update.completedAt = null;
          update.completedById = null;
        }
      }

      const [updated] = await db.update(closeoutItems).set(update).where(eq(closeoutItems.id, req.params.id)).returning();
      await logAudit({ userId: req.user!.id, action: "UPDATE", entityType: "closeoutItem", entityId: updated.id }, req);
      res.json(updated);
    } catch (err) { next(err); }
  },
);

router.delete(
  "/api/projects/:code/closeout/items/:id",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;
      const [item] = await db.select().from(closeoutItems).where(eq(closeoutItems.id, req.params.id)).limit(1);
      if (!item || item.projectId !== project.id) return res.status(404).json({ error: "Not found" });
      await db.delete(closeoutItems).where(eq(closeoutItems.id, req.params.id));
      await logAudit({ userId: req.user!.id, action: "DELETE", entityType: "closeoutItem", entityId: item.id }, req);
      res.status(204).send();
    } catch (err) { next(err); }
  },
);

// ─── AUTO-PULL FROM PROJECT ARTIFACTS ─────────────────────────────────────────

router.post(
  "/api/projects/:code/closeout/auto-pull",
  requireAuth,
  requireRole(...MGMT_ROLES),
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;
      const orgId = req.user!.organizationId!;
      const checklist = await ensureChecklist(project.id, orgId, req.user!.id);

      const items = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id));

      // Pull each artifact set in parallel.
      const [warrantyDocs, lws, prms, plis, insps, asBuilts, handover] = await Promise.all([
        db.select().from(warrantyDocuments).where(eq(warrantyDocuments.projectId, project.id)),
        db.select().from(lienWaivers).where(eq(lienWaivers.projectId, project.id)),
        db.select().from(projectPermits).where(eq(projectPermits.projectId, project.id)),
        db.select().from(punchListItems).where(eq(punchListItems.projectId, project.id)),
        db.select().from(projectInspections).where(eq(projectInspections.projectId, project.id)),
        db.select().from(planDocuments).where(eq(planDocuments.projectId, project.id)),
        db.select().from(assetHandoverItems).where(eq(assetHandoverItems.projectId, project.id)),
      ]);

      // Bucket by category for fast lookup.
      const bucketByCategory: Record<string, Array<{ type: string; refId?: string; label: string; url?: string }>> = {
        WARRANTY: warrantyDocs.map((d) => ({ type: "warranty_document", refId: d.id, label: d.title, url: d.url })),
        OM_MANUAL: warrantyDocs.filter((d) => /manual|o&m/i.test(d.title)).map((d) => ({ type: "warranty_document", refId: d.id, label: d.title, url: d.url })),
        LIEN_RELEASE: lws.map((w) => ({
          type: "lien_waiver", refId: w.id,
          label: `${w.waiverType} – ${w.recipientName}${w.recipientCompany ? ` (${w.recipientCompany})` : ""}`,
          url: w.documentUrl ?? undefined,
        })),
        PERMIT: prms.map((p) => ({ type: "permit", refId: p.id, label: `${p.permitType} – ${p.permitNumber ?? p.id} (${p.status})` })),
        INSPECTION: insps.map((i) => ({ type: "inspection", refId: i.id, label: `${i.inspectionType}${i.scheduledDate ? ` – ${new Date(i.scheduledDate).toLocaleDateString()}` : ""}` })),
        PUNCH_LIST: plis.map((i) => ({ type: "punch_list_item", refId: i.id, label: `${i.itemNumber}: ${i.title}` })),
        AS_BUILT: asBuilts.filter((p) => /as[- ]?built/i.test(p.fileName ?? "") || /as[- ]?built/i.test(p.title ?? "")).map((p) => ({ type: "plan_document", refId: p.id, label: p.fileName ?? p.title ?? "As-built", url: p.fileUrl ?? undefined })),
      };

      // Also include the legacy "asset_handover_items" as references where appropriate.
      for (const h of handover) {
        const cat = h.category?.toUpperCase();
        if (cat && bucketByCategory[cat]) {
          bucketByCategory[cat].push({ type: "handover_item", refId: h.id, label: h.title, url: h.documentUrl ?? undefined });
        }
      }

      let updatedCount = 0;
      for (const it of items) {
        const sources = bucketByCategory[it.category] ?? [];
        if (!sources.length) continue;

        // Special-case PUNCH_LIST: mark complete only when all open items are resolved/verified.
        let nextStatus: CloseoutItem["status"] = it.status;
        if (it.category === "PUNCH_LIST") {
          const open = plis.filter((p) => p.status !== "VERIFIED" && p.status !== "REJECTED");
          if (plis.length > 0 && open.length === 0 && it.status === "PENDING") nextStatus = "READY";
        } else if (sources.length > 0 && it.status === "PENDING") {
          nextStatus = "READY";
        }

        await db.update(closeoutItems).set({
          sources,
          status: nextStatus,
          updatedAt: new Date(),
        }).where(eq(closeoutItems.id, it.id));
        updatedCount += 1;
      }

      await logAudit({ userId: req.user!.id, action: "UPDATE", entityType: "closeoutChecklist", entityId: checklist.id, newValue: JSON.stringify({ autoPullUpdated: updatedCount }) }, req);

      const refreshed = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id)).orderBy(closeoutItems.sortOrder);
      res.json({ updatedCount, items: refreshed });
    } catch (err) { next(err); }
  },
);

// ─── ZIP / TOC EXPORT ─────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  OM_MANUAL: "Operations & Maintenance Manuals",
  WARRANTY: "Warranties",
  AS_BUILT: "As-Built Drawings",
  ATTIC_STOCK: "Attic Stock & Spares",
  TRAINING: "Owner Training Records",
  LIEN_RELEASE: "Final Lien Releases",
  FINAL_COI: "Final Certificates of Insurance",
  PUNCH_LIST: "Punch List",
  INSPECTION: "Final Inspections",
  PERMIT: "Closed Permits",
  OTHER: "Other Closeout Documents",
};

async function generateTocPdf(project: { name: string; code: string }, items: CloseoutItem[]): Promise<Buffer> {
  return await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 54 });
    const stream = new PassThrough();
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
    doc.pipe(stream);

    doc.fontSize(20).text("Project Closeout Package", { align: "center" });
    doc.moveDown(0.4).fontSize(12).fillColor("#475569")
      .text(`${project.name}  ·  ${project.code}`, { align: "center" });
    doc.moveDown(0.2).fontSize(10).fillColor("#64748b")
      .text(`Generated ${new Date().toLocaleString()}`, { align: "center" });
    doc.moveDown(1.5);

    doc.fillColor("#0f172a").fontSize(16).text("Table of Contents", { underline: false });
    doc.moveDown(0.5);

    // Group by category.
    const byCat = new Map<string, CloseoutItem[]>();
    for (const it of items) {
      const arr = byCat.get(it.category) ?? [];
      arr.push(it);
      byCat.set(it.category, arr);
    }

    const orderedCats = Object.keys(CATEGORY_LABEL).filter((k) => byCat.has(k));
    let section = 1;
    for (const cat of orderedCats) {
      const list = byCat.get(cat)!;
      doc.fontSize(13).fillColor("#0f172a").text(`${section}. ${CATEGORY_LABEL[cat] ?? cat}`);
      doc.moveDown(0.2);
      let n = 1;
      for (const it of list) {
        const status = it.status;
        const fileCount = (it.attachments?.length ?? 0) + (it.sources?.filter((s) => s.url).length ?? 0);
        doc.fontSize(10).fillColor("#334155")
          .text(`   ${section}.${n}  ${it.title}  —  ${status}${fileCount ? `  (${fileCount} file${fileCount !== 1 ? "s" : ""})` : ""}`, { continued: false });
        if (it.notes) {
          doc.fontSize(9).fillColor("#64748b").text(`        ${it.notes.slice(0, 200)}`);
          doc.fillColor("#334155");
        }
        n += 1;
      }
      doc.moveDown(0.6);
      section += 1;
    }

    // Summary
    doc.moveDown(1).fontSize(10).fillColor("#64748b");
    const total = items.length;
    const complete = items.filter((i) => i.status === "COMPLETE" || i.status === "WAIVED").length;
    doc.text(`Total items: ${total}    Complete: ${complete}    Outstanding: ${total - complete}`);

    doc.end();
  });
}

/**
 * SSRF-safe downloader for closeout exports. Only accepts references that
 * resolve to objects inside our own GCS buckets — never performs an arbitrary
 * outbound HTTP fetch. Three accepted shapes:
 *   1) `gs://<bucket>/<objectName>`
 *   2) `https://storage.googleapis.com/<bucket>/<objectName>`
 *   3) `/objects/<objectName>` or `/<bucket>/<objectName>` rooted under the
 *      configured PRIVATE_OBJECT_DIR.
 * Anything else (other hosts, http://, file://, raw IPs, query-string-only
 * signed URLs, etc.) is rejected. We then read the object via the
 * authenticated `objectStorageClient` rather than hitting any HTTP endpoint
 * directly, which eliminates the SSRF vector entirely.
 */
/**
 * Resolve `${PRIVATE_OBJECT_DIR}` (which is shaped `<bucket>/<keyPrefix?>`)
 * into separate bucket and prefix parts. Returns null if not configured.
 */
function getPrivateBucketParts(): { bucket: string; prefix: string } | null {
  const raw = (process.env.PRIVATE_OBJECT_DIR || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!raw) return null;
  const slash = raw.indexOf("/");
  if (slash < 0) return { bucket: raw, prefix: "" };
  return { bucket: raw.slice(0, slash), prefix: raw.slice(slash + 1) };
}

/**
 * Build the only object-key prefix that an org is allowed to read from when
 * assembling a closeout export. This is `<privateDirPrefix>/<orgId>/` — the
 * same scheme used by every server-side writer (e.g. assetHandover,
 * warrantyDocuments, lien waivers). Anything outside this prefix is rejected.
 */
function getOrgObjectPrefix(orgId: string): { bucket: string; objectPrefix: string } | null {
  const parts = getPrivateBucketParts();
  if (!parts) return null;
  const { bucket, prefix } = parts;
  const objectPrefix = `${prefix ? prefix + "/" : ""}${orgId}/`;
  return { bucket, objectPrefix };
}

/**
 * SSRF + tenant-isolation safe parser. Resolves a stored attachment/source
 * URL to a concrete `{bucket, objectName}` only when:
 *   - It points at our private bucket (no foreign hosts, no http://, no
 *     file://, no IPs).
 *   - The resulting object key starts with the calling org's allowed
 *     prefix `<privatePrefix>/<orgId>/`.
 * All other inputs are rejected. Reads always go through the
 * authenticated `objectStorageClient`, never via raw HTTP fetch.
 */
function parseScopedGcsRef(rawUrl: string, orgId: string): { bucket: string; objectName: string } | null {
  if (!rawUrl || !orgId) return null;
  const scope = getOrgObjectPrefix(orgId);
  if (!scope) return null;
  const { bucket: allowedBucket, objectPrefix } = scope;

  let bucket: string | null = null;
  let objectName: string | null = null;

  if (rawUrl.startsWith("gs://")) {
    const rest = rawUrl.slice("gs://".length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;
    bucket = rest.slice(0, slash);
    objectName = rest.slice(slash + 1).split("?")[0] ?? null;
  } else if (rawUrl.startsWith("https://storage.googleapis.com/")) {
    let path: string;
    try {
      const u = new URL(rawUrl);
      if (u.hostname !== "storage.googleapis.com") return null;
      path = u.pathname.replace(/^\/+/, "");
    } catch {
      return null;
    }
    const slash = path.indexOf("/");
    if (slash <= 0) return null;
    bucket = path.slice(0, slash);
    objectName = path.slice(slash + 1);
  } else if (rawUrl.startsWith("/objects/")) {
    // App-relative shorthand for objects in PRIVATE_OBJECT_DIR.
    const parts = getPrivateBucketParts();
    if (!parts) return null;
    bucket = parts.bucket;
    const tail = rawUrl.replace(/^\/+/, "").split("?")[0]!;
    const key = tail.slice("objects/".length);
    objectName = parts.prefix ? `${parts.prefix}/${key}` : key;
  } else {
    return null;
  }

  if (!bucket || !objectName) return null;
  if (bucket !== allowedBucket) return null;
  if (!objectName.startsWith(objectPrefix)) return null;
  // Defense in depth: reject path traversal attempts.
  if (objectName.includes("..")) return null;

  return { bucket, objectName };
}

async function downloadObjectByUrl(url: string, orgId: string): Promise<Buffer | null> {
  try {
    const ref = parseScopedGcsRef(url, orgId);
    if (!ref) return null;
    const file = objectStorageClient.bucket(ref.bucket).file(ref.objectName);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [buf] = await file.download();
    return buf;
  } catch (err) {
    logError("closeout: failed to read object", { url }, err instanceof Error ? err : new Error(String(err)));
    return null;
  }
}

function safeFilename(s: string): string {
  return s.replace(/[^a-z0-9._-]+/gi, "_").slice(0, 120);
}

router.post(
  "/api/projects/:code/closeout/export",
  requireAuth,
  requireRole(...MGMT_ROLES),
  exportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;

      const exportOrgId = req.user!.organizationId;
      if (!exportOrgId) return res.status(403).json({ error: "Organization required" });

      const [checklist] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.projectId, project.id)).limit(1);
      if (!checklist) return res.status(404).json({ error: "No closeout checklist exists. Initialize one first." });
      if (checklist.organizationId !== exportOrgId) return res.status(403).json({ error: "Forbidden" });

      const items = await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id)).orderBy(closeoutItems.sortOrder);

      const filename = `closeout_${project.code}_${new Date().toISOString().slice(0, 10)}.zip`;

      const privateDir = process.env.PRIVATE_OBJECT_DIR;
      if (!privateDir) {
        return res.status(500).json({ error: "PRIVATE_OBJECT_DIR not configured" });
      }

      // ── 1) Pre-insert BUILDING placeholder row ──────────────────────────
      const [pkg] = await db.insert(closeoutPackages).values({
        checklistId: checklist.id,
        projectId: project.id,
        status: "BUILDING",
        filename,
        itemCount: items.length,
        fileCount: 0,
        generatedById: req.user!.id,
      }).returning();

      const correlationId = getCorrelationId();
      await logAudit({
        userId: req.user!.id,
        action: "CREATE",
        entityType: "closeoutPackage",
        entityId: pkg.id,
        newValue: JSON.stringify({ filename, itemCount: items.length, status: "BUILDING", correlationId }),
      }, req);

      try {
        // ── 2) Build the ZIP entirely into a buffer ───────────────────────
        const { buffer, fileCount } = await buildCloseoutZipBuffer({
          project: { name: project.name, code: project.code },
          items,
          orgId: exportOrgId,
        });

        // ── 3) Verify locally before any GCS write ─────────────────────────
        if (!hasZipEndOfCentralDirectory(buffer)) {
          throw new Error("ZIP integrity check failed (missing central directory)");
        }
        const fileSize = buffer.length;
        const checksum = createHash("sha256").update(buffer).digest("hex");

        // ── 4) Upload to TEMP key, then promote (copy) to FINAL key ────────
        const slashIdx = privateDir.indexOf("/");
        const bucketName = slashIdx > 0 ? privateDir.substring(0, slashIdx) : privateDir;
        const dirPrefix = slashIdx > 0 ? privateDir.substring(slashIdx + 1) : "";
        const finalObjectName = `${dirPrefix ? dirPrefix + "/" : ""}${exportOrgId}/closeout/${pkg.id}-${filename}`;
        const tempObjectName = `${dirPrefix ? dirPrefix + "/" : ""}${exportOrgId}/closeout/.tmp/${pkg.id}-${filename}`;
        const finalKey = `${bucketName}/${finalObjectName}`;

        const bucket = objectStorageClient.bucket(bucketName);
        const tempFile = bucket.file(tempObjectName);
        const finalFile = bucket.file(finalObjectName);

        try {
          await tempFile.save(buffer, {
            contentType: "application/zip",
            metadata: { metadata: { sha256: checksum, correlationId: correlationId ?? "" } },
          });
          // Promote: copy temp → final, then delete temp. Only after the
          // final-key copy returns success do we treat the package as
          // committed to GCS. A previously-good final-key object is only
          // overwritten on a successful copy of a verified buffer.
          await tempFile.copy(finalFile);
        } finally {
          // Always best-effort cleanup of the temp object.
          try { await tempFile.delete({ ignoreNotFound: true }); } catch (cleanupErr) {
            logError("closeout: temp key cleanup failed", { pkgId: pkg.id, tempObjectName }, cleanupErr instanceof Error ? cleanupErr : new Error(String(cleanupErr)));
          }
        }

        // ── 5) Stamp READY with checksum + size + completedAt ─────────────
        const completedAt = new Date();
        await db.update(closeoutPackages).set({
          status: "READY",
          storageKey: finalKey,
          fileSize,
          fileCount,
          checksum,
          completedAt,
          errorMessage: null,
        }).where(eq(closeoutPackages.id, pkg.id));

        await logAudit({
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "closeoutPackage",
          entityId: pkg.id,
          newValue: JSON.stringify({ status: "READY", filename, fileSize, fileCount, checksum, storageKey: finalKey, correlationId }),
        }, req);

        // ── 6) Mint a short-lived signed URL and return JSON to client ─────
        let downloadUrl: string | null = null;
        try {
          const svc = new ObjectStorageService();
          downloadUrl = await svc.getSignedDownloadUrl(finalFile, 300);
        } catch (signErr) {
          logError("closeout: failed to mint signed URL (package still READY)", { pkgId: pkg.id }, signErr instanceof Error ? signErr : new Error(String(signErr)));
        }

        return res.json({
          packageId: pkg.id,
          status: "READY",
          filename,
          fileSize,
          fileCount,
          checksum,
          completedAt: completedAt.toISOString(),
          downloadUrl,
          // Fallback if the client cannot use the signed URL directly.
          downloadEndpoint: `/api/projects/${project.code}/closeout/packages/${pkg.id}/download`,
        });
      } catch (buildErr) {
        const message = buildErr instanceof Error ? buildErr.message : String(buildErr);
        logError("closeout: export failed", { pkgId: pkg.id, correlationId }, buildErr instanceof Error ? buildErr : new Error(message));
        await db.update(closeoutPackages).set({
          status: "FAILED",
          errorMessage: message,
        }).where(eq(closeoutPackages.id, pkg.id));
        await logAudit({
          userId: req.user!.id,
          action: "UPDATE",
          entityType: "closeoutPackage",
          entityId: pkg.id,
          newValue: JSON.stringify({ status: "FAILED", error: message, correlationId }),
        }, req);
        if (!res.headersSent) {
          return res.status(500).json({ error: "Closeout export failed", message, packageId: pkg.id });
        }
        return;
      }
    } catch (err) { next(err); }
  },
);

// ── Download endpoint — 302 to a freshly minted signed URL after re-checking
// auth + org + that a verified READY package row exists. This is the
// authoritative delivery path; the client never reads from a live archiver
// stream.
router.get(
  "/api/projects/:code/closeout/packages/:pkgId/download",
  requireAuth,
  exportLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const project = await getProjectByCodeForUser(req.params.code, req, res);
      if (!project) return;

      const exportOrgId = req.user!.organizationId;
      if (!exportOrgId) return res.status(403).json({ error: "Organization required" });

      const [pkg] = await db.select().from(closeoutPackages).where(eq(closeoutPackages.id, req.params.pkgId)).limit(1);
      if (!pkg || pkg.projectId !== project.id) return res.status(404).json({ error: "Package not found" });

      // Cross-tenant safety: the package must belong to a checklist owned
      // by the caller's org.
      const [checklist] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.id, pkg.checklistId)).limit(1);
      if (!checklist || checklist.organizationId !== exportOrgId) return res.status(403).json({ error: "Forbidden" });

      if (
        pkg.status !== "READY" ||
        !pkg.storageKey ||
        pkg.fileSize == null ||
        !pkg.checksum ||
        !pkg.completedAt
      ) {
        return res.status(409).json({ error: "Package is not READY", status: pkg.status });
      }

      const slashIdx = pkg.storageKey.indexOf("/");
      if (slashIdx <= 0) return res.status(500).json({ error: "Malformed storageKey" });
      const bucketName = pkg.storageKey.substring(0, slashIdx);
      const objectName = pkg.storageKey.substring(slashIdx + 1);
      const file = objectStorageClient.bucket(bucketName).file(objectName);

      const svc = new ObjectStorageService();
      const url = await svc.getSignedDownloadUrl(file, 300);
      return res.redirect(302, url);
    } catch (err) { next(err); }
  },
);

// ── Helpers extracted from the export route so the build path is testable ──

async function buildCloseoutZipBuffer(opts: {
  project: { name: string; code: string };
  items: CloseoutItem[];
  orgId: string;
}): Promise<{ buffer: Buffer; fileCount: number }> {
  const { project, items, orgId } = opts;
  const archive = archiver("zip", { zlib: { level: 6 } });
  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on("data", (c: Buffer) => chunks.push(c));

  const finished = new Promise<void>((resolve, reject) => {
    archive.on("warning", (err) => logError("closeout zip warning", {}, err));
    archive.on("error", reject);
    sink.on("error", reject);
    sink.on("end", resolve);
  });
  archive.pipe(sink);

  const toc = await generateTocPdf(project, items);
  archive.append(toc, { name: "00_Table_Of_Contents.pdf" });

  const byCat = new Map<string, CloseoutItem[]>();
  for (const it of items) {
    const arr = byCat.get(it.category) ?? [];
    arr.push(it);
    byCat.set(it.category, arr);
  }

  let fileCount = 1;
  const orderedCats = Object.keys(CATEGORY_LABEL).filter((k) => byCat.has(k));
  let secIdx = 1;
  for (const cat of orderedCats) {
    const folder = `${String(secIdx).padStart(2, "0")}_${safeFilename(CATEGORY_LABEL[cat] ?? cat)}`;
    const list = byCat.get(cat)!;
    for (const it of list) {
      const lines: string[] = [];
      lines.push(`Title: ${it.title}`);
      lines.push(`Status: ${it.status}`);
      if (it.description) lines.push(`Description: ${it.description}`);
      if (it.notes) lines.push(`Notes: ${it.notes}`);
      if (it.dueDate) lines.push(`Due: ${new Date(it.dueDate).toLocaleDateString()}`);
      if (it.sources?.length) {
        lines.push("");
        lines.push("Linked references:");
        for (const s of it.sources) {
          lines.push(`  - [${s.type}] ${s.label}${s.url ? ` (${s.url})` : ""}`);
        }
      }
      const itemFolder = `${folder}/${safeFilename(it.title)}`;
      archive.append(lines.join("\n"), { name: `${itemFolder}/README.txt` });
      fileCount += 1;

      for (const att of (it.attachments ?? [])) {
        const buf = await downloadObjectByUrl(att.url, orgId);
        if (buf) {
          archive.append(buf, { name: `${itemFolder}/${safeFilename(att.filename || "file")}` });
          fileCount += 1;
        }
      }
      for (const src of (it.sources ?? [])) {
        if (!src.url) continue;
        const buf = await downloadObjectByUrl(src.url, orgId);
        if (buf) {
          const fn = safeFilename(src.label || `${src.type}.bin`);
          archive.append(buf, { name: `${itemFolder}/${fn}` });
          fileCount += 1;
        }
      }
    }
    secIdx += 1;
  }

  await archive.finalize();
  await finished;
  return { buffer: Buffer.concat(chunks), fileCount };
}

/**
 * Lightweight ZIP integrity check — locate the End of Central Directory
 * Record (EOCD) signature `PK\x05\x06` in the trailing 64 KiB of the
 * buffer. A truncated or corrupted archive will be missing it. This is
 * not a full structural validator, but it is sufficient to detect the
 * common failure modes (early-aborted finalize, half-written buffer).
 */
export function hasZipEndOfCentralDirectory(buf: Buffer): boolean {
  if (buf.length < 22) return false;
  const eocdSig = 0x06054b50; // little-endian "PK\x05\x06"
  // EOCD comment is up to 0xFFFF, so scan the trailing window.
  const start = Math.max(0, buf.length - (22 + 0xFFFF));
  for (let i = buf.length - 22; i >= start; i--) {
    if (buf.readUInt32LE(i) === eocdSig) return true;
  }
  return false;
}

// ─── PROJECT-LEVEL DASHBOARD SUMMARY (submittals + punch list + closeout) ─────

router.get("/api/projects/:code/closeout/dashboard", requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCodeForUser(req.params.code, req, res);
    if (!project) return;

    const now = Date.now();

    // Punch list summary
    const plis = await db.select().from(punchListItems).where(eq(punchListItems.projectId, project.id));
    const plOpen = plis.filter((p) => p.status === "OPEN" || p.status === "IN_PROGRESS").length;
    const plOverdue = plis.filter((p) => p.dueDate && p.status !== "VERIFIED" && p.status !== "REJECTED" && new Date(p.dueDate).getTime() < now).length;
    const plVerified = plis.filter((p) => p.status === "VERIFIED").length;

    // Closeout summary
    const [checklist] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.projectId, project.id)).limit(1);
    const items = checklist
      ? await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id))
      : [];
    const coComplete = items.filter((i) => i.status === "COMPLETE" || i.status === "WAIVED").length;

    // Submittal summary (lightweight count).
    const submittalSummary = await db.execute(
      sql`select count(*)::int as total,
                 count(*) filter (where status not in ('APPROVED', 'CLOSED', 'VOID')) as open,
                 count(*) filter (where date_required is not null and date_required < now() and status not in ('APPROVED', 'CLOSED', 'VOID')) as overdue
            from submittals where project_id = ${project.id}`,
    );
    const sRow = (submittalSummary.rows?.[0] as Record<string, unknown> | undefined) ?? {};
    const submittalsTotal = Number(sRow.total ?? 0);
    const submittalsOpen = Number(sRow.open ?? 0);
    const submittalsOverdue = Number(sRow.overdue ?? 0);

    res.json({
      project: { id: project.id, code: project.code, name: project.name },
      submittals: { total: submittalsTotal, open: submittalsOpen, overdue: submittalsOverdue },
      punchList: {
        total: plis.length,
        open: plOpen,
        overdue: plOverdue,
        verified: plVerified,
        percentComplete: plis.length > 0 ? Math.round(((plis.length - plOpen) / plis.length) * 100) : 0,
      },
      closeout: {
        hasChecklist: !!checklist,
        total: items.length,
        complete: coComplete,
        percentComplete: items.length > 0 ? Math.round((coComplete / items.length) * 100) : 0,
      },
    });
  } catch (err) { next(err); }
});

export default router;

// HTML printable export — renders the same table-of-contents the ZIP includes,
// but as a browser-printable page consistent with other modules' "export/pdf"
// pattern. Useful when the user just wants a status snapshot, not the full ZIP.
router.get("/api/projects/:code/closeout/export/pdf", requireAuth, exportLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const project = await getProjectByCodeForUser(req.params.code, req, res);
    if (!project) return;

    const [checklist] = await db.select().from(closeoutChecklists).where(eq(closeoutChecklists.projectId, project.id)).limit(1);
    const items = checklist
      ? await db.select().from(closeoutItems).where(eq(closeoutItems.checklistId, checklist.id)).orderBy(closeoutItems.sortOrder)
      : [];

    const byCat = new Map<string, CloseoutItem[]>();
    for (const it of items) {
      const arr = byCat.get(it.category) ?? [];
      arr.push(it);
      byCat.set(it.category, arr);
    }
    const orderedCats = Object.keys(CATEGORY_LABEL).filter((k) => byCat.has(k));

    const sections = orderedCats.map((cat, i) => `
      <h2>${i + 1}. ${escHtml(CATEGORY_LABEL[cat] ?? cat)}</h2>
      <table>
        <thead><tr><th>#</th><th>Title</th><th>Status</th><th>Files</th><th>Due</th><th>Notes</th></tr></thead>
        <tbody>
          ${byCat.get(cat)!.map((it, n) => {
            const fc = (it.attachments?.length ?? 0) + (it.sources?.filter((s) => s.url).length ?? 0);
            return `<tr>
              <td>${i + 1}.${n + 1}</td>
              <td>${escHtml(it.title)}</td>
              <td class="status-${escHtml(it.status)}">${escHtml(it.status)}</td>
              <td>${fc}</td>
              <td>${it.dueDate ? new Date(it.dueDate).toLocaleDateString() : ""}</td>
              <td>${escHtml(it.notes)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    `).join("");

    const total = items.length;
    const complete = items.filter((i) => i.status === "COMPLETE" || i.status === "WAIVED").length;

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8" />
      <title>Closeout – ${escHtml(project.name)}</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 11px; margin: 24px; color:#0f172a;}
        h1 { font-size: 20px; margin-bottom: 4px; }
        h2 { font-size: 13px; margin-top: 18px; }
        .meta { color:#64748b; margin-bottom: 14px; }
        table { width:100%; border-collapse: collapse; margin-bottom: 8px; }
        th { background:#1e293b; color:#fff; padding:6px 8px; text-align:left; font-size:10px;}
        td { padding:5px 8px; border-bottom:1px solid #e2e8f0; vertical-align: top; }
        tr:nth-child(even) td { background:#f8fafc; }
        .status-COMPLETE, .status-WAIVED { color:#166534; font-weight:bold; }
        .status-READY { color:#1d4ed8; }
        .status-IN_PROGRESS { color:#92400e; }
        .status-PENDING { color:#475569; }
        @media print { @page { margin: 12mm; } }
      </style></head><body>
      <h1>Project Closeout – ${escHtml(project.name)}</h1>
      <div class="meta">${escHtml(project.code)} · Generated ${new Date().toLocaleString()} · ${complete}/${total} complete</div>
      ${sections || "<p>No closeout checklist initialized yet.</p>"}
    </body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) { next(err); }
});
