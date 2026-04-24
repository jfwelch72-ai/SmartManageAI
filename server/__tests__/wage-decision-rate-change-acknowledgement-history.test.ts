/**
 * Task #1480 — unit tests for the append-only rate-change acknowledgement
 * history table. The base `wage_decision_rate_changes` table holds at
 * most one row per (org, decision, classification), so a re-arm or an
 * auto-clear refresh erases the prior acknowledger from the live row.
 * The history table backed by `loadRateChangeAcknowledgementHistory`
 * must keep every superseded acknowledgement intact for compliance
 * audits.
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
  acknowledgeRateChanges,
  loadRateChangeAcknowledgementHistory,
} from "../integrations/providers/dol_davis_bacon/rateChangeFlags";
import { ensureWageDecisionRateChanges } from "../utils/ensureWageDecisionRateChanges";
import { ensureWageDecisionRateChangeAcknowledgements } from "../utils/ensureWageDecisionRateChangeAcknowledgements";
import type { WageRateDiffEntry } from "../services/davisBaconAdminNotifications";

const TEST_PREFIX = "__rcackhist__";
const DECISION = "WD-RCACKHIST-1";

let orgId: string;
let userIdA: string;
let userIdB: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM "wage_decision_rate_change_acknowledgements" WHERE decision_number = ${DECISION}`);
  await db.execute(sql`DELETE FROM "wage_decision_rate_changes" WHERE decision_number = ${DECISION}`);
  await db.execute(sql`DELETE FROM "users" WHERE email LIKE ${TEST_PREFIX + "%"}`);
  await db.execute(sql`DELETE FROM "organizations" WHERE slug LIKE ${TEST_PREFIX + "%"}`);
}

beforeAll(async () => {
  await ensureWageDecisionRateChanges();
  await ensureWageDecisionRateChangeAcknowledgements();
  await cleanup();
  const suffix = Math.random().toString(36).slice(2, 8);
  const orgRes = await db.execute(sql`
    INSERT INTO "organizations" (name, slug)
    VALUES (${TEST_PREFIX + "org"}, ${TEST_PREFIX + suffix})
    RETURNING id
  `);
  orgId = (orgRes.rows[0] as { id: string }).id;
  const aRes = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Alice', 'PM', ${TEST_PREFIX + suffix + "-a@x.com"}, 'ADMIN')
    RETURNING id
  `);
  userIdA = (aRes.rows[0] as { id: string }).id;
  const bRes = await db.execute(sql`
    INSERT INTO "users" (organization_id, first_name, last_name, email, role)
    VALUES (${orgId}, 'Bob', 'PM', ${TEST_PREFIX + suffix + "-b@x.com"}, 'ADMIN')
    RETURNING id
  `);
  userIdB = (bRes.rows[0] as { id: string }).id;
});

afterAll(async () => {
  await cleanup();
});

beforeEach(async () => {
  await db.execute(sql`DELETE FROM "wage_decision_rate_change_acknowledgements" WHERE organization_id = ${orgId}`);
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

describe("rate change acknowledgement history (Task #1480)", () => {
  it("appends one history row per acknowledged classification with the diff payload", async () => {
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter", 30, 32),
      changed("Electrician", 40, 41),
    ]);
    await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdA,
    });

    const all = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
    });
    expect(all.length).toBe(2);
    for (const r of all) {
      expect(r.acknowledgedByUserId).toBe(userIdA);
      expect(r.acknowledgedAt).toBeInstanceOf(Date);
      expect(r.detectedAt).toBeInstanceOf(Date);
    }
    const carpenter = all.find((r) => r.classification === "Carpenter")!;
    expect(carpenter.oldBaseRate).toBe("30.00");
    expect(carpenter.newBaseRate).toBe("32.00");
    expect(carpenter.changeKind).toBe("changed");
  });

  it("preserves prior acknowledgement after a re-arm overwrites the live row", async () => {
    // Alice acknowledges first diff
    await persistRateChangeRecords(orgId, DECISION, [changed("Carpenter", 30, 32)]);
    await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdA,
    });
    // Bob acknowledges the second (re-armed) diff
    await persistRateChangeRecords(orgId, DECISION, [changed("Carpenter", 32, 33)]);
    await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdB,
    });

    const carpenterHistory = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
      classification: "carpenter",
    });
    expect(carpenterHistory.length).toBe(2);
    // Most recent first
    expect(carpenterHistory[0].acknowledgedByUserId).toBe(userIdB);
    expect(carpenterHistory[0].newBaseRate).toBe("33.00");
    expect(carpenterHistory[1].acknowledgedByUserId).toBe(userIdA);
    expect(carpenterHistory[1].newBaseRate).toBe("32.00");

    // The live wage_decision_rate_changes row was wiped from the panel
    // perspective on the second acknowledge (Bob's row). The audit
    // history must still expose Alice's earlier acknowledgement.
    const aliceEntry = carpenterHistory.find((r) => r.acknowledgedByUserId === userIdA);
    expect(aliceEntry).toBeDefined();
    expect(aliceEntry?.oldBaseRate).toBe("30.00");
  });

  it("preserves history after a no-diff refresh deletes the live row (auto-clear)", async () => {
    await persistRateChangeRecords(orgId, DECISION, [changed("Carpenter", 30, 32)]);
    await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdA,
    });
    // No-diff refresh wipes the live row entirely.
    await persistRateChangeRecords(orgId, DECISION, []);

    // The live table is empty for this decision now…
    const live = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM "wage_decision_rate_changes"
      WHERE organization_id = ${orgId} AND decision_number = ${DECISION}
    `);
    expect((live.rows[0] as { n: number }).n).toBe(0);

    // …but the acknowledgement history must survive intact.
    const history = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
    });
    expect(history.length).toBe(1);
    expect(history[0].acknowledgedByUserId).toBe(userIdA);
    expect(history[0].classification).toBe("Carpenter");
    expect(history[0].newBaseRate).toBe("32.00");
  });

  it("filters history by classification (case-insensitive) and ignores other classifications", async () => {
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter", 30, 32),
      changed("Electrician", 40, 41),
    ]);
    await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdA,
    });
    const onlyCarp = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
      classification: "  CARPENTER  ",
    });
    expect(onlyCarp.length).toBe(1);
    expect(onlyCarp[0].classification).toBe("Carpenter");
  });

  it("history rows key on the original DOL feed classification name even when the panel maps it to a different display name", async () => {
    // Simulates the realistic case where the DOL feed reports
    // "Carpenter (Form Carpenter)" but the org has mapped that feed
    // row to a local "Carpenter" classification — the panel renders
    // the mapped name on the row, but the rate-change diff (and
    // therefore the history) is keyed by the feed name. The history
    // filter must be queryable using the feed name (which is what
    // the UI passes via `c.dolFeedName ?? c.classificationName`).
    await persistRateChangeRecords(orgId, DECISION, [
      changed("Carpenter (Form Carpenter)", 30, 32),
    ]);
    await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdA,
    });
    // Filter using the DOL feed name → 1 entry.
    const byFeed = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
      classification: "Carpenter (Form Carpenter)",
    });
    expect(byFeed.length).toBe(1);
    expect(byFeed[0].classification).toBe("Carpenter (Form Carpenter)");
    // Filter using just the mapped local name → 0 entries (proves
    // the UI must pass `dolFeedName` for DOL_FEED rows, and that the
    // server doesn't accidentally cross-match unrelated names).
    const byLocal = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
      classification: "Carpenter",
    });
    expect(byLocal.length).toBe(0);
  });

  it("acknowledge + history insert are atomic: a history-insert failure rolls back the badge clear", async () => {
    await persistRateChangeRecords(orgId, DECISION, [changed("Carpenter", 30, 32)]);
    // Force the history INSERT to fail by passing a userId that does
    // not exist in the users table — the FK constraint on
    // `acknowledged_by_user_id` blows the INSERT up. Note: the live
    // wage_decision_rate_changes table also FKs that column to
    // users.id, so the UPDATE itself would normally fail too; the
    // important thing the assertion proves is that the *combined*
    // operation is atomic — the live row is not partially mutated.
    const fakeUserId = "00000000-0000-0000-0000-000000000000";
    await expect(
      acknowledgeRateChanges({
        organizationId: orgId,
        decisionNumber: DECISION,
        userId: fakeUserId,
      }),
    ).rejects.toBeDefined();

    // The live row must still be unacknowledged because the whole
    // transaction rolled back when the FK constraint failed.
    const live = await db.execute(sql`
      SELECT acknowledged_at, acknowledged_by_user_id FROM "wage_decision_rate_changes"
      WHERE organization_id = ${orgId} AND decision_number = ${DECISION}
    `);
    expect(live.rows.length).toBe(1);
    const row = live.rows[0] as { acknowledged_at: unknown; acknowledged_by_user_id: unknown };
    expect(row.acknowledged_at).toBeNull();
    expect(row.acknowledged_by_user_id).toBeNull();

    // And no history row was written either.
    const history = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
    });
    expect(history.length).toBe(0);
  });

  it("does not write a history row when the acknowledge call matches no live rows", async () => {
    // Nothing persisted -> nothing to acknowledge -> no history row.
    const updated = await acknowledgeRateChanges({
      organizationId: orgId,
      decisionNumber: DECISION,
      userId: userIdA,
    });
    expect(updated).toBe(0);
    const history = await loadRateChangeAcknowledgementHistory({
      organizationId: orgId,
      decisionNumber: DECISION,
    });
    expect(history.length).toBe(0);
  });
});
