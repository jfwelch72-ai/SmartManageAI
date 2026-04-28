// Task #2340 — Unit coverage for `server/services/aiEstimator/feedback.ts`.
//
// Locks in:
//   • `recordFeedback` always writes a feedback event row
//   • Learned-rate side effect ONLY fires when:
//       outcome ∈ {ACCEPTED, EDITED}, costCode is set, rateSample is finite
//   • Learned-rate is NOT updated for REJECTED, missing costCode, or NaN
//   • `getFeedbackStats` rolls up counts by outcome and surface
//   • `listRecentFeedback` returns most-recent-first, scoped to org

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql } from "drizzle-orm";

import { db } from "../db";
import { organizations } from "@shared/schema";
import { recordFeedback, getFeedbackStats, listRecentFeedback } from "../services/aiEstimator/feedback";
import { getLearnedRate } from "../services/aiEstimator/learnedRates";

const PREFIX = "__ai_est_fb__";

let orgId: string;

async function cleanup(): Promise<void> {
  await db.execute(sql`DELETE FROM ai_estimator_feedback_events WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM ai_estimator_learned_rates WHERE organization_id IN (SELECT id FROM organizations WHERE slug LIKE ${PREFIX + "%"})`).catch(() => {});
  await db.execute(sql`DELETE FROM organizations WHERE slug LIKE ${PREFIX + "%"}`).catch(() => {});
}

beforeAll(async () => {
  await cleanup();
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const [org] = await db
    .insert(organizations)
    .values({
      name: "Feedback Org",
      slug: `${PREFIX}o-${stamp}`,
      tradeType: "GENERAL_CONTRACTOR",
      onboardingStatus: "COMPLETED",
      isActive: true,
    })
    .returning();
  orgId = org.id;
}, 30_000);

afterAll(async () => {
  await cleanup();
});

describe("feedback — recordFeedback", () => {
  it("always writes a feedback event row even with no rate sample", async () => {
    const event = await recordFeedback({
      organizationId: orgId,
      surface: "chat_answer",
      targetType: "chat_message",
      outcome: "THUMBS_UP",
    });
    expect(event.id).toBeDefined();
    expect(event.organizationId).toBe(orgId);
    expect(event.surface).toBe("chat_answer");
    expect(event.outcome).toBe("THUMBS_UP");
  });

  it("updates learned rate when ACCEPTED with a valid sample + costCode", async () => {
    const lookup = { costCode: "FB-ACCEPT-1", metric: "unit_cost" as const, unit: "CY" };
    expect(await getLearnedRate(orgId, lookup)).toBeNull();

    await recordFeedback({
      organizationId: orgId,
      surface: "inline_unit_cost",
      targetType: "estimate_line_item",
      outcome: "ACCEPTED",
      costCode: lookup.costCode,
      rateSample: { metric: lookup.metric, unit: lookup.unit, value: 175 },
    });

    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();
    expect(row!.sampleSize).toBe(1);
    expect(Number(row!.meanValue)).toBeCloseTo(175, 4);
  });

  it("updates learned rate when EDITED with a valid sample", async () => {
    const lookup = { costCode: "FB-EDIT-1", metric: "labor_hours_per_unit" as const, unit: "SY" };
    await recordFeedback({
      organizationId: orgId,
      surface: "inline_labor_hours",
      targetType: "estimate_line_item",
      outcome: "EDITED",
      costCode: lookup.costCode,
      rateSample: { metric: lookup.metric, unit: lookup.unit, value: 0.42 },
    });
    const row = await getLearnedRate(orgId, lookup);
    expect(row).not.toBeNull();
    expect(Number(row!.meanValue)).toBeCloseTo(0.42, 4);
  });

  it("does NOT update learned rate when outcome is REJECTED", async () => {
    const lookup = { costCode: "FB-REJECT-1", metric: "unit_cost" as const, unit: "CY" };
    await recordFeedback({
      organizationId: orgId,
      surface: "inline_unit_cost",
      targetType: "estimate_line_item",
      outcome: "REJECTED",
      costCode: lookup.costCode,
      rateSample: { metric: lookup.metric, unit: lookup.unit, value: 999 },
    });
    expect(await getLearnedRate(orgId, lookup)).toBeNull();
  });

  it("does NOT update learned rate when costCode is missing", async () => {
    await recordFeedback({
      organizationId: orgId,
      surface: "inline_unit_cost",
      targetType: "estimate_line_item",
      outcome: "ACCEPTED",
      rateSample: { metric: "unit_cost", unit: "EA", value: 50 },
    });
    // Probe a synthetic lookup that would only exist if a row were created.
    expect(await getLearnedRate(orgId, { costCode: "", metric: "unit_cost", unit: "EA" })).toBeNull();
  });

  it("does NOT update learned rate when rateSample.value is NaN", async () => {
    const lookup = { costCode: "FB-NAN-1", metric: "unit_cost" as const, unit: "CY" };
    await recordFeedback({
      organizationId: orgId,
      surface: "inline_unit_cost",
      targetType: "estimate_line_item",
      outcome: "ACCEPTED",
      costCode: lookup.costCode,
      rateSample: { metric: lookup.metric, unit: lookup.unit, value: Number.NaN },
    });
    expect(await getLearnedRate(orgId, lookup)).toBeNull();
  });
});

describe("feedback — read paths", () => {
  it("listRecentFeedback returns most-recent-first and is org-scoped", async () => {
    const events = await listRecentFeedback(orgId, 100);
    // The first record above (THUMBS_UP, chat_answer) is the oldest; latest from
    // this batch should be the NaN-rejected one.
    expect(events.length).toBeGreaterThanOrEqual(5);
    for (const e of events) expect(e.organizationId).toBe(orgId);
    const timestamps = events.map((e) => e.createdAt.getTime());
    for (let i = 1; i < timestamps.length; i++) {
      expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
    }
  });

  it("getFeedbackStats rolls up counts by outcome + surface", async () => {
    const stats = await getFeedbackStats(orgId, 30);
    expect(stats.total).toBeGreaterThanOrEqual(5);
    expect(stats.accepted).toBeGreaterThanOrEqual(2);
    expect(stats.edited).toBeGreaterThanOrEqual(1);
    expect(stats.rejected).toBeGreaterThanOrEqual(1);
    expect(stats.totalEvents).toBe(stats.total);
    expect(stats.acceptanceRate).toBeGreaterThan(0);
    expect(stats.acceptanceRate).toBeLessThanOrEqual(1);
    expect(stats.bySurface.chat_answer).toBeGreaterThanOrEqual(1);
    expect(stats.bySurface.inline_unit_cost).toBeGreaterThanOrEqual(1);
  });
});
