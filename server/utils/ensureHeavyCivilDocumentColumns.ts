import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logInfo } from "./logger";

/**
 * Adds nullable document_id FK columns to heavy-civil tables so document
 * uploads (surety bond docs, material certs, haul ticket photos, IDR
 * photos/attachments) flow through the planDocuments + document_revisions
 * versioning system. Backfills rows that have a legacy URL but no FK by
 * creating a planDocuments parent + initial revision when a project +
 * uploader can be inferred.
 */
export async function ensureHeavyCivilDocumentColumns(): Promise<void> {
  try {
    await db.execute(sql`ALTER TABLE "surety_bonds" ADD COLUMN IF NOT EXISTS "document_id" varchar REFERENCES "plan_documents"("id") ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE "material_certifications" ADD COLUMN IF NOT EXISTS "document_id" varchar REFERENCES "plan_documents"("id") ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE "haul_tickets" ADD COLUMN IF NOT EXISTS "ticket_photo_document_id" varchar REFERENCES "plan_documents"("id") ON DELETE SET NULL`);
    await db.execute(sql`ALTER TABLE "daily_inspector_reports" ADD COLUMN IF NOT EXISTS "photo_document_ids" text[]`);
    await db.execute(sql`ALTER TABLE "daily_inspector_reports" ADD COLUMN IF NOT EXISTS "attachment_document_ids" text[]`);

    let totalBackfilled = 0;

    // Backfill: for each row with a legacy URL but no document FK, when we
    // can identify a project + uploader, create a planDocuments parent and
    // an initial document_revision so re-uploads can supersede it.
    totalBackfilled += await backfillSingleDocFk({
      table: "surety_bonds",
      urlCol: "document_url",
      docCol: "document_id",
      projectIdCol: "project_id",
      uploaderCol: "created_by_id",
      titleExpr: sql`'Surety Bond ' || COALESCE(bond_number, id)`,
      docType: "OTHER",
    });

    totalBackfilled += await backfillSingleDocFk({
      table: "material_certifications",
      urlCol: "document_url",
      docCol: "document_id",
      projectIdCol: "project_id",
      uploaderCol: "submitted_by_id",
      titleExpr: sql`'Material Cert ' || COALESCE(cert_number, material_description, id)`,
      docType: "OTHER",
    });

    totalBackfilled += await backfillSingleDocFk({
      table: "haul_tickets",
      urlCol: "ticket_photo_url",
      docCol: "ticket_photo_document_id",
      projectIdCol: "project_id",
      uploaderCol: "recorded_by_id",
      titleExpr: sql`'Haul Ticket ' || COALESCE(ticket_number, id)`,
      docType: "OTHER",
    });

    totalBackfilled += await backfillIdrUrlArray({
      urlArrayCol: "photo_urls",
      docArrayCol: "photo_document_ids",
      titlePrefix: "IDR Photo",
    });

    totalBackfilled += await backfillIdrUrlArray({
      urlArrayCol: "attachment_urls",
      docArrayCol: "attachment_document_ids",
      titlePrefix: "IDR Attachment",
    });

    if (totalBackfilled > 0) {
      logInfo(`[migration] heavy_civil_document_columns — backfilled ${totalBackfilled} legacy document(s)`);
    } else {
      logInfo("[migration] heavy_civil_document_columns — no legacy documents needed backfill");
    }
  } catch (err) {
    logError("[migration] Failed to ensure heavy-civil document columns:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}

interface BackfillSpec {
  table: string;
  urlCol: string;
  docCol: string;
  projectIdCol: string;
  uploaderCol: string;
  titleExpr: ReturnType<typeof sql>;
  docType: string;
}

async function backfillSingleDocFk(spec: BackfillSpec): Promise<number> {
  const tableSql = sql.raw(`"${spec.table}"`);
  const urlSql = sql.raw(`"${spec.urlCol}"`);
  const docSql = sql.raw(`"${spec.docCol}"`);
  const projectSql = sql.raw(`"${spec.projectIdCol}"`);
  const uploaderSql = sql.raw(`"${spec.uploaderCol}"`);

  let total = 0;
  // Loop in batches so orgs with >1000 eligible rows are fully migrated.
  // Loop terminates because each successful row clears its own URL→FK gap;
  // any rows that fail keep retrying until they're fixed manually, so we
  // bail when a batch makes no forward progress to avoid an infinite loop.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await db.execute(sql`
      SELECT id, ${urlSql} AS url, ${projectSql} AS project_id,
             ${uploaderSql} AS uploader_id, organization_id,
             ${spec.titleExpr} AS title
      FROM ${tableSql}
      WHERE ${urlSql} IS NOT NULL
        AND ${urlSql} <> ''
        AND ${docSql} IS NULL
        AND ${projectSql} IS NOT NULL
        AND ${uploaderSql} IS NOT NULL
      LIMIT 500
    `);
    if (rows.rows.length === 0) break;

    let batchCount = 0;
    for (const r of rows.rows as Array<{ id: string; url: string; project_id: string; uploader_id: string; organization_id: string; title: string }>) {
      try {
        const fileName = r.url.split("/").pop()?.split("?")[0] || "document";
        const docInsert = await db.execute(sql`
          INSERT INTO plan_documents (project_id, type, title, file_name, file_url, object_key, uploaded_by_id)
          VALUES (${r.project_id}, ${spec.docType}, ${r.title}, ${fileName}, ${r.url}, ${r.url}, ${r.uploader_id})
          RETURNING id
        `);
        const newDocId = (docInsert.rows[0] as { id: string } | undefined)?.id;
        if (!newDocId) continue;

        await db.execute(sql`
          INSERT INTO document_revisions
            (organization_id, document_id, revision_number, source_type, status, storage_key, created_by_user_id)
          VALUES
            (${r.organization_id}, ${newDocId}, 1, 'upload', 'active', ${r.url}, ${r.uploader_id})
        `);

        await db.execute(sql`UPDATE ${tableSql} SET ${docSql} = ${newDocId} WHERE id = ${r.id}`);
        batchCount++;
      } catch (err) {
        logError(`[migration] heavy_civil backfill row failed`, { table: spec.table, rowId: r.id }, err instanceof Error ? err : new Error(String(err)));
      }
    }
    total += batchCount;
    // No forward progress this batch (every row threw) → stop to avoid an
    // infinite retry loop. Failed rows keep their legacy URL.
    if (batchCount === 0) break;
  }
  return total;
}

interface IdrArraySpec {
  urlArrayCol: string;
  docArrayCol: string;
  titlePrefix: string;
}

/**
 * Backfill IDR photo_urls/attachment_urls (text[]) into plan_documents +
 * document_revisions, populating the parallel *_document_ids arrays.
 * Only processes rows where the legacy URL array is non-empty, the doc-id
 * array is empty/null, and a project + inspector are known.
 */
async function backfillIdrUrlArray(spec: IdrArraySpec): Promise<number> {
  const urlSql = sql.raw(`"${spec.urlArrayCol}"`);
  const docSql = sql.raw(`"${spec.docArrayCol}"`);

  let total = 0;
  while (true) {
    const rows = await db.execute(sql`
      SELECT id, ${urlSql} AS urls, project_id, inspector_id, organization_id
      FROM daily_inspector_reports
      WHERE ${urlSql} IS NOT NULL
        AND array_length(${urlSql}, 1) > 0
        AND (${docSql} IS NULL OR array_length(${docSql}, 1) IS NULL)
        AND project_id IS NOT NULL
        AND inspector_id IS NOT NULL
      LIMIT 200
    `);
    if (rows.rows.length === 0) break;

    let batchCount = 0;
    for (const r of rows.rows as Array<{ id: string; urls: string[]; project_id: string; inspector_id: string; organization_id: string }>) {
      try {
        const newDocIds: string[] = [];
        for (const url of r.urls ?? []) {
          if (!url) continue;
          const fileName = url.split("/").pop()?.split("?")[0] || "attachment";
          const docInsert = await db.execute(sql`
            INSERT INTO plan_documents (project_id, type, title, file_name, file_url, object_key, uploaded_by_id)
            VALUES (${r.project_id}, 'OTHER', ${`${spec.titlePrefix} — ${fileName}`}, ${fileName}, ${url}, ${url}, ${r.inspector_id})
            RETURNING id
          `);
          const newDocId = (docInsert.rows[0] as { id: string } | undefined)?.id;
          if (!newDocId) continue;
          await db.execute(sql`
            INSERT INTO document_revisions
              (organization_id, document_id, revision_number, source_type, status, storage_key, created_by_user_id)
            VALUES
              (${r.organization_id}, ${newDocId}, 1, 'upload', 'active', ${url}, ${r.inspector_id})
          `);
          newDocIds.push(newDocId);
        }
        if (newDocIds.length === 0) continue;
        await db.execute(sql`
          UPDATE daily_inspector_reports
          SET ${docSql} = ${newDocIds}
          WHERE id = ${r.id}
        `);
        batchCount++;
      } catch (err) {
        logError(`[migration] heavy_civil IDR array backfill failed`, { rowId: r.id, col: spec.urlArrayCol }, err instanceof Error ? err : new Error(String(err)));
      }
    }
    total += batchCount;
    if (batchCount === 0) break;
  }
  return total;
}
