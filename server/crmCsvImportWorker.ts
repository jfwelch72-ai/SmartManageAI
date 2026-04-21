import { db } from "./db";
import {
  crmCsvImportJobs,
  crmContacts, crmOrganisations, crmOpportunities,
  users,
} from "@shared/schema";
import { and, eq, sql } from "drizzle-orm";
import { logError, logInfo } from "./utils/logger";
import { insertNotification } from "./services/notificationService";
import { sendEmail } from "./services/emailService";

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
      return typeof v === "string" ? v.trim() : v;
    }
  }
  return undefined;
}

interface JobProgress {
  inserted: number;
  updated: number;
  skipped: number;
  errored: number;
  processed: number;
  errors: { row: number; error: string }[];
  insertedIds: string[];
}

async function flushProgress(jobId: string, p: JobProgress, final = false): Promise<void> {
  await db.update(crmCsvImportJobs).set({
    processedRows: p.processed,
    insertedRows: p.inserted,
    updatedRows: p.updated,
    skippedRows: p.skipped,
    errorRows: p.errored,
    errors: p.errors.slice(0, 100),
    insertedIds: p.insertedIds,
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
    RETURNING id, organization_id, entity_type, mapping, payload, processed_rows, inserted_rows, updated_rows, skipped_rows, error_rows, errors, inserted_ids, created_by_id, created_at, started_at
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
  };

  // Resume from where we left off if a previous worker died mid-flight.
  const startIdx = progress.processed;

  try {
    for (let i = startIdx; i < payloadRows.length; i++) {
      const r = payloadRows[i];
      try {
        if (entityType === "CONTACT") {
          const email = pick(r, mapping, "email");
          const fullName = pick(r, mapping, "fullName") || pick(r, mapping, "name");
          const firstNameRaw = pick(r, mapping, "firstName");
          const lastNameRaw = pick(r, mapping, "lastName");
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
                  phone: pick(r, mapping, "phone") ?? existing.phone,
                  title: pick(r, mapping, "title") ?? existing.title,
                } as any).where(eq(crmContacts.id, existing.id));
                progress.updated++;
                didUpdate = true;
              }
            }
            if (!didUpdate) {
              const companyName = pick(r, mapping, "company") || pick(r, mapping, "organisation") || "Imported Contacts";
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
                phone: pick(r, mapping, "phone") ?? null,
                title: pick(r, mapping, "title") ?? null,
              } as any).returning();
              progress.insertedIds.push(c.id);
              progress.inserted++;
            }
          }
        } else if (entityType === "ORGANISATION") {
          const name = pick(r, mapping, "name");
          if (!name) { progress.skipped++; }
          else {
            const ALLOWED_ORG_TYPES = ["CONTRACTOR", "SUBCONTRACTOR", "SUPPLIER", "VENDOR", "OWNER_REP", "RENTAL_VENDOR", "SERVICE_VENDOR"] as const;
            const requestedType = pick(r, mapping, "type");
            if (requestedType && !(ALLOWED_ORG_TYPES as readonly string[]).includes(requestedType)) {
              progress.errored++;
              progress.errors.push({ row: i + 1, error: `Invalid organisation type "${requestedType}"; allowed: ${ALLOWED_ORG_TYPES.join(", ")}` });
            } else {
              const [existing] = await db.select().from(crmOrganisations).where(and(eq(crmOrganisations.organizationId, orgId), eq(crmOrganisations.name, name))).limit(1);
              if (existing) { progress.updated++; }
              else {
                const [o] = await db.insert(crmOrganisations).values({
                  organizationId: orgId,
                  name,
                  type: (requestedType as any) || "CONTRACTOR",
                  website: pick(r, mapping, "website") ?? null,
                  phone: pick(r, mapping, "phone") ?? null,
                  address: pick(r, mapping, "address") ?? null,
                } as any).returning();
                progress.insertedIds.push(o.id);
                progress.inserted++;
              }
            }
          }
        } else if (entityType === "OPPORTUNITY") {
          const name = pick(r, mapping, "name");
          if (!name) { progress.skipped++; }
          else {
            const [o] = await db.insert(crmOpportunities).values({
              organizationId: orgId,
              name,
              stage: (pick(r, mapping, "stage") as any) || "LEAD",
              dealValue: pick(r, mapping, "dealValue") ?? null,
              source: pick(r, mapping, "source") ?? "CSV Import",
              stageEnteredAt: new Date(),
            } as any).returning();
            progress.insertedIds.push(o.id);
            progress.inserted++;
          }
        }
      } catch (err: any) {
        progress.errored++;
        progress.errors.push({ row: i + 1, error: err?.message ?? String(err) });
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
        errors: [...progress.errors.slice(0, 99), { row: progress.processed, error: failureMessage }],
        insertedIds: progress.insertedIds,
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
