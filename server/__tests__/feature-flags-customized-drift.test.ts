/**
 * Task #1292 — backend integration coverage for the "Customized from <preset>"
 * drift-detection path added in Task #1271. Seeds an org whose stored
 * feature_flags drift from its trade preset, runs backfillPresetApplications,
 * and asserts that getLastPresetApplication returns isCustomized=true with the
 * expected per-flag diff entries.
 *
 * A regression here (e.g. the diff field dropped from the API response, or
 * the fuzzy backfill path failing to insert a synthetic audit row for drifted
 * legacy orgs) would silently re-introduce the misleading "No trade preset has
 * been applied" message for those orgs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, eq } from "drizzle-orm";
import { db } from "../db";
import {
  organizations,
  featureFlagPresetApplications,
  FEATURE_FLAG_KEYS,
} from "@shared/schema";
import { getFeaturePresetForTrade } from "@shared/tradeFeaturePresets";
import {
  backfillPresetApplications,
  getLastPresetApplication,
} from "../services/featureFlagService";
import { ensureFeatureFlagPresetApplicationsTable } from "../utils/ensureFeatureFlagPresetApplicationsTable";

const TEST_PREFIX = "__ffpa_drift_test__";

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

beforeAll(async () => {
  await ensureFeatureFlagPresetApplicationsTable();
  await cleanup();
});

afterAll(async () => {
  await cleanup();
});

describe("preset drift detection (backfill + getLastPresetApplication)", () => {
  it("backfills a synthetic audit row for a drifted legacy org and reports isCustomized=true with the expected diff", async () => {
    const tradeType: TradeType = "ROADWAY_CONSTRUCTION";
    const preset = getFeaturePresetForTrade(tradeType);

    // Pick two flags to flip — one that's enabled in the preset and one
    // that's disabled — so we exercise both diff directions. Stay within the
    // fuzzy backfill distance threshold (6) so the synthetic row is inserted.
    const flipOn = FEATURE_FLAG_KEYS.find((k) => !preset[k]);
    const flipOff = FEATURE_FLAG_KEYS.find((k) => preset[k]);
    expect(flipOn).toBeDefined();
    expect(flipOff).toBeDefined();

    const drifted = { ...preset, [flipOn!]: true, [flipOff!]: false };

    const slug = `${TEST_PREFIX}drift-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const [org] = await db
      .insert(organizations)
      .values({
        name: `${TEST_PREFIX}drift`,
        slug,
        tradeType,
        featureFlags: JSON.stringify(drifted),
      } satisfies OrgInsert)
      .returning();

    // Sanity: no audit row exists yet.
    const before = await db
      .select()
      .from(featureFlagPresetApplications)
      .where(eq(featureFlagPresetApplications.organizationId, org.id));
    expect(before).toHaveLength(0);

    await backfillPresetApplications();

    const after = await db
      .select()
      .from(featureFlagPresetApplications)
      .where(eq(featureFlagPresetApplications.organizationId, org.id));
    expect(after).toHaveLength(1);
    expect(after[0].tradeType).toBe(tradeType);
    expect(after[0].appliedById).toBeNull();

    const last = await getLastPresetApplication(org.id);
    expect(last).not.toBeNull();
    expect(last!.tradeType).toBe(tradeType);
    expect(last!.appliedBy).toBeNull();
    expect(last!.isCustomized).toBe(true);

    const diffByKey = new Map(last!.diff.map((d) => [d.key, d]));
    expect(diffByKey.size).toBe(2);
    expect(diffByKey.get(flipOn!)).toEqual({
      key: flipOn,
      current: true,
      preset: false,
    });
    expect(diffByKey.get(flipOff!)).toEqual({
      key: flipOff,
      current: false,
      preset: true,
    });
  });
});
