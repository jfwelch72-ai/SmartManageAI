// Task #1945 — Friendly QBO entity labels (customer name / "Pay app #N —
// projectCode" / "Pay run #N") shared between the exhausted-retry admin
// notify path (server/services/integrationSyncRetryNotifications.ts) and
// the email composer (server/services/notificationDelivery.ts).
//
// Lives in a standalone module so the email composer can pull it in
// without dragging in notificationService → notificationDelivery and
// closing a require cycle.
//
// Task #1975 — Extended to handle `qbo_sync:bill:<id>` (subcontractor
// payments → QBO Bills) and `qbo_sync:vendor:<id>` (vendor crm orgs)
// subKinds for when the QBO sync starts pushing per-record Bills/Vendors
// (currently those operations sync in batches as `qbo_sync:bills` /
// `qbo_sync:vendors` and don't carry an id). Keeping the resolver
// future-proof so the day the sync layer splits the batch into per-row
// retries the email + digest copy already names the affected record.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  crmOrganisations,
  payApplications,
  payRuns,
  projects,
  subcontractorContracts,
  subcontractorPayments,
} from "@shared/schema";

const QBO_SYNC_ENTITY_TYPE_PREFIX = "qbo_sync:";

export type QboPerItemSubKind =
  | "customer"
  | "invoice"
  | "payroll"
  | "certified_payroll"
  | "bill"
  | "vendor";

export interface QboResolvedEntity {
  subKind: QboPerItemSubKind;
  itemId: string;
  /** Human-readable label, e.g. "Acme Corp", "Pay app #3 — PROJ-123",
   *  "Pay run #45", "Certified pay run 2025-01-01 – 2025-01-15",
   *  "Bill #2 from Acme Subs", "Acme Subs". */
  displayName: string;
  /** Relative deep link to the in-app record. */
  link: string;
}

/**
 * Pull the per-item subKind + itemId out of an entityType string. Returns
 * `null` for anything that isn't a `qbo_sync:<customer|invoice|payroll|
 * certified_payroll|bill|vendor>:<id>` shape (bare scheduled ops, batch
 * syncs, or non-QBO providers).
 */
function classifyQboPerItemEntity(
  entityType: string,
): { subKind: QboPerItemSubKind; itemId: string } | null {
  if (!entityType.startsWith(QBO_SYNC_ENTITY_TYPE_PREFIX)) return null;
  const operation = entityType.slice(QBO_SYNC_ENTITY_TYPE_PREFIX.length);
  const colonIdx = operation.indexOf(":");
  if (colonIdx <= 0) return null;
  const subKind = operation.slice(0, colonIdx);
  const itemId = operation.slice(colonIdx + 1);
  if (!itemId) return null;
  if (
    subKind === "customer" ||
    subKind === "invoice" ||
    subKind === "payroll" ||
    subKind === "certified_payroll" ||
    subKind === "bill" ||
    subKind === "vendor"
  ) {
    return { subKind, itemId };
  }
  return null;
}

/**
 * Batch-resolve human-readable labels + deep links for a set of
 * `qbo_sync:%` entity types within a single org. Runs at most one query
 * per record kind (customer / invoice / pay-run / bill / vendor) so the
 * per-row notify path and the backfill summary path both stay O(1)
 * round-trips.
 *
 * Customer + vendor lookups share a single crm_organisations query
 * (both subKinds resolve against the same table and are scoped by
 * organizationId) — the rendering pass below still picks the right
 * subKind-specific link template.
 *
 * Orphan IDs (record was deleted) simply don't appear in the returned
 * map; callers fall back to the existing kindLabel + itemId rendering.
 */
export async function resolveQboEntityLabels(
  organizationId: string,
  entityTypes: readonly string[],
): Promise<Map<string, QboResolvedEntity>> {
  const result = new Map<string, QboResolvedEntity>();
  const crmOrgIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const payRunIds = new Set<string>();
  const billIds = new Set<string>();
  const perEntity = new Map<
    string,
    { subKind: QboPerItemSubKind; itemId: string }
  >();
  for (const et of entityTypes) {
    const cls = classifyQboPerItemEntity(et);
    if (!cls) continue;
    perEntity.set(et, cls);
    if (cls.subKind === "customer" || cls.subKind === "vendor") {
      crmOrgIds.add(cls.itemId);
    } else if (cls.subKind === "invoice") invoiceIds.add(cls.itemId);
    else if (cls.subKind === "bill") billIds.add(cls.itemId);
    else payRunIds.add(cls.itemId);
  }
  if (perEntity.size === 0) return result;

  // crm_organisations covers both `customer` and `vendor` subKinds — one
  // query, scoped by organizationId so cross-tenant lookups can't leak.
  const crmOrgLookup = new Map<string, { name: string }>();
  if (crmOrgIds.size > 0) {
    const orgs = await db
      .select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(
        and(
          eq(crmOrganisations.organizationId, organizationId),
          inArray(crmOrganisations.id, Array.from(crmOrgIds)),
        ),
      );
    for (const o of orgs) crmOrgLookup.set(o.id, { name: o.name });
  }

  const invoiceLookup = new Map<
    string,
    {
      applicationNumber: number;
      projectCode: string | null;
      projectName: string | null;
    }
  >();
  if (invoiceIds.size > 0) {
    const apps = await db
      .select({
        id: payApplications.id,
        applicationNumber: payApplications.applicationNumber,
        projectCode: projects.code,
        projectName: projects.name,
      })
      .from(payApplications)
      .leftJoin(projects, eq(projects.id, payApplications.projectId))
      .where(
        and(
          eq(payApplications.organizationId, organizationId),
          inArray(payApplications.id, Array.from(invoiceIds)),
        ),
      );
    for (const a of apps) {
      invoiceLookup.set(a.id, {
        applicationNumber: a.applicationNumber,
        projectCode: a.projectCode,
        projectName: a.projectName,
      });
    }
  }

  const payRunLookup = new Map<
    string,
    { runNumber: string | null; periodStart: string; periodEnd: string }
  >();
  if (payRunIds.size > 0) {
    const runs = await db
      .select({
        id: payRuns.id,
        runNumber: payRuns.runNumber,
        periodStart: payRuns.payPeriodStart,
        periodEnd: payRuns.payPeriodEnd,
      })
      .from(payRuns)
      .where(
        and(
          eq(payRuns.organizationId, organizationId),
          inArray(payRuns.id, Array.from(payRunIds)),
        ),
      );
    for (const r of runs) {
      payRunLookup.set(r.id, {
        runNumber: r.runNumber,
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
      });
    }
  }

  // Bills (subcontractor_payments → QBO Bill) — join through
  // subcontractor_contracts → crm_organisations to pick up the vendor
  // name so the label reads "Bill #N from Vendor X". Scoped by
  // organizationId on subcontractor_payments to keep tenants isolated.
  const billLookup = new Map<
    string,
    { paymentNumber: number; vendorName: string | null }
  >();
  if (billIds.size > 0) {
    const bills = await db
      .select({
        id: subcontractorPayments.id,
        paymentNumber: subcontractorPayments.paymentNumber,
        vendorName: crmOrganisations.name,
      })
      .from(subcontractorPayments)
      .leftJoin(
        subcontractorContracts,
        eq(subcontractorContracts.id, subcontractorPayments.contractId),
      )
      // Defense-in-depth: also constrain the vendor join by
      // organizationId so a stray cross-tenant subcontractor row could
      // never leak its name into another org's friendly label, even if
      // the contract → vendor FK got corrupted somehow.
      .leftJoin(
        crmOrganisations,
        and(
          eq(crmOrganisations.id, subcontractorContracts.subcontractorId),
          eq(crmOrganisations.organizationId, organizationId),
        ),
      )
      .where(
        and(
          eq(subcontractorPayments.organizationId, organizationId),
          inArray(subcontractorPayments.id, Array.from(billIds)),
        ),
      );
    for (const b of bills) {
      billLookup.set(b.id, {
        paymentNumber: b.paymentNumber,
        vendorName: b.vendorName,
      });
    }
  }

  for (const [et, { subKind, itemId }] of Array.from(perEntity.entries())) {
    if (subKind === "customer") {
      const hit = crmOrgLookup.get(itemId);
      if (hit) {
        result.set(et, {
          subKind,
          itemId,
          displayName: hit.name,
          link: `/crm?organisationId=${encodeURIComponent(itemId)}`,
        });
      }
    } else if (subKind === "vendor") {
      const hit = crmOrgLookup.get(itemId);
      if (hit) {
        result.set(et, {
          subKind,
          itemId,
          displayName: hit.name,
          link: `/crm?organisationId=${encodeURIComponent(itemId)}`,
        });
      }
    } else if (subKind === "invoice") {
      const hit = invoiceLookup.get(itemId);
      if (hit) {
        const projectLabel = hit.projectCode ?? hit.projectName ?? null;
        const displayName = projectLabel
          ? `Pay app #${hit.applicationNumber} — ${projectLabel}`
          : `Pay app #${hit.applicationNumber}`;
        result.set(et, {
          subKind,
          itemId,
          displayName,
          link: `/progress-billing?payApplicationId=${encodeURIComponent(itemId)}`,
        });
      }
    } else if (subKind === "bill") {
      const hit = billLookup.get(itemId);
      if (hit) {
        const displayName = hit.vendorName
          ? `Bill #${hit.paymentNumber} from ${hit.vendorName}`
          : `Bill #${hit.paymentNumber}`;
        result.set(et, {
          subKind,
          itemId,
          displayName,
          link: `/subcontractor-payables?paymentId=${encodeURIComponent(itemId)}`,
        });
      }
    } else {
      const hit = payRunLookup.get(itemId);
      if (hit) {
        const variantLabel =
          subKind === "certified_payroll" ? "Certified pay run" : "Pay run";
        const numberLabel = hit.runNumber
          ? `#${hit.runNumber}`
          : `${hit.periodStart} – ${hit.periodEnd}`;
        result.set(et, {
          subKind,
          itemId,
          displayName: `${variantLabel} ${numberLabel}`,
          link: `/payroll-management?payRunId=${encodeURIComponent(itemId)}`,
        });
      }
    }
  }

  return result;
}

/** Convenience: resolve a single entityType. */
export async function resolveQboEntityLabel(
  organizationId: string,
  entityType: string,
): Promise<QboResolvedEntity | null> {
  const map = await resolveQboEntityLabels(organizationId, [entityType]);
  return map.get(entityType) ?? null;
}

// ---------------------------------------------------------------------------
// Task #1976 — Per-batch cache for resolveQboEntityLabel.
//
// When an INTEGRATION_SYNC_RETRIES_EXHAUSTED notification fans out to
// multiple admins, the email composer's loadIntegrationSyncContext path
// (server/services/notificationDelivery.ts) calls resolveQboEntityLabel
// once per recipient — so an org with 5 admins and 20 failed rows would
// produce 100 redundant per-record lookups for the same 20 records.
//
// The cache below collapses repeats to one call per (organizationId,
// entityType) within a single delivery batch. It's intentionally a
// plain Map keyed by an in-flight promise — no TTL, no eviction —
// because a `QboEntityLabelCache` is created fresh by
// `deliverNotifications` and discarded once the batch settles. There's
// nothing to invalidate; it just lives for the lifetime of one batch.
// ---------------------------------------------------------------------------

export type QboEntityLabelCache = Map<string, Promise<QboResolvedEntity | null>>;

export function createQboEntityLabelCache(): QboEntityLabelCache {
  return new Map();
}

function cacheKey(organizationId: string, entityType: string): string {
  return `${organizationId}::${entityType}`;
}

/**
 * Indirection so tests (and the cached variant below) can swap the
 * resolver without having to mock around ESM live-binding hoisting.
 * Production code never reaches into this object.
 */
export const __qboEntityLabelInternals = {
  resolve: resolveQboEntityLabel,
};

/**
 * Cached variant of resolveQboEntityLabel. When `cache` is supplied,
 * repeat lookups for the same (organizationId, entityType) reuse the
 * pending or settled promise so the resolver only runs once per pair
 * for the lifetime of the cache. Without a cache, behaves identically
 * to resolveQboEntityLabel.
 */
export async function resolveQboEntityLabelCached(
  organizationId: string,
  entityType: string,
  cache?: QboEntityLabelCache,
): Promise<QboResolvedEntity | null> {
  if (!cache) {
    return __qboEntityLabelInternals.resolve(organizationId, entityType);
  }
  const key = cacheKey(organizationId, entityType);
  const existing = cache.get(key);
  if (existing) return existing;
  const pending = __qboEntityLabelInternals
    .resolve(organizationId, entityType)
    .catch((err) => {
      // Don't poison the cache with a rejected promise — drop it so a
      // subsequent caller can retry. Re-throw so the original caller
      // still sees the failure.
      cache.delete(key);
      throw err;
    });
  cache.set(key, pending);
  return pending;
}
