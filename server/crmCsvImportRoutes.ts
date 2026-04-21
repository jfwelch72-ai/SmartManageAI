import { Router } from "express";
import { z } from "zod";
import { db, pool } from "./db";
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
    // The worker now stores the full error list per job. Cap what we return in
    // the listing to keep responses small; the full list is downloadable via
    // /api/crm/csv-imports/:id/errors.csv.
    const ERROR_PREVIEW_CAP = 100;
    const trimmed = rows.map((r) => {
      const errs = Array.isArray(r.errors) ? (r.errors as any[]) : [];
      return { ...r, errors: errs.slice(0, ERROR_PREVIEW_CAP) };
    });
    res.json(trimmed);
  } catch (e) { next(e); }
});

function csvEscape(val: unknown): string {
  if (val === null || val === undefined) return "";
  const s = typeof val === "string" ? val : String(val);
  if (s === "") return "";
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

router.get("/api/crm/csv-imports/:id/errors.csv", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  let client: import("pg").PoolClient | null = null;
  let cursorOpen = false;
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    // Look up the job (without loading the errors column) so we can set headers
    // and return 404 before opening a streaming cursor.
    const [job] = await db.select({
      id: crmCsvImportJobs.id,
      filename: crmCsvImportJobs.filename,
    }).from(crmCsvImportJobs).where(and(eq(crmCsvImportJobs.id, req.params.id), eq(crmCsvImportJobs.organizationId, orgId))).limit(1);
    if (!job) return res.status(404).json({ error: "Not found" });

    const safeName = (job.filename || `import-${job.id}`).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-errors.csv"`);

    // Track client disconnect so we can stop fetching/writing promptly and
    // avoid leaking the streaming transaction.
    let clientGone = false;
    const onClose = () => { clientGone = true; };
    res.on("close", onClose);

    // Backpressure-aware write: if the socket buffer is full, wait for it to
    // drain so memory stays roughly constant regardless of how many error rows
    // a job has. Race against close/error so a disconnected client doesn't
    // hang the request indefinitely.
    const safeWrite = async (chunk: string): Promise<boolean> => {
      if (clientGone) return false;
      if (res.write(chunk)) return true;
      await new Promise<void>((resolve) => {
        const cleanup = () => {
          res.off("drain", onDrain);
          res.off("close", onEnd);
          res.off("error", onEnd);
          resolve();
        };
        const onDrain = () => cleanup();
        const onEnd = () => { clientGone = true; cleanup(); };
        res.once("drain", onDrain);
        res.once("close", onEnd);
        res.once("error", onEnd);
      });
      return !clientGone;
    };

    // Stream rows from Postgres using a server-side cursor over
    // jsonb_array_elements(errors) so neither this process nor the JSON parser
    // ever has to materialize the full error list.
    const FETCH_BATCH = 500;
    client = await pool.connect();
    if (!(await safeWrite("row,column,value,error\r\n"))) {
      res.off("close", onClose);
      return;
    }
    await client.query("BEGIN");
    await client.query(
      `DECLARE crm_csv_err_cur NO SCROLL CURSOR FOR
         SELECT elem->>'row'    AS row,
                elem->>'column' AS col,
                elem->>'value'  AS value,
                elem->>'error'  AS error
         FROM "crm_csv_import_jobs" j,
              jsonb_array_elements(j.errors) AS elem
         WHERE j.id = $1 AND j.organization_id = $2`,
      [job.id, orgId],
    );
    cursorOpen = true;
    while (!clientGone) {
      const batch = await client.query(`FETCH ${FETCH_BATCH} FROM crm_csv_err_cur`);
      if (batch.rows.length === 0) break;
      let buf = "";
      for (const r of batch.rows) {
        buf +=
          [csvEscape(r.row ?? ""), csvEscape(r.col ?? ""), csvEscape(r.value ?? ""), csvEscape(r.error ?? "")].join(",") +
          "\r\n";
      }
      if (!(await safeWrite(buf))) break;
    }
    if (cursorOpen) {
      try { await client.query("CLOSE crm_csv_err_cur"); } catch {}
      cursorOpen = false;
    }
    await client.query("COMMIT");
    res.off("close", onClose);
    if (!clientGone) res.end();
  } catch (e) {
    if (client) {
      try { if (cursorOpen) await client.query("CLOSE crm_csv_err_cur"); } catch {}
      try { await client.query("ROLLBACK"); } catch {}
    }
    if (!res.headersSent) return next(e);
    // Headers already flushed; we can't send a JSON error, just terminate.
    try { res.destroy(e instanceof Error ? e : new Error(String(e))); } catch {}
  } finally {
    if (client) client.release();
  }
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
