/**
 * Task #1409 — unit tests for the per-classification rate-change flag
 * helpers used by the project prevailing wage panel.
 *
 * Verifies the four behaviors the task brief calls out:
 *   1. A non-empty diff persists one unacknowledged row per changed
 *      classification (insert path).
 *   2. A second non-empty diff for the same (org, decision) re-arms
 *      previously acknowledged rows for classifications that re-changed
 *      AND deletes rows for classifications no longer in the diff
 *      (upsert + prune path).
 *   3. A no-diff refresh deletes every flag for (org, decision) so the
 *      badge auto-clears even without PM acknowledgement.
 *   4. acknowledgeRateChanges stamps acknowledgedAt + the user id, and
 *      loadUnacknowledgedRateChanges no longer returns those rows.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { sql } from "drizzle-orm";

vi.mock("../utils/logger", () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  logDebug: vi.fn(),
}));

import { db } from "../db";
import {
  persistRateChangeRecords,
  loadUnacknowledgedRateChanges,
  acknowledgeRateChanges,
  normalizeClassificationKey,
} from "../integrations/providers/dol_davis_bacon/rateChangeFlags";
import { ensureWageDecisionRateChanges } from "../utils/ensureWageDecisionRateChanges";
import type { WageRateDiffEntry } from "../services/davisBaconAdminNotifications";

const TEST_PREFIX = "__rcflags__";
const DECISION = "WD-RCFLAGS-1";

let orgId: string;
let userId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM "wage_decision_rate_changes" WHERE decision_number = ${DECISION}`);
  await db.execute(sql`DELETE FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}`);
}

beforeAll(async () => {
  await ensureWageDecisionRateChanges();
  await cleanup();
  const suffix = Math.random().toString(36).slice(2, 8);
  const orgRes = await db.execute(sql`
    INSERT INTO "organizations" (name, slug)
    VALUES (${TEST_PREFIX + "org"}, ${TEST_PREFIX + suffix})
    RETURNING id
  `);
  orgId = (orgRes.rows[0] as { id: string }).id;
  const userRes = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Ack', 'PM', ${TEST_PREFIX + suffix + "@x.com"}, 'ADMIN')
    RETURNING id
  `);
  userId = (userRes.rows[0] as { id: string }).id;
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM "wage_decision_rate_changes" WHERE organization_id = ${orgId}`);
});

function changed(name: string, oldBase: number, newBase: number): WageRateDiffEntry {
  return {
    kind: "changed",
    classification: name,
    oldBaseRate: oldBase,
    newBaseRate: newBase,
    oldFringeRate: 5,
    newFringeRate: 5,
    oldTotalRate: oldBase + 5,
    newTotalRate: newBase + 5,
  } as WageRateDiffEntry;
}

describe("wage decision rate change flags (Task #1409)", () => {
  it("normalizeClassificationKey lowercases and trims", () => {
    expect(normalizeClassificationKey("  Carpenter  ")).toBe("carpenter");
    expect(normalizeClassificationKey("ELECTRICIAN")).toBe("electrician");
  });

  it("persists one unacknowledged row per changed classification", async () => {
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter", 30, 32),
      changed("Electrician", 40, 41),
    ]);
    const m = await loadUnacknowledgedRateChanges(orgId, DECISION);
    expect(m.size).toBe(2);
    expect(m.get("carpenter")?.changeKind).toBe("changed");
    expect(m.get("carpenter")?.newBaseRate).toBe("32.00");
    expect(m.get("electrician")?.oldBaseRate).toBe("40.00");
  });

  it("upserts changed classifications and prunes ones no longer in the diff", async () => {
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter", 30, 32),
      changed("Electrician", 40, 41),
    ]);
    // Acknowledge both, then refresh produces a diff that only mentions
    // Carpenter (with new numbers) — Electrician must be pruned and
    // Carpenter must be re-armed.
    await acknowledgeRateChanges({ organizationId: orgId, decisionNumber: DECISION, userId });
    const ackEmpty = await loadUnacknowledgedRateChanges(orgId, DECISION);
    expect(ackEmpty.size).toBe(0);

    await persistRateChangeRecords(orgId, DECISION, [changed("Carpenter", 32, 33)]);
    const m = await loadUnacknowledgedRateChanges(orgId, DECISION);
    expect(m.size).toBe(1);
    expect(m.get("carpenter")?.newBaseRate).toBe("33.00");
    expect(m.get("electrician")).toBeUndefined();
  });

  it("an empty diff deletes every flag for the (org, decision) pair", async () => {
    await persistRateChangeRecords(orgId, DECISION, [changed("Carpenter", 30, 32)]);
    expect((await loadUnacknowledgedRateChanges(orgId, DECISION)).size).toBe(1);
    await persistRateChangeRecords(orgId, DECISION, []);
    const m = await loadUnacknowledgedRateChanges(orgId, DECISION);
    expect(m.size).toBe(0);
  });

  it("acknowledgeRateChanges stamps acknowledgedAt and the user id", async () => {
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter", 30, 32),
      changed("Electrician", 40, 41),
    ]);
    const updated = await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId,
    });
    expect(updated).toBe(2);
    const m = await loadUnacknowledgedRateChanges(orgId, DECISION);
    expect(m.size).toBe(0);

    const rows = await db.execute(sql`
      SELECT acknowledged_by_user_id FROM "wage_decision_rate_changes"
      WHERE organization_id = ${orgId} AND decision_number = ${DECISION}
    `);
    expect(rows.rows.length).toBe(2);
    for (const r of rows.rows as Array<{ acknowledged_by_user_id: string }>) {
      expect(r.acknowledged_by_user_id).toBe(userId);
    }
  });

  it("acknowledgeRateChanges restricted to a classification list only stamps that subset", async () => {
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter", 30, 32),
      changed("Electrician", 40, 41),
    ]);
    const updated = await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId,
      classifications: ["carpenter"],
    });
    expect(updated).toBe(1);
    const m = await loadUnacknowledgedRateChanges(orgId, DECISION);
    expect(m.size).toBe(1);
    expect(m.get("electrician")).toBeDefined();
    expect(m.get("carpenter")).toBeUndefined();
  });
});
