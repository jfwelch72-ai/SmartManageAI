/**
 * Task #1272 — automated coverage for `backfillPresetApplications` in
 * `server/services/featureFlagService.ts`. The backfill runs on every server
 * startup and silently mutates the `feature_flag_preset_applications` audit
 * table, so it needs pinned tests for:
 *   1. Orgs whose stored flags exactly match the explicit preset for their
 *      tradeType get a synthetic row attributed to "system" (appliedById=null)
 *      with appliedAt equal to the org's createdAt.
 *   2. Orgs that already have an audit row are skipped on subsequent runs
 *      (idempotency).
 *   3. Orgs whose flags don't match the preset (customized) are left alone.
 *   4. Orgs with NULL or invalid-JSON featureFlags are skipped without
 *      throwing.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  featureFlagPresetApplications,
  FEATURE_FLAG_KEYS,
} from "@shared/schema";
import {
  getFeaturePresetForTrade,
  hasExplicitPresetForTrade,
} from "@shared/tradeFeaturePresets";
import { backfillPresetApplications } from "../services/featureFlagService";
import { ensureFeatureFlagPresetApplicationsTable } from "../utils/ensureFeatureFlagPresetApplicationsTable";

const TEST_PREFIX = "__ffpa_backfill_test__";

type OrgInsert = typeof organizations.$inferInsert;
type TradeType = OrgInsert["tradeType"];

async function cleanup() {
  await db.delete(featureFlagPresetApplications).where(
    sql`${featureFlagPresetApplications.organizationId} IN (
      SELECT ${organizations.id} FROM ${organizations}
      WHERE ${organizations.name} LIKE ${`${TEST_PREFIX}%`}
    )`,
  );
  await db
    .delete(organizations)
    .where(sql`${organizations.name} LIKE ${`${TEST_PREFIX}%`}`);
}

interface OrgSeed {
  label: string;
  tradeType: TradeType;
  featureFlags: string | null;
  createdAt?: Date;
}

async function seedOrg(seed: OrgSeed): Promise<{ id: string; createdAt: Date }> {
  const slug = `${TEST_PREFIX}${seed.label}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const values: OrgInsert = {
    name: `${TEST_PREFIX}${seed.label}`,
    slug,
    tradeType: seed.tradeType,
    featureFlags: seed.featureFlags,
    ...(seed.createdAt
      ? { createdAt: seed.createdAt, updatedAt: seed.createdAt }
      : {}),
  };
  const [row] = await db.insert(organizations).values(values).returning();
  return { id: row.id, createdAt: row.createdAt as Date };
}

async function getAuditRows(orgId: string) {
  return db
    .select()
    .from(featureFlagPresetApplications)
    .where(eq(featureFlagPresetApplications.organizationId, orgId));
}

beforeAll(async () => {
  await ensureFeatureFlagPresetApplicationsTable();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("backfillPresetApplications", () => {
  it("inserts a synthetic system-attributed row at createdAt when flags exactly match the trade preset", async () => {
    const tradeType: TradeType = "ROADWAY_CONSTRUCTION";
    const preset = getFeaturePresetForTrade(tradeType);
    // Sanity: precondition for the rest of the suite — we rely on this trade
    // having an explicit preset entry.
    expect(hasExplicitPresetForTrade(tradeType)).toBe(true);

    const createdAt = new Date("2024-06-15T12:34:56.000Z");
    const { id, createdAt: dbCreatedAt } = await seedOrg({
      label: "match",
      tradeType,
      featureFlags: JSON.stringify(preset),
      createdAt,
    });

    await backfillPresetApplications();

    const rows = await getAuditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0].tradeType).toBe(tradeType);
    expect(rows[0].appliedById).toBeNull();
    expect(new Date(rows[0].appliedAt as Date).getTime()).toBe(
      new Date(dbCreatedAt).getTime(),
    );
  });

  it("is idempotent: orgs with an existing audit row are skipped on subsequent runs", async () => {
    const tradeType: TradeType = "ROADWAY_CONSTRUCTION";
    const preset = getFeaturePresetForTrade(tradeType);
    const { id } = await seedOrg({
      label: "idem",
      tradeType,
      featureFlags: JSON.stringify(preset),
      createdAt: new Date("2024-07-01T00:00:00.000Z"),
    });

    await backfillPresetApplications();
    const after1 = await getAuditRows(id);
    expect(after1).toHaveLength(1);
    const firstId = after1[0].id;

    // Re-run: must not insert another row for the same org.
    await backfillPresetApplications();
    const after2 = await getAuditRows(id);
    expect(after2).toHaveLength(1);
    expect(after2[0].id).toBe(firstId);
  });

  it("leaves orgs with customized (non-matching) flags untouched", async () => {
    const tradeType: TradeType = "ROADWAY_CONSTRUCTION";
    const preset = { ...getFeaturePresetForTrade(tradeType) };
    // Flip one flag so the stored flags no longer match the preset.
    const firstKey = FEATURE_FLAG_KEYS[0];
    const customized = { ...preset, [firstKey]: !preset[firstKey] };
    const { id } = await seedOrg({
      label: "custom",
      tradeType,
      featureFlags: JSON.stringify(customized),
    });

    await backfillPresetApplications();

    const rows = await getAuditRows(id);
    expect(rows).toHaveLength(0);
  });

  it("skips orgs with NULL featureFlags without throwing", async () => {
    const { id } = await seedOrg({
      label: "null",
      tradeType: "ROADWAY_CONSTRUCTION",
      featureFlags: null,
    });

    await expect(backfillPresetApplications()).resolves.toBeUndefined();

    const rows = await getAuditRows(id);
    expect(rows).toHaveLength(0);
  });

  it("skips orgs with invalid-JSON featureFlags without throwing", async () => {
    const { id } = await seedOrg({
      label: "badjson",
      tradeType: "ROADWAY_CONSTRUCTION",
      featureFlags: "{not valid json",
    });

    await expect(backfillPresetApplications()).resolves.toBeUndefined();

    const rows = await getAuditRows(id);
    expect(rows).toHaveLength(0);
  });
});
