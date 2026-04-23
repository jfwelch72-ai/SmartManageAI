import type { SyncResult, SyncError } from "../../types";
import type { IntegrationConnection } from "@shared/schema";
import { db } from "../../../db";
import { integrationSyncState, dotPayItems, dotPayItemOverrides, estimateLineItems, estimates, projects, bids } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { logInfo, logError } from "../../../utils/logger";

/**
 * AASHTOWare ebsx is the bid-exchange XML format used by state DOTs and
 * the FHWA. Without a real AASHTOWare server we expose simple JSON shapes
 * that mirror the ebsx fields the platform actually uses (item number,
 * description, unit, quantity, unit price). This keeps the integration
 * provider-agnostic and easy to swap for a live ebsx parser later.
 */
export interface EbsxItem {
  itemNumber: string;
  description: string;
  unit: string;
  quantity?: number;
  unitPrice?: number;
  specSection?: string;
}

export interface EbsxBidPackage {
  proposalNumber: string;
  letDate?: string;
  agency?: string;
  items: EbsxItem[];
}

/**
 * Parse a JSON ebsx-shaped payload into a normalized bid package. A real
 * implementation would parse the XML using fast-xml-parser; we accept a
 * pre-parsed JSON shape so the sync surface stays the same.
 */
export function parseEbsxJson(payload: unknown): EbsxBidPackage {
  const obj = (payload ?? {}) as Record<string, any>;
  const items = Array.isArray(obj.items) ? obj.items : [];
  return {
    proposalNumber: String(obj.proposalNumber ?? ""),
    letDate: obj.letDate ? String(obj.letDate) : undefined,
    agency: obj.agency ? String(obj.agency) : undefined,
    items: items.map((it: any) => ({
      itemNumber: String(it.itemNumber ?? ""),
      description: String(it.description ?? ""),
      unit: String(it.unit ?? ""),
      quantity: it.quantity != null ? Number(it.quantity) : undefined,
      unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
      specSection: it.specSection ? String(it.specSection) : undefined,
    })),
  };
}

export async function importBidPackage(
  connection: IntegrationConnection,
  pkg: EbsxBidPackage,
  dryRun = false
): Promise<SyncResult> {
  const errors: SyncError[] = [];
  let matched = 0;
  let unmatched = 0;

  try {
    let overridesUpserted = 0;
    for (const item of pkg.items) {
      if (!item.itemNumber) continue;
      const [hit] = await db
        .select({ id: dotPayItems.id })
        .from(dotPayItems)
        .where(eq(dotPayItems.itemNumber, item.itemNumber))
        .limit(1);
      if (!hit) {
        unmatched++;
        continue;
      }
      matched++;

      // For each matched pay item, persist an org-level override carrying
      // the ebsx-supplied description as `internalAlias`. This is the
      // mechanism by which an ebsx import "imports" pay items into the
      // org's library — global pay items are SUPER_ADMIN-only, so per-org
      // overrides are the correct merge target.
      if (dryRun) continue;
      try {
        const [existing] = await db
          .select({ id: dotPayItemOverrides.id })
          .from(dotPayItemOverrides)
          .where(
            and(
              eq(dotPayItemOverrides.organizationId, connection.organizationId),
              eq(dotPayItemOverrides.payItemId, hit.id),
            )
          )
          .limit(1);
        const overrideValues = {
          customDescription: item.description ?? null,
          customUnit: item.unit ?? null,
          internalAlias: item.description ?? null,
          notes: `Imported from ebsx ${pkg.proposalNumber} on ${new Date().toISOString().slice(0, 10)}`,
          updatedAt: new Date(),
        };
        if (existing) {
          await db
            .update(dotPayItemOverrides)
            .set(overrideValues)
            .where(eq(dotPayItemOverrides.id, existing.id));
        } else {
          await db.insert(dotPayItemOverrides).values({
            organizationId: connection.organizationId,
            payItemId: hit.id,
            ...overrideValues,
          });
        }
        overridesUpserted++;
      } catch (err) {
        errors.push({ entityId: item.itemNumber, message: String(err) });
      }
    }

    const meta = {
      lastImport: {
        proposalNumber: pkg.proposalNumber,
        letDate: pkg.letDate,
        agency: pkg.agency,
        itemCount: pkg.items.length,
        matched,
        unmatched,
        overridesUpserted,
        importedAt: new Date().toISOString(),
        items: pkg.items,
      },
    };

    if (!dryRun) {
      const [existing] = await db
        .select()
        .from(integrationSyncState)
        .where(
          and(
            eq(integrationSyncState.connectionId, connection.id),
            eq(integrationSyncState.entityType, "ebsx_bid_packages")
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
          entityType: "ebsx_bid_packages",
          metadata: meta,
          lastSyncAt: new Date(),
        });
      }
    }

    logInfo("AASHTOWare ebsx bid package imported", { proposalNumber: pkg.proposalNumber, matched, unmatched, dryRun });
    return {
      success: true,
      entityType: "ebsx_bid_package",
      direction: "import",
      created: matched,
      updated: 0,
      skipped: unmatched,
      errors,
    };
  } catch (err) {
    logError("AASHTOWare ebsx import failed", { error: String(err) });
    errors.push({ message: String(err) });
    return { success: false, entityType: "ebsx_bid_package", direction: "import", created: 0, updated: 0, skipped: 0, errors };
  }
}

/**
 * Export the line items of an estimate as an ebsx-shaped JSON payload.
 * Returns the payload in the SyncResult metadata via the cursor field
 * (caller can then download it). For the file-exchange flow we keep
 * everything in-memory; SUPER_ADMINs can wire a real ebsx serializer later.
 */
export async function exportEstimateAsEbsx(
  connection: IntegrationConnection,
  estimateId: string,
  dryRun = false
): Promise<SyncResult & { payload?: EbsxBidPackage }> {
  const errors: SyncError[] = [];
  try {
    // Cross-tenant guard: the estimate's owning organization (derived via
    // bid.gcOrganizationId or project.gcOrganizationId) MUST match the
    // connection's organizationId. The `estimates` table has no
    // organizationId column, so we resolve it through the parent.
    const [estimate] = await db
      .select({ id: estimates.id, bidId: estimates.bidId, projectId: estimates.projectId })
      .from(estimates)
      .where(eq(estimates.id, estimateId));
    if (!estimate) {
      errors.push({ message: "Estimate not found" });
      return { success: false, entityType: "ebsx_export", direction: "export", created: 0, updated: 0, skipped: 0, errors };
    }
    let ownerOrgId: string | null = null;
    if (estimate.bidId) {
      const [bid] = await db.select({ org: bids.gcOrganizationId }).from(bids).where(eq(bids.id, estimate.bidId));
      ownerOrgId = bid?.org ?? null;
    }
    if (!ownerOrgId && estimate.projectId) {
      const [project] = await db.select({ org: projects.gcOrganizationId }).from(projects).where(eq(projects.id, estimate.projectId));
      ownerOrgId = project?.org ?? null;
    }
    if (!ownerOrgId || ownerOrgId !== connection.organizationId) {
      errors.push({ message: "Estimate is not owned by the connection's organization" });
      return { success: false, entityType: "ebsx_export", direction: "export", created: 0, updated: 0, skipped: 0, errors };
    }

    const lines = await db
      .select({
        itemNumber: estimateLineItems.payItemNumber,
        description: estimateLineItems.description,
        unit: estimateLineItems.unit,
        quantity: estimateLineItems.quantity,
        unitPrice: sql<string>`COALESCE(${estimateLineItems.materialCost}, 0) + COALESCE(${estimateLineItems.laborCost}, 0) + COALESCE(${estimateLineItems.equipmentCost}, 0)`,
        specSection: estimateLineItems.specSection,
      })
      .from(estimateLineItems)
      .where(eq(estimateLineItems.estimateId, estimateId));

    const payload: EbsxBidPackage = {
      proposalNumber: estimateId,
      letDate: new Date().toISOString().slice(0, 10),
      items: lines
        .filter((l) => l.itemNumber)
        .map((l) => ({
          itemNumber: l.itemNumber!,
          description: l.description ?? "",
          unit: l.unit ?? "",
          quantity: l.quantity != null ? Number(l.quantity) : undefined,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : undefined,
          specSection: l.specSection ?? undefined,
        })),
    };

    if (!dryRun) {
      logInfo("AASHTOWare ebsx export prepared", {
        estimateId,
        items: payload.items.length,
      });
    }

    return {
      success: true,
      entityType: "ebsx_export",
      direction: "export",
      created: 0,
      updated: 0,
      skipped: 0,
      errors,
      payload,
    };
  } catch (err) {
    logError("AASHTOWare ebsx export failed", { error: String(err), estimateId });
    errors.push({ message: String(err) });
    return { success: false, entityType: "ebsx_export", direction: "export", created: 0, updated: 0, skipped: 0, errors };
  }
}
