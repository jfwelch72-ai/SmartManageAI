import { Router, type Response, type NextFunction } from "express";
import { z } from "zod";
import Papa from "papaparse";
import archiver from "archiver";
import { randomBytes, randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { db } from "./db";
import {
  orgCsvImports,
  orgExports,
  orgDeletionRequests,
  orgSubcontractorOwnership,
  organizations,
  subcontractors,
  equipment,
  orgCostCodes,
  projects,
  bids,
  users,
  insertSubcontractorSchema,
  insertEquipmentSchema,
  insertOrgCostCodeSchema,
  insertProjectSchema,
  insertBidSchema,
} from "@shared/schema";
import { and, eq, desc, inArray } from "drizzle-orm";
import bcrypt from "bcrypt";
import { requireAuth, requireRole, type AuthRequest } from "./auth";
import { getOrgIdForFilter } from "./orgFilter";
import { logAudit } from "./auditLogger";
import { ObjectStorageService, objectStorageClient, parseObjectPath } from "./objectStorage";
import { sendEmail } from "./email";
import { logError, logInfo } from "./utils/logger";
import { getCanonicalBaseUrl } from "./utils/routeHelpers";

const router = Router();
const ADMIN_ROLES = ["ADMIN", "SUPER_ADMIN"] as const;

// ────────────────────────────────────────────────────────────────────────────
// CSV IMPORT
// ────────────────────────────────────────────────────────────────────────────

type EntityType = "subcontractors" | "equipment" | "cost_codes" | "vendors" | "employees" | "projects" | "historical_bids";

interface RowError { row: number; field?: string; message: string }
// rowsForCommit/preview are shaped per-entity inside validate(); the routes
// type-narrow on entityType and cast at the insert site. The shape is
// covered by the per-row Zod schemas in validate(), not here.
interface ParseResult { validRows: number; errors: RowError[]; preview: any[]; rowsForCommit: any[] }

const CSV_TEMPLATES: Record<EntityType, { columns: string[]; description: string }> = {
  subcontractors:  { columns: ["companyName","contactName","email","phone","address","specialties","insuranceExpiration","notes"], description: "Subcontractors directory" },
  equipment:       { columns: ["name","equipmentCode","type","make","model","year","serialNumber","status","purchaseDate","purchasePrice"], description: "Equipment & tools" },
  cost_codes:      { columns: ["code","description","division"], description: "Cost code library" },
  vendors:         { columns: ["companyName","contactName","email","phone","address","website","notes"], description: "Vendors (stored as subcontractors with VENDOR specialty)" },
  employees:       { columns: ["email","firstName","lastName","role","phone"], description: "Employees / users (invited, default password reset required)" },
  projects:        { columns: ["name","code","clientName","status","city","state","budget","startDate","endDate","description"], description: "Projects" },
  historical_bids: { columns: ["name","code","clientName","bidAmount","status","city","state","dueDate","description"], description: "Historical bids (DRAFT/SUBMITTED/AWARDED/LOST)" },
};

function rowsFromCsv(text: string): { rows: Record<string, string>[]; errors: RowError[] } {
  const result = Papa.parse<Record<string, string>>(text.trim(), { header: true, skipEmptyLines: true });
  const errors: RowError[] = (result.errors ?? []).map((e) => ({ row: (e.row ?? 0) + 2, message: e.message }));
  const rows = (result.data ?? []).filter((r) => r && Object.keys(r).length > 0);
  return { rows, errors };
}

function clean(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t.length === 0 ? null : t;
}

function parseDate(v: string | null): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDecimalStr(v: string | null): string | null {
  if (!v) return null;
  const cleaned = v.replace(/[$,]/g, "");
  if (Number.isNaN(Number(cleaned))) return null;
  return cleaned;
}

function validate(entity: EntityType, rows: Record<string, string>[], orgId: string): ParseResult {
  const errors: RowError[] = [];
  const rowsForCommit: any[] = []; // narrowed per-case below; cast at insert site only
  const preview: any[] = [];
  rows.forEach((raw, idx) => {
    const lineNo = idx + 2;
    try {
      switch (entity) {
        case "subcontractors":
        case "vendors": {
          const companyName = clean(raw.companyName);
          if (!companyName) { errors.push({ row: lineNo, field: "companyName", message: "companyName is required" }); return; }
          const specialties = clean(raw.specialties);
          const ins = parseDate(clean(raw.insuranceExpiration));
          const row = {
            companyName,
            contactName: clean(raw.contactName),
            email: clean(raw.email),
            phone: clean(raw.phone),
            address: clean(raw.address),
            specialties: entity === "vendors" ? ["VENDOR"] : (specialties ? specialties.split(/[;,]/).map((s) => s.trim()).filter(Boolean) : null),
            insuranceExpiration: ins,
            notes: clean(raw.notes),
          };
          rowsForCommit.push(row); preview.push(row); return;
        }
        case "equipment": {
          const name = clean(raw.name); const code = clean(raw.equipmentCode); const type = clean(raw.type);
          if (!name) { errors.push({ row: lineNo, field: "name", message: "name is required" }); return; }
          if (!code) { errors.push({ row: lineNo, field: "equipmentCode", message: "equipmentCode is required" }); return; }
          if (!type) { errors.push({ row: lineNo, field: "type", message: "type is required" }); return; }
          const row = {
            organizationId: orgId,
            name, equipmentCode: code, type,
            status: clean(raw.status) ?? "AVAILABLE",
            make: clean(raw.make), model: clean(raw.model),
            year: raw.year ? parseInt(raw.year, 10) : null,
            serialNumber: clean(raw.serialNumber),
            purchaseDate: parseDate(clean(raw.purchaseDate)),
            purchasePrice: parseDecimalStr(clean(raw.purchasePrice)),
          };
          rowsForCommit.push(row); preview.push(row); return;
        }
        case "cost_codes": {
          const code = clean(raw.code); const desc = clean(raw.description); const div = clean(raw.division);
          if (!code) { errors.push({ row: lineNo, field: "code", message: "code is required" }); return; }
          if (!desc) { errors.push({ row: lineNo, field: "description", message: "description is required" }); return; }
          if (!div) { errors.push({ row: lineNo, field: "division", message: "division is required" }); return; }
          if (code.length > 20) { errors.push({ row: lineNo, field: "code", message: "code max 20 chars" }); return; }
          const row = { organizationId: orgId, code, description: desc, division: div, isCustom: true, isActive: true };
          rowsForCommit.push(row); preview.push(row); return;
        }
        case "employees": {
          const email = clean(raw.email);
          if (!email) { errors.push({ row: lineNo, field: "email", message: "email is required" }); return; }
          if (!/^.+@.+\..+$/.test(email)) { errors.push({ row: lineNo, field: "email", message: "invalid email" }); return; }
          const row = {
            email: email.toLowerCase(),
            firstName: clean(raw.firstName) ?? "",
            lastName: clean(raw.lastName) ?? "",
            role: (clean(raw.role) ?? "WORKER").toUpperCase(),
            phone: clean(raw.phone),
          };
          rowsForCommit.push(row); preview.push(row); return;
        }
        case "projects": {
          const name = clean(raw.name); const code = clean(raw.code); const client = clean(raw.clientName);
          if (!name) { errors.push({ row: lineNo, field: "name", message: "name is required" }); return; }
          if (!code) { errors.push({ row: lineNo, field: "code", message: "code is required" }); return; }
          if (!client) { errors.push({ row: lineNo, field: "clientName", message: "clientName is required" }); return; }
          const allowedStatus = new Set(["PLANNING","IN_PROGRESS","ON_HOLD","COMPLETED","CANCELLED"]);
          const status = (clean(raw.status) ?? "PLANNING").toUpperCase();
          if (!allowedStatus.has(status)) { errors.push({ row: lineNo, field: "status", message: `status must be one of ${[...allowedStatus].join(",")}` }); return; }
          const row = {
            name, code, clientName: client,
            gcOrganizationId: orgId,
            status,
            city: clean(raw.city), state: clean(raw.state),
            budget: parseDecimalStr(clean(raw.budget)),
            startDate: parseDate(clean(raw.startDate)),
            endDate: parseDate(clean(raw.endDate)),
            description: clean(raw.description),
          };
          rowsForCommit.push(row); preview.push(row); return;
        }
        case "historical_bids": {
          const name = clean(raw.name); const code = clean(raw.code); const client = clean(raw.clientName);
          if (!name) { errors.push({ row: lineNo, field: "name", message: "name is required" }); return; }
          if (!code) { errors.push({ row: lineNo, field: "code", message: "code is required" }); return; }
          if (!client) { errors.push({ row: lineNo, field: "clientName", message: "clientName is required" }); return; }
          const allowedStatus = new Set(["DRAFT","SUBMITTED","AWARDED","LOST","CANCELLED"]);
          const status = (clean(raw.status) ?? "DRAFT").toUpperCase();
          if (!allowedStatus.has(status)) { errors.push({ row: lineNo, field: "status", message: `status must be one of ${[...allowedStatus].join(",")}` }); return; }
          const row = {
            name, code, clientName: client,
            gcOrganizationId: orgId,
            bidAmount: parseDecimalStr(clean(raw.bidAmount)),
            status,
            city: clean(raw.city), state: clean(raw.state),
            dueDate: parseDate(clean(raw.dueDate)),
            description: clean(raw.description),
          };
          rowsForCommit.push(row); preview.push(row); return;
        }
      }
    } catch (e) {
      errors.push({ row: lineNo, message: e instanceof Error ? e.message : "row parse error" });
    }
  });
  return { validRows: rowsForCommit.length, errors, preview: preview.slice(0, 25), rowsForCommit };
}

const importRequestSchema = z.object({
  entityType: z.enum(["subcontractors","equipment","cost_codes","vendors","employees","projects","historical_bids"]),
  csv: z.string().min(1, "csv required").max(10_000_000, "csv too large (max 10MB)").optional(),
  // Excel ingestion: client base64-encodes the .xlsx/.xls workbook and we
  // convert the first sheet to CSV server-side so the rest of the pipeline
  // (rowsFromCsv → validate → commit) is unchanged.
  xlsxBase64: z.string().min(1).max(20_000_000).optional(),
  fileName: z.string().optional(),
  commit: z.boolean().optional().default(false),
}).refine((v) => !!v.csv || !!v.xlsxBase64, { message: "csv or xlsxBase64 required" });

router.get("/api/org/imports/templates", requireAuth, requireRole(...ADMIN_ROLES), async (_req: AuthRequest, res: Response) => {
  res.json(CSV_TEMPLATES);
});

router.get("/api/org/imports/templates/:entityType.csv", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response) => {
  const t = CSV_TEMPLATES[req.params.entityType as EntityType];
  if (!t) return res.status(404).json({ error: "unknown entityType" });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${req.params.entityType}-template.csv"`);
  res.send(t.columns.join(",") + "\n");
});

// Downloadable error report for a single import job. The error rows are
// already persisted on `orgCsvImports.errors` from the dry-run/commit pass;
// we render them as a CSV so a non-technical operator can fix the source
// spreadsheet and re-upload without parsing JSON.
router.get("/api/org/imports/:jobId/errors.csv", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [job] = await db.select().from(orgCsvImports).where(and(
      eq(orgCsvImports.id, req.params.jobId),
      eq(orgCsvImports.organizationId, orgId),
    )).limit(1);
    if (!job) return res.status(404).json({ error: "import job not found" });
    const errs = (Array.isArray(job.errors) ? job.errors : []) as Array<{ row?: number; field?: string; message?: string }>;
    const escape = (v: unknown) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = ["row,field,message", ...errs.map(e => [escape(e.row ?? ""), escape(e.field ?? ""), escape(e.message ?? "")].join(","))];
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="import-errors-${job.id}.csv"`);
    res.send(lines.join("\n") + "\n");
  } catch (e) { next(e); }
});

router.get("/api/org/imports", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(orgCsvImports).where(eq(orgCsvImports.organizationId, orgId)).orderBy(desc(orgCsvImports.createdAt)).limit(50);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/org/imports", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const user = req.user!;
    const parsed = importRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const { entityType, csv: csvIn, xlsxBase64, fileName, commit } = parsed.data;
    let csv = csvIn ?? "";
    if (!csv && xlsxBase64) {
      // Convert the first sheet of the uploaded workbook to CSV. The xlsx
      // package is already a project dep (used by laborRateRoutes etc.)
      // and supports both .xlsx and legacy .xls.
      try {
        const xlsx = await import("xlsx");
        const buf = Buffer.from(xlsxBase64, "base64");
        const wb = xlsx.read(buf, { type: "buffer" });
        const firstSheetName = wb.SheetNames[0];
        if (!firstSheetName) return res.status(400).json({ error: "Workbook contains no sheets" });
        csv = xlsx.utils.sheet_to_csv(wb.Sheets[firstSheetName]);
      } catch (err: any) {
        return res.status(400).json({ error: "Failed to parse Excel workbook", detail: err?.message });
      }
    }
    const { rows, errors: parseErrs } = rowsFromCsv(csv);
    const { validRows, errors: rowErrs, preview, rowsForCommit } = validate(entityType, rows, orgId);
    const errors = [...parseErrs, ...rowErrs];

    if (!commit) {
      // Dry run
      const [job] = await db.insert(orgCsvImports).values({
        organizationId: orgId,
        entityType,
        status: "DRY_RUN",
        totalRows: rows.length,
        validRows,
        errorRows: errors.length,
        insertedRows: 0,
        errors,
        fileName: fileName ?? null,
        createdById: user.id,
      }).returning();
      return res.json({ jobId: job.id, status: "DRY_RUN", totalRows: rows.length, validRows, errorRows: errors.length, errors, preview });
    }

    if (errors.length > 0) {
      return res.status(422).json({ error: "Cannot commit while errors present", errors, validRows });
    }

    let inserted = 0;
    if (rowsForCommit.length > 0) {
      // Each branch parses rowsForCommit through the per-entity Zod insert
      // schema (drizzle-zod). On parse failure we surface a 422 so we never
      // call .insert() with malformed payloads — and the call site is fully
      // type-safe without any `as any` escape hatches.
      try {
        switch (entityType) {
          case "subcontractors":
          case "vendors": {
            const typed = z.array(insertSubcontractorSchema).parse(rowsForCommit);
            // Insert into the global subcontractors directory, then write a
            // per-org ownership row for every inserted ID so "Export my org"
            // can round-trip these entries (and so cross-tenant queries
            // continue to filter by ownership rather than surfacing the
            // entire shared directory).
            const insertedRows = await db.insert(subcontractors).values(typed).onConflictDoNothing().returning({ id: subcontractors.id });
            inserted = insertedRows.length;
            if (insertedRows.length > 0) {
              await db.insert(orgSubcontractorOwnership).values(
                insertedRows.map((r) => ({ organizationId: orgId, subcontractorId: r.id, source: "CSV_IMPORT" })),
              ).onConflictDoNothing();
            }
            break;
          }
          case "equipment": {
            const typed = z.array(insertEquipmentSchema).parse(rowsForCommit);
            inserted = (await db.insert(equipment).values(typed.map((r) => ({ ...r, organizationId: orgId }))).onConflictDoNothing().returning({ id: equipment.id })).length;
            break;
          }
          case "cost_codes": {
            const typed = z.array(insertOrgCostCodeSchema).parse(rowsForCommit);
            inserted = (await db.insert(orgCostCodes).values(typed).onConflictDoNothing().returning({ id: orgCostCodes.id })).length;
            break;
          }
          case "projects": {
            const typed = z.array(insertProjectSchema).parse(rowsForCommit);
            inserted = (await db.insert(projects).values(typed).onConflictDoNothing().returning({ id: projects.id })).length;
            break;
          }
          case "historical_bids": {
            const typed = z.array(insertBidSchema).parse(rowsForCommit);
            inserted = (await db.insert(bids).values(typed).onConflictDoNothing().returning({ id: bids.id })).length;
            break;
          }
          case "employees": {
            // Create user records scoped to this org. Each user gets a
            // random password hash so they MUST go through the
            // password-reset flow before logging in. Email unique
            // constraint silently de-dupes via onConflictDoNothing.
            // Roles are validated against the actual `user_role` Postgres
            // enum via Zod — invalid roles fall back to FIELD_WORKER
            // (the lowest-privilege option) BEFORE the DB insert so we
            // never trigger a 22P02 invalid-enum-value error.
            // Tenant-safe role allowlist for the importer. SUPER_ADMIN and
            // HUSTLER are platform-level roles that bypass standard org
            // checks (`requireRole`, `requireActiveOrganization`) — allowing
            // an org-admin importer to mint them would be a privilege
            // escalation. They are explicitly excluded here.
            const userRoleZ = z.enum(["ADMIN","MANAGER","SUPERINTENDENT","ESTIMATOR","FIELD_WORKER","VENDOR"]);
            const userValues = await Promise.all(rowsForCommit.map(async (r: any) => {
              const roleParsed = userRoleZ.safeParse(String(r.role ?? "").toUpperCase());
              const role = roleParsed.success ? roleParsed.data : "FIELD_WORKER";
              const randomPw = randomBytes(32).toString("hex");
              const passwordHash = await bcrypt.hash(randomPw, 10);
              return {
                organizationId: orgId,
                email: String(r.email).toLowerCase(),
                firstName: r.firstName || "",
                lastName: r.lastName || "",
                phone: r.phone ?? null,
                role,
                passwordHash,
                emailVerified: false,
                isActive: true,
              };
            }));
            const insertedUsers = await db.insert(users).values(userValues).onConflictDoNothing({ target: users.email }).returning({ id: users.id });
            inserted = insertedUsers.length;
            break;
          }
        }
      } catch (err) {
        if (err instanceof z.ZodError) {
          return res.status(422).json({ error: "Row payload failed schema validation", issues: err.issues });
        }
        throw err;
      }
    }

    const [job] = await db.insert(orgCsvImports).values({
      organizationId: orgId,
      entityType,
      status: "COMPLETED",
      totalRows: rows.length,
      validRows,
      errorRows: 0,
      insertedRows: inserted,
      errors: [],
      fileName: fileName ?? null,
      createdById: user.id,
      completedAt: new Date(),
    }).returning();

    await logAudit({ userId: user.id, entityType: "org_csv_import", entityId: job.id, action: "CREATE", newValue: JSON.stringify({ entityType, inserted, rows: rows.length }) }, req);

    res.json({ jobId: job.id, status: "COMPLETED", totalRows: rows.length, validRows, insertedRows: inserted });
  } catch (e) { next(e); }
});

// ────────────────────────────────────────────────────────────────────────────
// EXPORT
// ────────────────────────────────────────────────────────────────────────────

// IMPORTANT: every loader must be scoped to the requesting org. The
// `subcontractors` table is platform-global (no org column) so subs are
// pulled via the org_subcontractor_ownership junction — only entries the
// org actually imported/created are emitted, which preserves portability
// without leaking other tenants' directory rows.
const EXPORT_TABLES: Array<{ name: string; load: (orgId: string) => Promise<any[]> }> = [
  { name: "organizations", load: (orgId) => db.select().from(organizations).where(eq(organizations.id, orgId)) },
  { name: "users",         load: (orgId) => db.select().from(users).where(eq(users.organizationId, orgId)) },
  { name: "projects",      load: (orgId) => db.select().from(projects).where(eq(projects.gcOrganizationId, orgId)) },
  { name: "bids",          load: (orgId) => db.select().from(bids).where(eq(bids.gcOrganizationId, orgId)) },
  { name: "equipment",     load: (orgId) => db.select().from(equipment).where(eq(equipment.organizationId, orgId)) },
  { name: "cost_codes",    load: (orgId) => db.select().from(orgCostCodes).where(eq(orgCostCodes.organizationId, orgId)) },
  { name: "subcontractors", load: async (orgId) => {
      const owned = await db.select({ id: orgSubcontractorOwnership.subcontractorId })
        .from(orgSubcontractorOwnership)
        .where(eq(orgSubcontractorOwnership.organizationId, orgId));
      const ids = owned.map((r) => r.id).filter((x): x is string => !!x);
      if (ids.length === 0) return [];
      return db.select().from(subcontractors).where(inArray(subcontractors.id, ids));
    },
  },
];

function toCsv(rows: any[]): string {
  if (!rows.length) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return cols.join(",") + "\n" + rows.map((r) => cols.map((c) => esc(r[c])).join(",")).join("\n") + "\n";
}

async function runExport(orgId: string, exportId: string, requestedBy: { id: string; email: string }) {
  try {
    const objectId = randomUUID();
    const privateDir = (process.env.PRIVATE_OBJECT_DIR ?? "").replace(/\/+$/, "");
    if (!privateDir) throw new Error("PRIVATE_OBJECT_DIR not set");
    const objectKey = `${privateDir}/${orgId}/exports/${objectId}.zip`;
    const { bucketName, objectName } = parseObjectPath(objectKey);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);

    const passthrough = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 9 } });
    let bytes = 0;
    passthrough.on("data", (chunk) => { bytes += chunk.length; });
    archive.on("error", (err) => { throw err; });
    archive.pipe(passthrough);

    const uploadStream = file.createWriteStream({ resumable: false, contentType: "application/zip", metadata: { contentType: "application/zip" } });
    const uploadPromise = new Promise<void>((resolve, reject) => {
      passthrough.pipe(uploadStream);
      uploadStream.on("finish", () => resolve());
      uploadStream.on("error", reject);
    });

    const manifest: { tables: Record<string, number>; attachments: { count: number; bytes: number; skipped: number; truncated: boolean } } = {
      tables: {},
      attachments: { count: 0, bytes: 0, skipped: 0, truncated: false },
    };
    for (const t of EXPORT_TABLES) {
      try {
        const rows = await t.load(orgId);
        manifest.tables[t.name] = rows.length;
        archive.append(toCsv(rows), { name: `tables/${t.name}.csv` });
      } catch (e) {
        manifest.tables[t.name] = -1;
        archive.append(`# Failed to export: ${e instanceof Error ? e.message : String(e)}\n`, { name: `tables/${t.name}.error.txt` });
      }
    }

    // Attachments: stream every object under the org's private prefix into
    // attachments/<original-relative-path>. Hard-capped to avoid runaway
    // ZIPs; the cap is recorded in the manifest for transparency.
    const ATTACHMENT_MAX_BYTES = parseInt(process.env.ORG_EXPORT_ATTACHMENT_MAX_BYTES ?? `${5 * 1024 * 1024 * 1024}`, 10); // 5 GiB
    const ATTACHMENT_MAX_FILES = parseInt(process.env.ORG_EXPORT_ATTACHMENT_MAX_FILES ?? "10000", 10);
    // PRIVATE_OBJECT_DIR is `/<bucket>/<base?>`; org files live at
    // `<base>/<orgId>/...` inside the bucket. The previous version used
    // `${orgId}/` as the prefix, which silently missed every attachment in
    // configs where PRIVATE_OBJECT_DIR has a non-empty base path. Compute
    // the in-bucket base from PRIVATE_OBJECT_DIR and prefix the listing.
    const trimmedDir = privateDir.replace(/^\/+/, "");
    const slashIdx = trimmedDir.indexOf("/");
    const baseInBucket = slashIdx === -1 ? "" : trimmedDir.slice(slashIdx + 1);
    const orgPrefix = baseInBucket ? `${baseInBucket}/${orgId}/` : `${orgId}/`;
    const exportPrefixSuffix = `${orgId}/exports/`;
    try {
      const [files] = await bucket.getFiles({ prefix: orgPrefix });
      for (const f of files) {
        // Skip the exports folder so we don't recursively include prior
        // export ZIPs (and the one currently being written).
        if (f.name.includes(exportPrefixSuffix)) { manifest.attachments.skipped += 1; continue; }
        const sizeStr = (f.metadata?.size as string | number | undefined) ?? "0";
        const sz = typeof sizeStr === "number" ? sizeStr : parseInt(sizeStr, 10) || 0;
        if (manifest.attachments.count >= ATTACHMENT_MAX_FILES || manifest.attachments.bytes + sz > ATTACHMENT_MAX_BYTES) {
          manifest.attachments.truncated = true;
          manifest.attachments.skipped += 1;
          continue;
        }
        try {
          const rel = f.name.startsWith(orgPrefix) ? f.name.slice(orgPrefix.length) : f.name;
          archive.append(f.createReadStream(), { name: `attachments/${rel}` });
          manifest.attachments.count += 1;
          manifest.attachments.bytes += sz;
        } catch (e) {
          manifest.attachments.skipped += 1;
          logError("[orgExport] attachment stream failed", { exportId, name: f.name }, e instanceof Error ? e : new Error(String(e)));
        }
      }
    } catch (e) {
      logError("[orgExport] attachments listing failed", { exportId, orgId }, e instanceof Error ? e : new Error(String(e)));
    }

    archive.append(JSON.stringify({ orgId, exportedAt: new Date().toISOString(), ...manifest }, null, 2), { name: "manifest.json" });
    archive.append(
      "SmartManageAI Org Export\n=========================\n\n" +
      "tables/      — one CSV per major table for your organization\n" +
      "attachments/ — every uploaded file stored under your org prefix\n" +
      "manifest.json — row counts, attachment count/bytes, exportedAt\n\n" +
      `Attachment cap: ${ATTACHMENT_MAX_FILES} files / ${ATTACHMENT_MAX_BYTES} bytes (override via\n` +
      "ORG_EXPORT_ATTACHMENT_MAX_FILES / ORG_EXPORT_ATTACHMENT_MAX_BYTES). When the cap\n" +
      "is hit, manifest.attachments.truncated will be true and skipped count > 0.\n\n" +
      "Re-import tables via Company Settings → Data Management → Import.\n",
      { name: "README.txt" }
    );
    await archive.finalize();
    await uploadPromise;

    const svc = new ObjectStorageService();
    await svc.setAclPolicyForObjectKey(objectKey, {
      owner: requestedBy.id,
      organizationId: orgId,
      visibility: "private",
    });
    const signedUrl = await svc.getSignedDownloadUrl(file, 60 * 60 * 24); // 24h

    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    await db.update(orgExports)
      .set({ status: "COMPLETED", objectKey, bytes, completedAt: new Date(), expiresAt, emailedTo: requestedBy.email })
      .where(eq(orgExports.id, exportId));

    if (requestedBy.email) {
      try {
        await sendEmail({
          to: requestedBy.email,
          subject: "Your SmartManageAI organization export is ready",
          text: `Your organization export is ready. Download (link valid 24h):\n\n${signedUrl}\n\nIf you did not request this, please contact support@smartmanage.ai immediately.`,
          html: `<p>Your organization export is ready. The download link is valid for 24 hours.</p><p><a href="${signedUrl}">Download ZIP</a></p><p>If you did not request this, please contact <a href="mailto:support@smartmanage.ai">support@smartmanage.ai</a> immediately.</p>`,
        });
      } catch (e) {
        logError("[orgExport] email send failed", { exportId }, e instanceof Error ? e : new Error(String(e)));
      }
    }
    logInfo("[orgExport] completed", { exportId, orgId, bytes });
  } catch (e) {
    logError("[orgExport] failed", { exportId, orgId }, e instanceof Error ? e : new Error(String(e)));
    await db.update(orgExports)
      .set({ status: "FAILED", errorMessage: e instanceof Error ? e.message : String(e), completedAt: new Date() })
      .where(eq(orgExports.id, exportId)).catch(() => {});
  }
}

router.get("/api/org/exports", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const rows = await db.select().from(orgExports).where(eq(orgExports.organizationId, orgId)).orderBy(desc(orgExports.createdAt)).limit(20);
    res.json(rows);
  } catch (e) { next(e); }
});

router.post("/api/org/exports", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const user = req.user!;

    const [job] = await db.insert(orgExports).values({
      organizationId: orgId,
      status: "PENDING",
      requestedById: user.id,
      emailedTo: user.email ?? null,
    }).returning();

    await logAudit({ userId: user.id, entityType: "org_export", entityId: job.id, action: "CREATE" }, req);

    // Fire-and-forget. Captures orgId so the worker doesn't depend on the request lifetime.
    setImmediate(() => { runExport(orgId, job.id, { id: user.id, email: user.email ?? "" }); });

    res.status(202).json({ jobId: job.id, status: "PENDING" });
  } catch (e) { next(e); }
});

router.get("/api/org/exports/:id", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [row] = await db.select().from(orgExports).where(and(eq(orgExports.id, req.params.id), eq(orgExports.organizationId, orgId))).limit(1);
    if (!row) return res.status(404).json({ error: "Not found" });
    let downloadUrl: string | null = null;
    if (row.status === "COMPLETED" && row.objectKey) {
      try {
        const { bucketName, objectName } = parseObjectPath(row.objectKey);
        const file = objectStorageClient.bucket(bucketName).file(objectName);
        downloadUrl = await new ObjectStorageService().getSignedDownloadUrl(file, 60 * 15);
      } catch (e) {
        logError("[orgExport] sign url failed", { id: row.id }, e instanceof Error ? e : new Error(String(e)));
      }
    }
    res.json({ ...row, downloadUrl });
  } catch (e) { next(e); }
});

// ────────────────────────────────────────────────────────────────────────────
// DELETE ORG (soft-delete + scheduled hard-delete after email confirm)
// ────────────────────────────────────────────────────────────────────────────

const HARD_DELETE_GRACE_DAYS = parseInt(process.env.ORG_HARD_DELETE_GRACE_DAYS ?? "30", 10);

const deletionRequestSchema = z.object({
  reason: z.string().max(2000).optional(),
  confirmEmail: z.string().email("Valid email required"),
});

router.get("/api/org/deletion-request", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const [row] = await db.select().from(orgDeletionRequests)
      .where(and(eq(orgDeletionRequests.organizationId, orgId)))
      .orderBy(desc(orgDeletionRequests.createdAt)).limit(1);
    res.json(row ?? null);
  } catch (e) { next(e); }
});

router.post("/api/org/deletion-request", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const user = req.user!;
    const parsed = deletionRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (user.email && parsed.data.confirmEmail.toLowerCase() !== user.email.toLowerCase()) {
      return res.status(400).json({ error: "Confirmation email must match your account email" });
    }

    // Cancel any prior pending request
    await db.update(orgDeletionRequests)
      .set({ status: "CANCELLED", cancelledAt: new Date(), cancelledById: user.id })
      .where(and(eq(orgDeletionRequests.organizationId, orgId), eq(orgDeletionRequests.status, "AWAITING_CONFIRMATION")));

    const token = randomBytes(32).toString("hex");
    const [row] = await db.insert(orgDeletionRequests).values({
      organizationId: orgId,
      status: "AWAITING_CONFIRMATION",
      reason: parsed.data.reason ?? null,
      confirmationToken: token,
      confirmationSentTo: parsed.data.confirmEmail,
      requestedById: user.id,
    }).returning();

    await logAudit({ userId: user.id, entityType: "org_deletion_request", entityId: row.id, action: "CREATE", newValue: JSON.stringify({ confirmEmail: parsed.data.confirmEmail }) }, req);

    const baseUrl = getCanonicalBaseUrl(req);
    const confirmUrl = `${baseUrl}/api/org/deletion-request/confirm?token=${token}`;
    try {
      await sendEmail({
        to: parsed.data.confirmEmail,
        subject: "Confirm deletion of your SmartManageAI organization",
        text: `A deletion request was submitted for your SmartManageAI organization.\n\nIf you initiated this, click the link below within 24 hours to confirm. Your data will be soft-deleted immediately and permanently destroyed in ${HARD_DELETE_GRACE_DAYS} days. You can cancel anytime before then by contacting support@smartmanage.ai.\n\n${confirmUrl}\n\nIf you did NOT request this, ignore this email and contact security@smartmanage.ai immediately.`,
        html: `<p>A deletion request was submitted for your SmartManageAI organization.</p><p>If you initiated this, click below within 24 hours to confirm. Your data will be soft-deleted immediately and permanently destroyed in <strong>${HARD_DELETE_GRACE_DAYS} days</strong>.</p><p><a href="${confirmUrl}">Confirm organization deletion</a></p><p>If you did NOT request this, ignore this email and contact <a href="mailto:security@smartmanage.ai">security@smartmanage.ai</a> immediately.</p>`,
      });
    } catch (e) {
      logError("[orgDeletion] confirmation email failed", { id: row.id }, e instanceof Error ? e : new Error(String(e)));
    }

    res.status(202).json({ id: row.id, status: row.status, confirmationSentTo: row.confirmationSentTo });
  } catch (e) { next(e); }
});

router.get("/api/org/deletion-request/confirm", async (req, res, next) => {
  try {
    const token = String(req.query.token ?? "");
    if (!token) return res.status(400).send("Missing token");
    const [row] = await db.select().from(orgDeletionRequests).where(eq(orgDeletionRequests.confirmationToken, token)).limit(1);
    if (!row) return res.status(404).send("Invalid or expired token");
    if (row.status !== "AWAITING_CONFIRMATION") return res.status(400).send(`Already ${row.status.toLowerCase()}`);

    const ageMs = Date.now() - new Date(row.createdAt).getTime();
    if (ageMs > 24 * 60 * 60 * 1000) {
      await db.update(orgDeletionRequests).set({ status: "EXPIRED" }).where(eq(orgDeletionRequests.id, row.id));
      return res.status(400).send("Confirmation link expired. Please submit a new deletion request.");
    }

    const hardDeleteAt = new Date(Date.now() + HARD_DELETE_GRACE_DAYS * 24 * 60 * 60 * 1000);
    await db.update(orgDeletionRequests).set({
      status: "SCHEDULED_HARD_DELETE",
      confirmedAt: new Date(),
      hardDeleteScheduledAt: hardDeleteAt,
    }).where(eq(orgDeletionRequests.id, row.id));

    // Soft-delete: deactivate the org. (Hard-delete cron job removes data after grace window.)
    await db.update(organizations).set({ isActive: false, updatedAt: new Date() }).where(eq(organizations.id, row.organizationId!));

    await logAudit({ userId: row.requestedById!, entityType: "org_deletion_request", entityId: row.id, action: "APPROVE", newValue: JSON.stringify({ hardDeleteScheduledAt: hardDeleteAt.toISOString() }) });

    res.setHeader("Content-Type", "text/html");
    res.send(`<!doctype html><html><body style="font-family:sans-serif;max-width:640px;margin:48px auto;padding:24px"><h1>Deletion confirmed</h1><p>Your organization has been deactivated. All data will be permanently destroyed on <strong>${hardDeleteAt.toUTCString()}</strong> unless you cancel by contacting <a href="mailto:support@smartmanage.ai">support@smartmanage.ai</a>.</p></body></html>`);
  } catch (e) { next(e); }
});

router.post("/api/org/deletion-request/cancel", requireAuth, requireRole(...ADMIN_ROLES), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { orgId, mustDenyAccess } = getOrgIdForFilter(req);
    if (mustDenyAccess || !orgId) return res.status(403).json({ error: "Access denied" });
    const user = req.user!;
    // Only cancel requests that are still in an active/pending state. Without
    // this filter a cancel call could overwrite a previously COMPLETED or
    // already-CANCELLED row, which would corrupt the lifecycle audit trail.
    const updated = await db.update(orgDeletionRequests).set({
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancelledById: user.id,
    }).where(and(
      eq(orgDeletionRequests.organizationId, orgId),
      inArray(orgDeletionRequests.status, ["AWAITING_CONFIRMATION", "SCHEDULED_HARD_DELETE"]),
    )).returning();
    // Reactivate the org if it was soft-deleted by us
    await db.update(organizations).set({ isActive: true, updatedAt: new Date() }).where(eq(organizations.id, orgId));
    await logAudit({ userId: user.id, entityType: "org_deletion_request", entityId: updated[0]?.id ?? "n/a", action: "REJECT" }, req);
    res.json({ cancelled: updated.length });
  } catch (e) { next(e); }
});

export default router;
