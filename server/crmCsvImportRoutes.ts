import { Router } from "express";
import { z } from "zod";
import { db, pool } from "./db";
import {
  crmCsvImportJobs,
  crmContacts, crmOrganisations, crmOpportunities,
  crmCustomFieldDefinitions,
} from "@shared/schema";
import { and, eq, desc, inArray, asc } from "drizzle-orm";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { kickCrmCsvImportWorker } from "./crmCsvImportWorker";

const router = Router();
const READ_ROLES = ["ADMIN", "HUSTLER", "MANAGER", "ESTIMATOR"] as const;
const EDIT_ROLES = ["ADMIN", "HUSTLER", "MANAGER"] as const;

// Valid target fields per entity, kept in sync with crmCsvImportWorker.ts.
// Each entry: { value: schema field key the worker reads, label: human-friendly,
// type?: data-type hint shown in the mapping UI so users pair date/number Excel
// cells with typed targets, required?: at least one required field must be
// mapped to import a row }.
export type CsvImportFieldType = "text" | "date" | "number" | "boolean" | "multi";
export type CsvImportField = { value: string; label: string; required?: boolean; type?: CsvImportFieldType; custom?: boolean };
export const CSV_IMPORT_FIELDS: Record<"CONTACT" | "ORGANISATION" | "OPPORTUNITY", Array<CsvImportField>> = {
  CONTACT: [
    { value: "fullName", label: "Full name", required: true },
    { value: "firstName", label: "First name", required: true },
    { value: "lastName", label: "Last name" },
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
    { value: "title", label: "Title / role" },
    { value: "company", label: "Company / organisation" },
    { value: "birthday", label: "Birthday", type: "date" },
  ],
  ORGANISATION: [
    { value: "name", label: "Name", required: true },
    { value: "type", label: "Type (CONTRACTOR, SUBCONTRACTOR, …)" },
    { value: "website", label: "Website" },
    { value: "phone", label: "Phone" },
    { value: "address", label: "Address" },
    { value: "insuranceExpiration", label: "Insurance expiration", type: "date" },
    { value: "insuranceCoverageAmount", label: "Insurance coverage amount", type: "number" },
    { value: "licenseExpiration", label: "License expiration", type: "date" },
    { value: "contractExpiration", label: "Contract expiration", type: "date" },
  ],
  OPPORTUNITY: [
    { value: "name", label: "Name", required: true },
    { value: "stage", label: "Stage" },
    { value: "dealValue", label: "Deal value (expected revenue)", type: "number" },
    { value: "source", label: "Source" },
    { value: "expectedCloseDate", label: "Expected close date", type: "date" },
    { value: "probability", label: "Probability (%)", type: "number" },
  ],
};

// Map a custom-field-definition fieldType to the UI/worker type hint.
export function customFieldTypeHint(ft: string): CsvImportFieldType {
  switch (ft) {
    case "NUMBER":
    case "CURRENCY":
      return "number";
    case "DATE":
      return "date";
    case "CHECKBOX":
      return "boolean";
    case "MULTI_SELECT":
      return "multi";
    default:
      return "text";
  }
}

router.get("/api/crm/csv-imports/fields", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });

    const customDefs = await db.select().from(crmCustomFieldDefinitions)
      .where(and(
        eq(crmCustomFieldDefinitions.organizationId, orgId),
        eq(crmCustomFieldDefinitions.isActive, true),
      ))
      .orderBy(asc(crmCustomFieldDefinitions.entityType), asc(crmCustomFieldDefinitions.sortOrder), asc(crmCustomFieldDefinitions.label));

    const out: typeof CSV_IMPORT_FIELDS = {
      CONTACT: [...CSV_IMPORT_FIELDS.CONTACT],
      ORGANISATION: [...CSV_IMPORT_FIELDS.ORGANISATION],
      OPPORTUNITY: [...CSV_IMPORT_FIELDS.OPPORTUNITY],
    };
    for (const def of customDefs) {
      const bucket = def.entityType as keyof typeof out;
      if (!out[bucket]) continue;
      out[bucket].push({
        value: `cf:${def.id}`,
        label: def.label,
        type: customFieldTypeHint(def.fieldType),
        custom: true,
      });
    }
    res.json(out);
  } catch (e) { next(e); }
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
      parentJobId: crmCsvImportJobs.parentJobId,
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

// Build the union of CSV column headers across a list of source rows so the
// re-export preserves every original column the user uploaded.
function collectHeaders(rows: Array<Record<string, any>>, mapping: Record<string, string>): string[] {
  const seen = new Set<string>();
  const headers: string[] = [];
  // Prefer headers from the original mapping first so the column order is
  // stable / familiar.
  for (const k of Object.keys(mapping || {})) {
    if (!seen.has(k)) { seen.add(k); headers.push(k); }
  }
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); headers.push(k); }
    }
  }
  return headers;
}

router.get("/api/crm/csv-imports/:id/error-rows.csv", requireAuth, requireRole(...READ_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [job] = await db.select({
      id: crmCsvImportJobs.id,
      filename: crmCsvImportJobs.filename,
      mapping: crmCsvImportJobs.mapping,
      erroredSourceRows: crmCsvImportJobs.erroredSourceRows,
    }).from(crmCsvImportJobs).where(and(eq(crmCsvImportJobs.id, req.params.id), eq(crmCsvImportJobs.organizationId, orgId))).limit(1);
    if (!job) return res.status(404).json({ error: "Not found" });

    const rows = (Array.isArray(job.erroredSourceRows) ? job.erroredSourceRows : []) as Array<Record<string, any>>;
    const mapping = (job.mapping || {}) as Record<string, string>;
    const headers = collectHeaders(rows, mapping);

    const safeName = (job.filename || `import-${job.id}`).replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}-error-rows.csv"`);

    res.write(headers.map(csvEscape).join(",") + "\r\n");
    for (const r of rows) {
      res.write(headers.map((h) => csvEscape(r?.[h])).join(",") + "\r\n");
    }
    res.end();
  } catch (e) { next(e); }
});

const retryBody = z.object({
  // If `rows` is omitted, the server resubmits the parent job's stored
  // errored source rows verbatim. If provided, the user has uploaded a
  // (presumably corrected) version of those rows.
  rows: z.array(z.record(z.any())).max(50000).optional(),
  filename: z.string().optional(),
});

router.post("/api/crm/csv-imports/:id/retry", requireAuth, requireRole(...EDIT_ROLES), async (req: AuthRequest, res, next) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const parsed = retryBody.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: "Invalid input", details: parsed.error.errors });

    const [parent] = await db.select().from(crmCsvImportJobs).where(and(eq(crmCsvImportJobs.id, req.params.id), eq(crmCsvImportJobs.organizationId, orgId))).limit(1);
    if (!parent) return res.status(404).json({ error: "Not found" });
    if (parent.status === "PENDING" || parent.status === "PROCESSING") {
      return res.status(409).json({ error: "Cannot retry a job that is still running. Wait for it to finish." });
    }

    const rows = parsed.data.rows ?? ((parent.erroredSourceRows as any[]) || []);
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No errored rows available to retry. Download the error rows CSV, edit it, and re-upload it." });
    }

    const baseName = parsed.data.filename
      ?? (parent.filename ? `${parent.filename} (retry)` : `retry-${parent.id}`);

    const [job] = await db.insert(crmCsvImportJobs).values({
      organizationId: orgId,
      entityType: parent.entityType,
      status: "PENDING",
      filename: baseName,
      totalRows: rows.length,
      mapping: parent.mapping,
      payload: rows,
      parentJobId: parent.id,
      createdById: req.user!.id,
    } as any).returning();

    kickCrmCsvImportWorker();

    const { payload: _omit, ...response } = job as any;
    res.status(202).json(response);
  } catch (e) { next(e); }
});

export default router;
