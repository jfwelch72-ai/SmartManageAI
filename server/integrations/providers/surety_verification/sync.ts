import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationSyncState, suretyBonds } from "@shared/schema";
import { and, eq, inArray } from "drizzle-orm";
import { logInfo, logError } from "../../../utils/logger";
import { safeFetch } from "../../../utils/safeFetch";

const BOND_STATUS_VALUES = ["ACTIVE", "EXPIRED", "CANCELLED", "PENDING", "RELEASED"] as const;
type BondStatus = typeof BOND_STATUS_VALUES[number];

export interface BondVerificationResult {
  bondNumber: string;
  status: "ACTIVE" | "EXPIRED" | "CANCELLED" | "UNKNOWN";
  suretyCompany?: string;
  expirationDate?: string;
  verifiedAt: string;
  raw?: unknown;
}

async function verifyOne(
  connection: IntegrationConnection,
  bondNumber: string,
  suretyCompany?: string
): Promise<BondVerificationResult> {
  const meta = (connection.metadata as Record<string, unknown>) || {};
  const url = typeof meta.verificationUrl === "string" ? meta.verificationUrl : "";
  if (!url) throw new Error("Surety verification URL not configured");

  const u = new URL(url);
  u.searchParams.set("bondNumber", bondNumber);
  if (suretyCompany) u.searchParams.set("surety", suretyCompany);

  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof meta.apiKey === "string" && meta.apiKey) headers.Authorization = `Bearer ${meta.apiKey}`;
  const resp = await safeFetch(u.toString(), { headers });
  if (!resp.ok) throw new Error(`Surety verify ${resp.status}: ${await resp.text()}`);
  const data = (await resp.json()) as { status?: unknown; suretyCompany?: string; expirationDate?: string };
  const statusStr = String(data.status ?? "").toUpperCase();
  const normalized: BondVerificationResult["status"] =
    statusStr === "ACTIVE" || statusStr === "EXPIRED" || statusStr === "CANCELLED" ? statusStr : "UNKNOWN";
  return {
    bondNumber,
    status: normalized,
    suretyCompany: data.suretyCompany ?? suretyCompany,
    expirationDate: data.expirationDate,
    verifiedAt: new Date().toISOString(),
    raw: data,
  };
}

/**
 * Verify all bonds in `ACTIVE` status for the org and update their
 * `verificationStatus`. Stores the per-bond verification snapshot in
 * integration_sync_state.metadata.verifiedBonds[].
 */
export async function verifyOrganizationBonds(
  connection: IntegrationConnection,
  options: { bondIds?: string[]; dryRun?: boolean } = {}
): Promise<SyncResult> {
  const errors: SyncError[] = [];
  let updated = 0;
  const verified: BondVerificationResult[] = [];

  try {
    const activeStatus: BondStatus = "ACTIVE";
    const where = options.bondIds && options.bondIds.length > 0
      ? and(eq(suretyBonds.organizationId, connection.organizationId), inArray(suretyBonds.id, options.bondIds))
      : and(eq(suretyBonds.organizationId, connection.organizationId), eq(suretyBonds.status, activeStatus));

    const bonds = await db
      .select({
        id: suretyBonds.id,
        bondNumber: suretyBonds.bondNumber,
        suretyCompany: suretyBonds.suretyCompany,
      })
      .from(suretyBonds)
      .where(where);

    for (const bond of bonds) {
      if (!bond.bondNumber) continue;
      try {
        const result = await verifyOne(connection, bond.bondNumber, bond.suretyCompany ?? undefined);
        verified.push(result);
        if (!options.dryRun) {
          const patch: Partial<typeof suretyBonds.$inferInsert> = {
            verificationStatus: result.status,
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          };
          if (result.expirationDate) patch.expirationDate = result.expirationDate;
          // Note: enum spelling is "CANCELED" (single L); map verifier
          // "CANCELLED" → DB "CANCELED".
          if (result.status === "EXPIRED") {
            patch.status = "EXPIRED";
          } else if (result.status === "CANCELLED") {
            patch.status = "CANCELED";
          }
          await db
            .update(suretyBonds)
            .set(patch)
            .where(eq(suretyBonds.id, bond.id));
          updated++;
        }
      } catch (err) {
        errors.push({ entityId: bond.id, message: String(err) });
      }
    }

    if (!options.dryRun) {
      const meta = {
        lastRunAt: new Date().toISOString(),
        verified: verified.length,
        updated,
        verifiedBonds: verified.slice(-50),
      };
      const [existing] = await db
        .select()
        .from(integrationSyncState)
        .where(
          and(
            eq(integrationSyncState.connectionId, connection.id),
            eq(integrationSyncState.entityType, "surety_verification")
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
          entityType: "surety_verification",
          metadata: meta,
          lastSyncAt: new Date(),
        });
      }
    }

    logInfo("Surety bond verification complete", { verified: verified.length, updated, errors: errors.length });
    return {
      success: errors.length === 0,
      entityType: "surety_bond",
      direction: "import",
      created: 0,
      updated,
      skipped: 0,
      errors,
    };
  } catch (err) {
    logError("Surety verification failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "surety_bond", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}
