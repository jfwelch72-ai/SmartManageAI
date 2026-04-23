import { db } from "../db";
import { sql } from "drizzle-orm";
import { logError, logWarn } from "./logger";

/**
 * Task #491 — adds a nullable `document_id` FK column to
 * `crm_organisation_certifications` so DBE/MBE/WBE certification uploads
 * flow through the planDocuments + document_revisions versioning system.
 * The legacy `document_url` column stays in place so existing rows keep
 * rendering until they're re-uploaded against the new field.
 */
export async function ensureCrmOrgCertDocumentColumn(): Promise<void> {
  try {
    await db.execute(sql`
      ALTER TABLE "crm_organisation_certifications"
        ADD COLUMN IF NOT EXISTS "document_id" varchar
        REFERENCES "plan_documents"("id") ON DELETE SET NULL
    `);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/relation .* does not exist/i.test(msg)) {
      logWarn(`[migration] crm_org_cert_document_column — skipped due to schema drift: ${msg}`);
      return;
    }
    logError("[migration] Failed to add crm_organisation_certifications.document_id:", {}, err instanceof Error ? err : new Error(String(err)));
  }
}
