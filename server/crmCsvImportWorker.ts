import { db } from "./db";
import {
  crmCsvImportJobs,
  crmContacts, crmOrganisations, crmOpportunities,
  users,
  type CrmCustomFieldDefinition,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { logError, logInfo } from "./utils/logger";
import { insertNotification } from "./services/notificationService";
import { sendEmail } from "./services/emailService";
import { getDefinitionsForEntity, upsertCustomFieldValues } from "./crmCustomFieldsRoutes";

const EMAIL_THRESHOLD_MS = 30_000;

const ENTITY_LABELS: Record<string, string> = {
  CONTACT: "contacts",
  ORGANISATION: "organisations",
  OPPORTUNITY: "opportunities",
};

const POLL_INTERVAL_MS = 5_000;
const PROGRESS_FLUSH_EVERY = 50; // rows
const STALE_PROCESSING_MS = 10 * 60 * 1000; // recover jobs whose worker died

let pollTimer: NodeJS.Timeout | null = null;
let running = false;
let pendingKick = false;

function pick(row: Record<string, any>, mapping: Record<string, string>, target: string): any {
  for (const [csvCol, schemaField] of Object.entries(mapping)) {
    if (schemaField === target) {
      const v = row[csvCol];
      if (v === undefined || v === null || v === "") return undefined;
      return typeof v === "string" ? v.trim() : v;
    }
  }
  return undefined;
}

// Coerce any pick() value into a trimmed string for fields that store text.
// Excel imports can deliver numbers/booleans/Date-as-ISO; CSV imports stay strings.
function pickStr(row: Record<string, any>, mapping: Record<string, string>, target: string): string | undefined {
  const v = pick(row, mapping, target);
  if (v === undefined || v === null) return undefined;
  const s = typeof v === "string" ? v : String(v);
  const t = s.trim();
  return t === "" ? undefined : t;
}

// Coerce a pick() value into a numeric string suitable for decimal columns.
function pickNumericStr(row: Record<string, any>, mapping: Record<string, string>, target: string): string | undefined {
  const v = pick(row, mapping, target);
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : undefined;
  const cleaned = String(v).replace(/[$,\s]/g, "").trim();
  if (cleaned === "") return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? String(n) : undefined;
}

// Coerce a pick() value into a finite integer (clamped to a safe range) for
// integer columns. Returns undefined when the value can't be parsed.
function pickIntStr(row: Record<string, any>, mapping: Record<string, string>, target: string): number | undefined {
  const s = pickNumericStr(row, mapping, target);
  if (s === undefined) return undefined;
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? n : undefined;
}

// Coerce a pick() value into an ISO YYYY-MM-DD string suitable for `date`
// columns. Excel date cells arrive as ISO strings (the importer converts Date
// objects to ISO before queuing). Plain CSV strings are parsed leniently — if
// we can't make sense of them we return undefined so the row keeps importing
// without erroring out a whole batch.
function pickDateStr(row: Record<string, any>, mapping: Record<string, string>, target: string): string | undefined {
  const v = pick(row, mapping, target);
  if (v === undefined || v === null || v === "") return undefined;
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return undefined;
    return v.toISOString().slice(0, 10);
  }
  const raw = typeof v === "string" ? v.trim() : String(v);
  if (raw === "") return undefined;
  // Already YYYY-MM-DD or ISO timestamp — take the date prefix.
  const isoMatch = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];
  // Numeric Excel serial date (rare — the importer normalizes most, but be safe).
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel epoch: 1899-12-30 (accounts for the 1900 leap-year bug).
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(raw);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return undefined;
}

type CoerceResult =
  | { kind: "empty" }
  | { kind: "ok"; value: unknown }
  | { kind: "error"; error: string };

// Convert a raw cell value into a shape that `upsertCustomFieldValues` accepts
// for the given custom field definition. Returns "empty" when the cell is
// blank (so we don't accidentally clear an existing value during re-imports),
// "error" when the cell is non-empty but couldn't be parsed for the typed
// field (so the worker can surface a per-row error with column + value), and
// "ok" with the coerced value otherwise.
function coerceCustomFieldRaw(def: CrmCustomFieldDefinition, raw: any): CoerceResult {
  if (raw === undefined || raw === null) return { kind: "empty" };
  if (typeof raw === "string" && raw.trim() === "") return { kind: "empty" };
  switch (def.fieldType) {
    case "NUMBER":
    case "CURRENCY": {
      if (typeof raw === "number") {
        return Number.isFinite(raw)
          ? { kind: "ok", value: raw }
          : { kind: "error", error: `${def.label} must be a number` };
      }
      const cleaned = String(raw).replace(/[$,\s]/g, "").trim();
      if (cleaned === "") return { kind: "empty" };
      const n = Number(cleaned);
      return Number.isFinite(n)
        ? { kind: "ok", value: n }
        : { kind: "error", error: `${def.label} must be a number` };
    }
    case "DATE": {
      if (raw instanceof Date) {
        return isNaN(raw.getTime())
          ? { kind: "error", error: `${def.label} is not a valid date` }
          : { kind: "ok", value: raw.toISOString().slice(0, 10) };
      }
      const s = typeof raw === "string" ? raw.trim() : String(raw);
      const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
      if (iso) return { kind: "ok", value: iso[1] };
      const d = new Date(s);
      return isNaN(d.getTime())
        ? { kind: "error", error: `${def.label} is not a valid date` }
        : { kind: "ok", value: d.toISOString().slice(0, 10) };
    }
    case "CHECKBOX": {
      if (typeof raw === "boolean") return { kind: "ok", value: raw };
      if (typeof raw === "number") return { kind: "ok", value: raw !== 0 };
      const s = String(raw).trim().toLowerCase();
      if (["true", "1", "yes", "y", "checked"].includes(s)) return { kind: "ok", value: true };
      if (["false", "0", "no", "n", "unchecked"].includes(s)) return { kind: "ok", value: false };
      return { kind: "error", error: `${def.label} must be yes/no (got "${s}")` };
    }
    case "MULTI_SELECT": {
      if (Array.isArray(raw)) {
        const arr = raw.map((v) => String(v).trim()).filter(Boolean);
        return arr.length > 0 ? { kind: "ok", value: arr } : { kind: "empty" };
      }
      const parts = String(raw).split(/[,;|]/).map((s) => s.trim()).filter(Boolean);
      return parts.length > 0 ? { kind: "ok", value: parts } : { kind: "empty" };
    }
    default: {
      const s = typeof raw === "string" ? raw.trim() : String(raw);
      return s === "" ? { kind: "empty" } : { kind: "ok", value: s };
    }
  }
}

interface RowError {
  row: number;
  error: string;
  column?: string;
  value?: string;
}

interface JobProgress {
  inserted: number;
  updated: number;
  skipped: number;
  errored: number;
  processed: number;
  errors: RowError[];
  insertedIds: string[];
  erroredSourceRows: Record<string, any>[];
}

// Reverse-lookup: given a target schema field, return the spreadsheet column
// header that was mapped to it (for surfacing in row-level error messages).
function findColumnForTarget(mapping: Record<string, string>, target: string): string | undefined {
  for (const [csvCol, schemaField] of Object.entries(mapping)) {
    if (schemaField === target) return csvCol;
  }
  return undefined;
}

// Truncate offending values so a single bad cell can't blow up the errors
// jsonb column when a user pastes a multi-megabyte string.
function shortenValue(v: any): string | undefined {
  if (v === undefined || v === null) return undefined;
  let s: string;
  if (typeof v === "string") s = v;
  else if (typeof v === "number" || typeof v === "boolean") s = String(v);
  else {
    try { s = JSON.stringify(v); } catch { s = String(v); }
  }
  s = s.trim();
  if (s === "") return undefined;
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
}

async function flushProgress(jobId: string, p: JobProgress, final = false): Promise<void> {
  await db.update(crmCsvImportJobs).set({
    processedRows: p.processed,
    insertedRows: p.inserted,
    updatedRows: p.updated,
    skippedRows: p.skipped,
    errorRows: p.errored,
    errors: p.errors,
    insertedIds: p.insertedIds,
    erroredSourceRows: p.erroredSourceRows,
    ...(final
      ? { status: "COMPLETED" as const, completedAt: new Date(), payload: [] as any }
      : { startedAt: new Date() }),
  } as any).where(eq(crmCsvImportJobs.id, jobId));
}

async function processOneJob(): Promise<boolean> {
  // Atomically claim the next pending job (also recover stale PROCESSING jobs).
  const claimed = await db.execute<any>(sql`
    UPDATE "crm_csv_import_jobs"
    SET status = 'PROCESSING', started_at = NOW()
    WHERE id = (
      SELECT id FROM "crm_csv_import_jobs"
      WHERE status = 'PENDING'
         OR (status = 'PROCESSING' AND started_at < NOW() - INTERVAL '10 minutes')
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, organization_id, entity_type, mapping, payload, processed_rows, inserted_rows, updated_rows, skipped_rows, error_rows, errors, errored_source_rows, inserted_ids, created_by_id, created_at, started_at
  `);

  const row = (claimed as any).rows?.[0];
  if (!row) return false;

  const jobId: string = row.id;
  const orgId: string = row.organization_id;
  const entityType: string = row.entity_type;
  const createdById: string | null = row.created_by_id ?? null;
  const startedAt: Date = row.started_at ? new Date(row.started_at) : new Date();
  const mapping: Record<string, string> = row.mapping || {};
  const payloadRows: Record<string, any>[] = Array.isArray(row.payload) ? row.payload : [];

  const progress: JobProgress = {
    inserted: row.inserted_rows ?? 0,
    updated: row.updated_rows ?? 0,
    skipped: row.skipped_rows ?? 0,
    errored: row.error_rows ?? 0,
    processed: row.processed_rows ?? 0,
    errors: Array.isArray(row.errors) ? row.errors : [],
    insertedIds: Array.isArray(row.inserted_ids) ? row.inserted_ids : [],
    erroredSourceRows: Array.isArray(row.errored_source_rows) ? row.errored_source_rows : [],
  };

  // Helper: record a row-level error and remember the source row so the user
  // can later download / re-import just the failed rows.
  const recordError = (_rowIdx: number, srcRow: Record<string, any>, err: RowError) => {
    progress.errored++;
    progress.errors.push(err);
    progress.erroredSourceRows.push(srcRow);
  };

  // Resume from where we left off if a previous worker died mid-flight.
  const startIdx = progress.processed;

  // Pre-load custom field defs for this entity type once. We index by their
  // mapping target value (`cf:<id>`) so the per-row loop can quickly translate
  // mapped columns into definition+key pairs for upsertCustomFieldValues.
  // If this lookup fails (e.g. transient DB error) we log and continue with an
  // empty list — built-in fields will still import, and any `cf:<id>` mappings
  // become no-ops rather than aborting the whole job. The log line makes the
  // problem observable in operational alerts.
  let customDefs: CrmCustomFieldDefinition[] = [];
  try {
    customDefs = await getDefinitionsForEntity(orgId, entityType as any);
  } catch (defErr) {
    logError(
      `[crm-csv-import] failed to load custom field definitions for job ${jobId}; custom field mappings will be skipped for this run`,
      { jobId, orgId, entityType },
      defErr instanceof Error ? defErr : new Error(String(defErr)),
    );
  }
  const customDefByTarget = new Map<string, CrmCustomFieldDefinition>();
  for (const def of customDefs) {
    if (!def.isActive) continue;
    customDefByTarget.set(`cf:${def.id}`, def);
  }
  // Pull (csvColumn, definition) pairs that this job actually mapped, so we
  // skip the per-row work when no custom fields are mapped at all.
  const customFieldColumnMappings: Array<{ csvCol: string; def: CrmCustomFieldDefinition }> = [];
  for (const [csvCol, target] of Object.entries(mapping)) {
    const def = customDefByTarget.get(target);
    if (def) customFieldColumnMappings.push({ csvCol, def });
  }

  // Apply mapped custom-field values to a single entity. Errors are surfaced
  // as row-level errors (including the source row, so the user can re-import
  // just the failed rows) instead of failing the whole job.
  async function applyCustomFieldValues(rowIdx: number, row: Record<string, any>, eType: string, entityId: string): Promise<void> {
    if (customFieldColumnMappings.length === 0) return;
    const customFields: Record<string, unknown> = {};
    // Track which spreadsheet column (and original raw value) each custom-field
    // key came from, so per-key validation errors from `upsertCustomFieldValues`
    // can be surfaced with the offending column header + value.
    const keyContext = new Map<string, { csvCol: string; raw: any }>();
    for (const { csvCol, def } of customFieldColumnMappings) {
      const raw = row[csvCol];
      const coerced = coerceCustomFieldRaw(def, raw);
      if (coerced.kind === "empty") continue;
      if (coerced.kind === "error") {
        recordError(rowIdx, row, {
          row: rowIdx + 1,
          error: coerced.error,
          column: csvCol,
          value: shortenValue(raw),
        });
        continue;
      }
      customFields[def.key] = coerced.value;
      keyContext.set(def.key, { csvCol, raw });
    }
    if (Object.keys(customFields).length === 0) return;
    const result = await upsertCustomFieldValues({
      orgId,
      entityType: eType as any,
      entityId,
      customFields,
      enforceRequired: false,
    });
    if (!result.ok) {
      if (result.errors && result.errors.length > 0) {
        for (const e of result.errors) {
          const ctx = keyContext.get(e.key);
          recordError(rowIdx, row, {
            row: rowIdx + 1,
            error: e.error,
            column: ctx?.csvCol,
            value: ctx ? shortenValue(ctx.raw) : undefined,
          });
        }
      } else {
        recordError(rowIdx, row, { row: rowIdx + 1, error: `Custom field: ${result.error}` });
      }
    }
  }

  try {
    for (let i = startIdx; i < payloadRows.length; i++) {
      const r = payloadRows[i];
      let entityId: string | null = null;
      try {
        if (entityType === "CONTACT") {
          const email = pickStr(r, mapping, "email");
          const fullName = pickStr(r, mapping, "fullName") || pickStr(r, mapping, "name");
          const firstNameRaw = pickStr(r, mapping, "firstName");
          const lastNameRaw = pickStr(r, mapping, "lastName");
          if (!fullName && !firstNameRaw) { progress.skipped++; }
          else {
            const parts = (fullName || "").split(/\s+/).filter(Boolean);
            const firstName = firstNameRaw || parts[0] || "Imported";
            const lastName = lastNameRaw || parts.slice(1).join(" ") || "Contact";
            let didUpdate = false;
            if (email) {
              const [existing] = await db.select().from(crmContacts).where(and(eq(crmContacts.organizationId, orgId), eq(crmContacts.email, email))).limit(1);
              if (existing) {
                await db.update(crmContacts).set({
                  firstName,
                  lastName,
                  phone: pickStr(r, mapping, "phone") ?? existing.phone,
                  title: pickStr(r, mapping, "title") ?? existing.title,
                  birthday: pickDateStr(r, mapping, "birthday") ?? existing.birthday,
                } as any).where(eq(crmContacts.id, existing.id));
                progress.updated++;
                didUpdate = true;
                entityId = existing.id;
              }
            }
            if (!didUpdate) {
              const companyName = pickStr(r, mapping, "company") || pickStr(r, mapping, "organisation") || "Imported Contacts";
              let [orgRow] = await db.select().from(crmOrganisations)
                .where(and(eq(crmOrganisations.organizationId, orgId), eq(crmOrganisations.name, companyName)))
                .limit(1);
              if (!orgRow) {
                [orgRow] = await db.insert(crmOrganisations).values({
                  organizationId: orgId,
                  name: companyName,
                  type: "CONTRACTOR",
                } as any).returning();
              }
              const [c] = await db.insert(crmContacts).values({
                organizationId: orgId,
                organisationId: orgRow.id,
                firstName,
                lastName,
                email: email ?? null,
                phone: pickStr(r, mapping, "phone") ?? null,
                title: pickStr(r, mapping, "title") ?? null,
                birthday: pickDateStr(r, mapping, "birthday") ?? null,
              } as any).returning();
              progress.insertedIds.push(c.id);
              progress.inserted++;
              entityId = c.id;
            }
          }
        } else if (entityType === "ORGANISATION") {
          const name = pickStr(r, mapping, "name");
          if (!name) { progress.skipped++; }
          else {
            const ALLOWED_ORG_TYPES = ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP", "RENTAL_VENDOR", "SERVICE_VENDOR"] as const;
            const requestedType = pickStr(r, mapping, "type");
            if (requestedType && !(ALLOWED_ORG_TYPES as readonly string[]).includes(requestedType)) {
              recordError(i, r, {
                row: i + 1,
                error: `Invalid organisation type "${requestedType}"; allowed: ${ALLOWED_ORG_TYPES.join(", ")}`,
                column: findColumnForTarget(mapping, "type"),
                value: shortenValue(requestedType),
              });
            } else {
              const [existing] = await db.select().from(crmOrganisations).where(and(eq(crmOrganisations.organizationId, orgId), eq(crmOrganisations.name, name))).limit(1);
              if (existing) { progress.updated++; entityId = existing.id; }
              else {
                const [o] = await db.insert(crmOrganisations).values({
                  organizationId: orgId,
                  name,
                  type: (requestedType as any) || "CONTRACTOR",
                  website: pickStr(r, mapping, "website") ?? null,
                  phone: pickStr(r, mapping, "phone") ?? null,
                  address: pickStr(r, mapping, "address") ?? null,
                  insuranceExpiration: pickDateStr(r, mapping, "insuranceExpiration") ?? null,
                  insuranceCoverageAmount: pickNumericStr(r, mapping, "insuranceCoverageAmount") ?? null,
                  licenseExpiration: pickDateStr(r, mapping, "licenseExpiration") ?? null,
                  contractExpiration: pickDateStr(r, mapping, "contractExpiration") ?? null,
                } as any).returning();
                progress.insertedIds.push(o.id);
                progress.inserted++;
                entityId = o.id;
              }
            }
          }
        } else if (entityType === "OPPORTUNITY") {
          const name = pickStr(r, mapping, "name");
          if (!name) { progress.skipped++; }
          else {
            const rawDealValue = pick(r, mapping, "dealValue");
            const parsedDealValue = pickNumericStr(r, mapping, "dealValue");
            if (rawDealValue !== undefined && rawDealValue !== null && rawDealValue !== "" && parsedDealValue === undefined) {
              recordError(i, r, {
                row: i + 1,
                error: `Could not parse "${shortenValue(rawDealValue) ?? ""}" as a number`,
                column: findColumnForTarget(mapping, "dealValue"),
                value: shortenValue(rawDealValue),
              });
            } else {
              const probability = pickIntStr(r, mapping, "probability");
              const [o] = await db.insert(crmOpportunities).values({
                organizationId: orgId,
                name,
                stage: (pickStr(r, mapping, "stage") as any) || "LEAD",
                dealValue: parsedDealValue ?? null,
                source: pickStr(r, mapping, "source") ?? "CSV Import",
                expectedCloseDate: pickDateStr(r, mapping, "expectedCloseDate") ?? null,
                probability: probability !== undefined ? Math.max(0, Math.min(100, probability)) : undefined,
                stageEnteredAt: new Date(),
              } as any).returning();
              progress.insertedIds.push(o.id);
              progress.inserted++;
              entityId = o.id;
            }
          }
        }

        if (entityId) {
          await applyCustomFieldValues(i, r, entityType, entityId);
        }
      } catch (err: any) {
        recordError(i, r, { row: i + 1, error: err?.message ?? String(err) });
      }

      progress.processed = i + 1;
      if (progress.processed % PROGRESS_FLUSH_EVERY === 0) {
        await flushProgress(jobId, progress, false);
      }
    }

    await flushProgress(jobId, progress, true);
    logInfo(`[crm-csv-import] job ${jobId} completed: ${progress.inserted} inserted, ${progress.updated} updated, ${progress.skipped} skipped, ${progress.errored} errored`);
    await notifyJobFinished({
      jobId, orgId, entityType, createdById, startedAt,
      status: "COMPLETED", progress,
    });
  } catch (err) {
    logError(`[crm-csv-import] job ${jobId} failed`, {}, err instanceof Error ? err : new Error(String(err)));
    const failureMessage = err instanceof Error ? err.message : String(err);
    try {
      await db.update(crmCsvImportJobs).set({
        status: "FAILED",
        completedAt: new Date(),
        processedRows: progress.processed,
        insertedRows: progress.inserted,
        updatedRows: progress.updated,
        skippedRows: progress.skipped,
        errorRows: progress.errored,
        errors: [...progress.errors, { row: progress.processed, error: failureMessage }],
        insertedIds: progress.insertedIds,
        erroredSourceRows: progress.erroredSourceRows,
      } as any).where(eq(crmCsvImportJobs.id, jobId));
    } catch {}
    await notifyJobFinished({
      jobId, orgId, entityType, createdById, startedAt,
      status: "FAILED", progress, failureMessage,
    });
  }

  return true;
}

async function notifyJobFinished(args: {
  jobId: string;
  orgId: string;
  entityType: string;
  createdById: string | null;
  startedAt: Date;
  status: "COMPLETED" | "FAILED";
  progress: JobProgress;
  failureMessage?: string;
}): Promise<void> {
  const { jobId, orgId, entityType, createdById, startedAt, status, progress, failureMessage } = args;
  if (!createdById) return;

  const entityLabel = ENTITY_LABELS[entityType] ?? "rows";
  const totalsLine =
    `${progress.inserted} inserted · ${progress.updated} updated · ${progress.skipped} skipped · ${progress.errored} errored ` +
    `(out of ${progress.processed} ${entityLabel})`;

  const title = status === "COMPLETED"
    ? `CSV import finished: ${entityLabel}`
    : `CSV import failed: ${entityLabel}`;
  const message = status === "COMPLETED"
    ? `Your ${entityLabel} CSV import is done. ${totalsLine}.`
    : `Your ${entityLabel} CSV import failed${failureMessage ? `: ${failureMessage}` : ""}. ${totalsLine}.`;

  try {
    await insertNotification({
      userId: createdById,
      organizationId: orgId,
      type: "GENERAL",
      title,
      message,
      relatedEntityId: jobId,
      relatedEntityType: "crm_csv_import_job",
    } as any);
  } catch (err) {
    logError(`[crm-csv-import] failed to insert in-app notification for job ${jobId}`, {}, err instanceof Error ? err : new Error(String(err)));
  }

  const elapsedMs = Date.now() - startedAt.getTime();
  if (elapsedMs < EMAIL_THRESHOLD_MS) return;

  try {
    const [user] = await db.select({ email: users.email, firstName: users.firstName })
      .from(users)
      .where(eq(users.id, createdById))
      .limit(1);
    if (!user?.email) return;

    const greeting = user.firstName ? `Hi ${user.firstName},` : "Hi,";
    const elapsedSec = Math.round(elapsedMs / 1000);
    const html =
      `<p>${greeting}</p>` +
      `<p>${status === "COMPLETED"
        ? `Your CSV import for ${entityLabel} just finished.`
        : `Your CSV import for ${entityLabel} failed${failureMessage ? `: ${failureMessage}` : ""}.`}</p>` +
      `<ul>` +
      `<li><strong>Inserted:</strong> ${progress.inserted}</li>` +
      `<li><strong>Updated:</strong> ${progress.updated}</li>` +
      `<li><strong>Skipped:</strong> ${progress.skipped}</li>` +
      `<li><strong>Errored:</strong> ${progress.errored}</li>` +
      `<li><strong>Total processed:</strong> ${progress.processed}</li>` +
      `<li><strong>Duration:</strong> ${elapsedSec}s</li>` +
      `</ul>`;
    const text =
      `${greeting}\n\n` +
      (status === "COMPLETED"
        ? `Your CSV import for ${entityLabel} just finished.\n\n`
        : `Your CSV import for ${entityLabel} failed${failureMessage ? `: ${failureMessage}` : ""}.\n\n`) +
      `Inserted: ${progress.inserted}\nUpdated: ${progress.updated}\nSkipped: ${progress.skipped}\n` +
      `Errored: ${progress.errored}\nTotal processed: ${progress.processed}\nDuration: ${elapsedSec}s\n`;

    await sendEmail({ to: user.email, subject: title, html, text });
  } catch (err) {
    logError(`[crm-csv-import] failed to send completion email for job ${jobId}`, {}, err instanceof Error ? err : new Error(String(err)));
  }
}

async function drain(): Promise<void> {
  if (running) { pendingKick = true; return; }
  running = true;
  try {
    // Process all queued jobs back-to-back, but yield between jobs to avoid
    // starving the rest of the event loop.
    let processed = true;
    while (processed) {
      processed = await processOneJob();
      if (processed) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  } finally {
    running = false;
    if (pendingKick) {
      pendingKick = false;
      setImmediate(() => drain().catch(() => {}));
    }
  }
}

/** Wake the worker (called by the import endpoint after enqueueing). */
export function kickCrmCsvImportWorker(): void {
  setImmediate(() => drain().catch((err) => {
    logError("[crm-csv-import] kick failed", {}, err instanceof Error ? err : new Error(String(err)));
  }));
}

/** Start the polling loop. Safe to call multiple times. */
export function startCrmCsvImportWorker(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    drain().catch((err) => {
      logError("[crm-csv-import] poll failed", {}, err instanceof Error ? err : new Error(String(err)));
    });
  }, POLL_INTERVAL_MS);
  // Kick once on startup to recover any stale jobs.
  kickCrmCsvImportWorker();
  logInfo(`[crm-csv-import] worker started (poll every ${POLL_INTERVAL_MS}ms, stale recovery ${STALE_PROCESSING_MS}ms)`);
}

export function stopCrmCsvImportWorker(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
