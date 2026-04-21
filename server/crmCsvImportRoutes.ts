import { Router } from "express";
import { z } from "zod";
import { db } from "./db";
import {
  crmCsvImportJobs,
  crmContacts, crmOrganisations, crmOpportunities,
} from "@shared/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { kickCrmCsvImportWorker } from "./crmCsvImportWorker";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

// Valid target fields per entity, kept in sync with crmCsvImportWorker.ts.
// Each entry: { value: schema field key the worker reads, label: human-friendly,
// required?: at least one of the required fields must be mapped to import a row }.
export const CSV_IMPORT_FIELDS: Record<"CONTACT" | "ORGANISATION" | "OPPORTUNITY", Array<{ value: string; label: string; required?: boolean }>> = {
  CONTACT: [
    { value: "fullName", label: "Full name", required: true },
    { value: "firstName", label: "First name", required: true },
    { value: "lastName", label: "Last name" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "title", label: "Title / role" },
    { value: "company", label: "Company / organisation" },
  ],
  ORGANISATION: [
    { value: "name", label: "Name", required: true },
    { value: "type", label: "Type (CONTRACTOR, SUBCONTRACTOR, …)" },
    { value: "website", label: "Website" },
    { value: "phone", label: "Phone" },
    { value: "address", label: "Address" },
  ],
  OPPORTUNITY: [
    { value: "name", label: "Name", required: true },
    { value: "stage", label: "Stage" },
    { value: "dealValue", label: "Deal value" },
    { value: "source", label: "Source" },
  ],
};

router.get("/api/crm/csv-imports/fields", requireAuth, requireRole(...READ_ROLES), (_req, res) => {
  res.json(CSV_IMPORT_FIELDS);
});

const importBody = z.object({
  entityType: z.enum(["CONTACT", "ORGANISATION", "OPPORTUNITY"]),
  filename: z.string().optional(),
  mapping: z.record(z.string()).default({}),
  rows: z.array(z.record(z.any())).max(50000),
});

router.get("/api/crm/csv-imports", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select({
      id: crmCsvImportJobs.id,
      organizationId: crmCsvImportJobs.organizationId,
      entityType: crmCsvImportJobs.entityType,
      status: crmCsvImportJobs.status,
      filename: crmCsvImportJobs.filename,
      totalRows: crmCsvImportJobs.totalRows,
      processedRows: crmCsvImportJobs.processedRows,
      insertedRows: crmCsvImportJobs.insertedRows,
      updatedRows: crmCsvImportJobs.updatedRows,
      skippedRows: crmCsvImportJobs.skippedRows,
      errorRows: crmCsvImportJobs.errorRows,
      mapping: crmCsvImportJobs.mapping,
      errors: crmCsvImportJobs.errors,
      startedAt: crmCsvImportJobs.startedAt,
      createdAt: crmCsvImportJobs.createdAt,
      completedAt: crmCsvImportJobs.completedAt,
      // Deliberately omit `payload` and `insertedIds` from the listing to keep
      // the response small for large imports.
    }).from(crmCsvImportJobs).where(eq(crmCsvImportJobs.organizationId, orgId)).orderBy(desc(crmCsvImportJobs.createdAt)).limit(50);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/crm/csv-imports", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = importBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const { entityType, filename, mapping, rows } = parsed.data;

    // Enqueue the job and return immediately. The background worker
    // (server/crmCsvImportWorker.ts) will pick it up and process the rows.
    const [job] = await db.insert(crmCsvImportJobs).values({
      organizationId: orgId,
      entityType,
      status: "PENDING",
      filename: filename ?? null,
      totalRows: rows.length,
      mapping,
      payload: rows,
      createdById: req.user!.id,
    } as any).returning();

    // Fire-and-forget — wake the worker so it processes this job promptly even
    // if the polling tick hasn't fired yet (and works in dev where the global
    // scheduler is disabled).
    kickCrmCsvImportWorker();

    // Strip the (potentially large) payload from the response.
    const { payload: _omit, ...response } = job as any;
    res.status(202).json(response);
  } catch (e) { next(e); }
});

router.post("/api/crm/csv-imports/:id/revert", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [job] = await db.select().from(crmCsvImportJobs).where(and(eq(crmCsvImportJobs.id, req.params.id), eq(crmCsvImportJobs.organizationId, orgId))).limit(1);
    if (!job) return res.status(404).json({ error: "Not found" });
    if (job.status === "REVERTED") return res.json(job);
    if (job.status === "PENDING" || job.status === "PROCESSING") {
      return res.status(409).json({ error: "Cannot revert a job that is still running. Wait for it to finish." });
    }
    const ids = (job.insertedIds as string[]) || [];
    if (ids.length > 0) {
      // Delete in chunks to avoid overly large IN() lists when reverting big imports.
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        if (job.entityType === "CONTACT") await db.delete(crmContacts).where(and(eq(crmContacts.organizationId, orgId), inArray(crmContacts.id, chunk)));
        else if (job.entityType === "ORGANISATION") await db.delete(crmOrganisations).where(and(eq(crmOrganisations.organizationId, orgId), inArray(crmOrganisations.id, chunk)));
        else if (job.entityType === "OPPORTUNITY") await db.delete(crmOpportunities).where(and(eq(crmOpportunities.organizationId, orgId), inArray(crmOpportunities.id, chunk)));
      }
    }
    const [updated] = await db.update(crmCsvImportJobs).set({ status: "REVERTED", completedAt: new Date() } as any).where(eq(crmCsvImportJobs.id, job.id)).returning();
    const { payload: _omit, ...response } = updated as any;
    res.json(response);
  } catch (e) { next(e); }
});

export default router;
