import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import {
  integrationSyncState,
  crmOrganisations,
  crmOrganisationCertifications,
} from "@shared/schema";
import { and, eq, ilike, sql } from "drizzle-orm";
import { logInfo, logError } from "../../../utils/logger";
import { safeFetch } from "../../../utils/safeFetch";

const DBE_CERT_TYPES = ["DBE", "MBE", "WBE", "SBE", "VOSB", "SDVOSB", "HUBZONE", "EIGHTA", "ACDBE", "OTHER"] as const;
type DbeCertType = typeof DBE_CERT_TYPES[number];
function toDbeCertType(value: string | undefined | null): DbeCertType | null {
  if (!value) return null;
  const upper = value.toUpperCase().replace(/[^A-Z]/g, "");
  // Handle "8(a)" → "EIGHTA"
  const normalized = upper === "8A" || upper === "EIGHTAEIGHTA" ? "EIGHTA" : upper;
  return (DBE_CERT_TYPES as readonly string[]).includes(normalized) ? (normalized as DbeCertType) : null;
}

export interface DbeDirectoryEntry {
  legalName: string;
  uei?: string;
  duns?: string;
  certificationType?: string; // DBE / MBE / WBE / SBE / VOSB / SDVOSB / HUBZONE / 8a / ACDBE
  certifyingAgency?: string;
  certificationNumber?: string;
  expirationDate?: string;
  state?: string;
  city?: string;
  workCategories?: string[];
}

interface RawEntry {
  name?: string;
  legalName?: string;
  uei?: string;
  duns?: string;
  certType?: string;
  certificationType?: string;
  agency?: string;
  certifyingAgency?: string;
  certNumber?: string;
  certificationNumber?: string;
  expiration?: string;
  expirationDate?: string;
  state?: string;
  city?: string;
  naics?: string[];
  workCategories?: string[];
}

function normalizeEntry(raw: RawEntry): DbeDirectoryEntry {
  return {
    legalName: String(raw.legalName ?? raw.name ?? "").trim(),
    uei: raw.uei,
    duns: raw.duns,
    certificationType: raw.certificationType ?? raw.certType,
    certifyingAgency: raw.certifyingAgency ?? raw.agency,
    certificationNumber: raw.certificationNumber ?? raw.certNumber,
    expirationDate: raw.expirationDate ?? raw.expiration,
    state: raw.state,
    city: raw.city,
    workCategories: raw.workCategories ?? raw.naics ?? [],
  };
}

async function directoryFetch(connection: IntegrationConnection, params: Record<string, string>): Promise<RawEntry[]> {
  const meta = (connection.metadata as Record<string, unknown>) || {};
  const baseUrl = typeof meta.directoryUrl === "string" ? meta.directoryUrl : "";
  if (!baseUrl) throw new Error("DBE directory URL not configured");
  const u = new URL(baseUrl);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof meta.apiKey === "string" && meta.apiKey) headers.Authorization = `Bearer ${meta.apiKey}`;
  const resp = await safeFetch(u.toString(), { headers });
  if (!resp.ok) throw new Error(`DBE directory ${resp.status}: ${await resp.text()}`);
  const data: unknown = await resp.json();
  if (Array.isArray(data)) return data as RawEntry[];
  if (data && typeof data === "object") {
    const obj = data as { entries?: unknown; results?: unknown };
    if (Array.isArray(obj.entries)) return obj.entries as RawEntry[];
    if (Array.isArray(obj.results)) return obj.results as RawEntry[];
  }
  return [];
}

export async function searchDirectory(
  connection: IntegrationConnection,
  query: { name?: string; uei?: string; state?: string }
): Promise<DbeDirectoryEntry[]> {
  const params: Record<string, string> = {};
  if (query.name) params.q = query.name;
  if (query.uei) params.uei = query.uei;
  if (query.state) params.state = query.state;
  const raw = await directoryFetch(connection, params);
  return raw.map(normalizeEntry).filter((e) => e.legalName);
}

/**
 * Run an org-wide refresh: for every CRM organization that already has a
 * `primaryCertificationType`, look it up by UEI (preferred) or legal name
 * and upsert the latest certification expiration into
 * `crm_organisation_certifications`. Skips silently if directory not
 * configured for the org.
 */
export async function refreshCertifications(
  connection: IntegrationConnection,
  dryRun = false
): Promise<SyncResult> {
  const errors: SyncError[] = [];
  let updated = 0;
  let created = 0;
  let skipped = 0;

  try {
    const orgs = await db
      .select({
        id: crmOrganisations.id,
        name: crmOrganisations.name,
        uei: sql<string | null>`null`.as("uei"),
      })
      .from(crmOrganisations)
      .where(
        and(
          eq(crmOrganisations.organizationId, connection.organizationId),
          sql`${crmOrganisations.primaryCertificationType} IS NOT NULL`
        )
      );

    for (const org of orgs) {
      try {
        const matches = await searchDirectory(connection, { name: org.name });
        const best = matches[0];
        if (!best) {
          skipped++;
          continue;
        }
        if (dryRun) {
          updated++;
          continue;
        }
        const certType = toDbeCertType(best.certificationType);
        if (!certType) { skipped++; continue; }
        const certAgency = best.certifyingAgency ?? null;

        // The DB unique constraint is on (crmOrg, type, agency) — match the
        // lookup to those columns so we never collide on insert.
        const existing = await db
          .select()
          .from(crmOrganisationCertifications)
          .where(
            and(
              eq(crmOrganisationCertifications.organizationId, connection.organizationId),
              eq(crmOrganisationCertifications.crmOrganisationId, org.id),
              eq(crmOrganisationCertifications.certificationType, certType),
              certAgency
                ? ilike(crmOrganisationCertifications.certifyingAgency, certAgency)
                : sql`${crmOrganisationCertifications.certifyingAgency} IS NULL`,
            )
          )
          .limit(1);

        if (existing.length > 0) {
          await db
            .update(crmOrganisationCertifications)
            .set({
              certificationNumber: best.certificationNumber ?? existing[0].certificationNumber,
              expirationDate: best.expirationDate ?? null,
              certifyingAgency: certAgency ?? existing[0].certifyingAgency,
              updatedAt: new Date(),
            })
            .where(eq(crmOrganisationCertifications.id, existing[0].id));
          updated++;
        } else if (best.certificationNumber) {
          await db.insert(crmOrganisationCertifications).values({
            organizationId: connection.organizationId,
            crmOrganisationId: org.id,
            certificationType: certType,
            certificationNumber: best.certificationNumber,
            certifyingAgency: certAgency,
            expirationDate: best.expirationDate ?? null,
          });
          created++;
        } else {
          skipped++;
        }
      } catch (err) {
        errors.push({ entityId: org.id, message: String(err) });
      }
    }

    if (!dryRun) {
      const meta = {
        lastRunAt: new Date().toISOString(),
        created,
        updated,
        skipped,
        errors: errors.length,
      };
      const [existing] = await db
        .select()
        .from(integrationSyncState)
        .where(
          and(
            eq(integrationSyncState.connectionId, connection.id),
            eq(integrationSyncState.entityType, "dbe_certifications_refresh")
          )
        );
      if (existing) {
        await db
          .update(integrationSyncState)
          .set({ metadata: meta, lastSyncAt: new Date(), updatedAt: new Date() })
          .where(eq(integrationSyncState.id, existing.id));
      } else {
        await db.insert(integrationSyncState).values({
          organizationId: connection.organizationId,
          connectionId: connection.id,
          entityType: "dbe_certifications_refresh",
          metadata: meta,
          lastSyncAt: new Date(),
        });
      }
    }

    logInfo("DBE directory refresh complete", { created, updated, skipped, errors: errors.length });
    return {
      success: errors.length === 0,
      entityType: "dbe_certification",
      direction: "import",
      created,
      updated,
      skipped,
      errors,
    };
  } catch (err) {
    logError("DBE directory refresh failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "dbe_certification", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}
