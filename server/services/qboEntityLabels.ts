// Task #1945 — Friendly QBO entity labels (customer name / "Pay app #N —
// projectCode" / "Pay run #N") shared between the exhausted-retry admin
// notify path (server/services/integrationSyncRetryNotifications.ts) and
// the email composer (server/services/notificationDelivery.ts).
//
// Lives in a standalone module so the email composer can pull it in
// without dragging in notificationService → notificationDelivery and
// closing a require cycle.

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  crmOrganisations,
  payApplications,
  payRuns,
  projects,
} from "@shared/schema";

const QBO_SYNC_ENTITY_TYPE_PREFIX = "qbo_sync:";

export type QboPerItemSubKind =
  | "customer"
  | "invoice"
  | "payroll"
  | "certified_payroll";

export interface QboResolvedEntity {
  subKind: QboPerItemSubKind;
  itemId: string;
  /** Human-readable label, e.g. "Acme Corp", "Pay app #3 — PROJ-123",
   *  "Pay run #45", "Certified pay run 2025-01-01 – 2025-01-15". */
  displayName: string;
  /** Relative deep link to the in-app record. */
  link: string;
}

/**
 * Pull the per-item subKind + itemId out of an entityType string. Returns
 * `null` for anything that isn't a `qbo_sync:<customer|invoice|payroll|
 * certified_payroll>:<id>` shape (bare scheduled ops, batch syncs, or
 * non-QBO providers).
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
    subKind === "certified_payroll"
  ) {
    return { subKind, itemId };
  }
  return null;
}

/**
 * Batch-resolve human-readable labels + deep links for a set of
 * `qbo_sync:%` entity types within a single org. Runs at most one query
 * per record kind (customer / invoice / pay-run) so the per-row notify
 * path and the backfill summary path both stay O(1) round-trips.
 *
 * Orphan IDs (record was deleted) simply don't appear in the returned
 * map; callers fall back to the existing kindLabel + itemId rendering.
 */
export async function resolveQboEntityLabels(
  organizationId: string,
  entityTypes: readonly string[],
): Promise<Map<string, QboResolvedEntity>> {
  const result = new Map<string, QboResolvedEntity>();
  const customerIds = new Set<string>();
  const invoiceIds = new Set<string>();
  const payRunIds = new Set<string>();
  const perEntity = new Map<
    string,
    { subKind: QboPerItemSubKind; itemId: string }
  >();
  for (const et of entityTypes) {
    const cls = classifyQboPerItemEntity(et);
    if (!cls) continue;
    perEntity.set(et, cls);
    if (cls.subKind === "customer") customerIds.add(cls.itemId);
    else if (cls.subKind === "invoice") invoiceIds.add(cls.itemId);
    else payRunIds.add(cls.itemId);
  }
  if (perEntity.size === 0) return result;

  const customerLookup = new Map<string, { name: string }>();
  if (customerIds.size > 0) {
    const orgs = await db
      .select({ id: crmOrganisations.id, name: crmOrganisations.name })
      .from(crmOrganisations)
      .where(
        and(
          eq(crmOrganisations.organizationId, organizationId),
          inArray(crmOrganisations.id, Array.from(customerIds)),
        ),
      );
    for (const o of orgs) customerLookup.set(o.id, { name: o.name });
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

  for (const [et, { subKind, itemId }] of Array.from(perEntity.entries())) {
    if (subKind === "customer") {
      const hit = customerLookup.get(itemId);
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
